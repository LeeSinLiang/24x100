// Plane geometry in local feet. Pure functions, no DOM.
import polygonClipping from 'polygon-clipping';
import type { Pt, Ring } from './types';

export const EPS = 1e-9;

export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
export function add(a: Pt, b: Pt): Pt {
  return [a[0] + b[0], a[1] + b[1]];
}
export function mul(a: Pt, k: number): Pt {
  return [a[0] * k, a[1] * k];
}
export function dot(a: Pt, b: Pt): number {
  return a[0] * b[0] + a[1] * b[1];
}
export function cross(a: Pt, b: Pt): number {
  return a[0] * b[1] - a[1] * b[0];
}
export function len(a: Pt): number {
  return Math.hypot(a[0], a[1]);
}
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
export function unit(a: Pt): Pt {
  const l = len(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}

/** Drop the closing duplicate and near-duplicate consecutive vertices. */
export function openRing(ring: Ring, tol = 0.05): Ring {
  const out: Ring = [];
  for (const p of ring) {
    if (out.length && dist(out[out.length - 1], p) < tol) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < tol) out.pop();
  return out;
}

/** Shoelace signed area of an open ring. */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function area(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Orient an open ring so that the interior lies to the LEFT of each directed edge
 *  (cross(edge, toInterior) > 0), i.e. positive signed area in these coordinates. */
export function orientLeft(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

export function centroid(ring: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < EPS) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function distPointSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, add(a, mul(ab, t)));
}

export function distPointRing(p: Pt, ring: Ring): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    d = Math.min(d, distPointSegment(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return d;
}

export function distPointPolyline(p: Pt, line: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, distPointSegment(p, line[i], line[i + 1]));
  return d;
}

export function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Convex (allowing collinear vertices within `angTol` radians). Ring must be oriented left. */
export function isConvex(ring: Ring, angTol = 0.02): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const c = ring[(i + 2) % n];
    const u = unit(sub(b, a));
    const v = unit(sub(c, b));
    if (cross(u, v) < -Math.sin(angTol)) return false;
  }
  return true;
}

/** Keep the part of `ring` on the interior side of the directed line a→b shifted inward by `d`.
 *  Interior = left of a→b. One Sutherland–Hodgman step. */
export function clipHalfPlane(ring: Ring, a: Pt, b: Pt, d: number): Ring {
  const dir = unit(sub(b, a));
  const nrm: Pt = [-dir[1], dir[0]]; // left normal = inward
  const s = (p: Pt) => dot(sub(p, a), nrm) - d; // >= 0 keeps
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const sp = s(p);
    const sq = s(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return openRing(out, 1e-6);
}

/** Setback envelope: each edge i moved inward by setbacks[i].
 *  Exact half-plane intersection for convex lots; buffered-strip difference for concave ones. */
export function envelope(
  ring: Ring,
  setbacks: number[],
): { poly: Ring; method: 'halfplane_convex' | 'buffer_concave' } {
  const r = orientLeft(openRing(ring));
  if (isConvex(r)) {
    let poly = r;
    for (let i = 0; i < r.length && poly.length >= 3; i++) {
      const d = setbacks[i];
      if (!(d > 0)) continue;
      poly = clipHalfPlane(poly, r[i], r[(i + 1) % r.length], d);
    }
    return { poly: poly.length >= 3 ? poly : [], method: 'halfplane_convex' };
  }
  // Concave: subtract a strip of width d along each edge (rectangle, extended by d at both ends).
  const strips: [number, number][][][] = [];
  for (let i = 0; i < r.length; i++) {
    const d = setbacks[i];
    if (!(d > 0)) continue;
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const u = unit(sub(b, a));
    const nrm: Pt = [-u[1], u[0]];
    const a2 = sub(a, mul(u, d));
    const b2 = add(b, mul(u, d));
    const quad: Pt[] = [add(a2, mul(nrm, -d)), add(b2, mul(nrm, -d)), add(b2, mul(nrm, d)), add(a2, mul(nrm, d))];
    strips.push([[...quad, quad[0]]]);
  }
  const lot: [number, number][][] = [[...r, r[0]]];
  const diff = strips.length ? polygonClipping.difference(lot as never, ...(strips as never[])) : [lot];
  // Keep the largest piece; note: several pieces would mean more than one envelope.
  let best: Ring = [];
  let bestA = 0;
  for (const poly of diff as unknown as Pt[][][]) {
    const outer = openRing(poly[0]);
    const a = area(outer);
    if (a > bestA) {
      bestA = a;
      best = outer;
    }
  }
  return { poly: best, method: 'buffer_concave' };
}

/** Union of rings (outer rings only). Returns the outer ring of the largest piece. */
export function unionRings(rings: Ring[]): Ring {
  if (rings.length === 1) return openRing(rings[0]);
  const polys = rings.map((r) => [[...openRing(r), openRing(r)[0]]]);
  const [first, ...rest] = polys as never[];
  const u = polygonClipping.union(first, ...rest) as unknown as Pt[][][];
  let best: Ring = [];
  let bestA = 0;
  for (const poly of u) {
    const outer = openRing(poly[0]);
    const a = area(outer);
    if (a > bestA) {
      bestA = a;
      best = outer;
    }
  }
  return best;
}

/** Remove vertices where the ring continues straight (T-junction points), within `angTol` radians. */
export function dropCollinear(ring: Ring, angTol = 0.01): Ring {
  let r = ring;
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length];
      const b = r[i];
      const c = r[(i + 1) % r.length];
      const u = unit(sub(b, a));
      const v = unit(sub(c, b));
      if (Math.abs(cross(u, v)) < Math.sin(angTol) && dot(u, v) > 0) {
        r = r.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return r;
}

/** Extent of a ring projected on a unit direction. */
export function extent(ring: Ring, dir: Pt): number {
  if (!ring.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of ring) {
    const s = dot(p, dir);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return hi - lo;
}

/** Resample a closed ring to n points spaced evenly along its perimeter, starting nearest `start`.
 *  Used by the UI to tween envelopes between shapes with different vertex counts. */
export function resample(ring: Ring, n: number, start?: Pt): Ring {
  if (ring.length < 2) return Array.from({ length: n }, () => (ring[0] ? [...ring[0]] : [0, 0]) as Pt);
  let r = ring;
  if (start) {
    let k = 0;
    let best = Infinity;
    r.forEach((p, i) => {
      const d = dist(p, start);
      if (d < best) {
        best = d;
        k = i;
      }
    });
    r = [...r.slice(k), ...r.slice(0, k)];
  }
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const l = dist(r[i], r[(i + 1) % r.length]);
    segs.push(l);
    total += l;
  }
  const out: Ring = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (seg < segs.length - 1 && acc + segs[seg] < target) {
      acc += segs[seg];
      seg++;
    }
    const t = segs[seg] > EPS ? (target - acc) / segs[seg] : 0;
    const a = r[seg];
    const b = r[(seg + 1) % r.length];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
