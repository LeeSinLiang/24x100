// Edge labels: which side of a lot is the front, the rear, an interior side or a street side.
// Spec §7: an edge shared with another parcel (within 1.5 ft) is interior; an unshared edge faces a
// street; the front is the street-facing side on the addressed street; the side opposite the front
// is the rear; other street-facing sides are exterior sides.
import { cross, dist, distPointPolyline, distPointRing, dot, openRing, orientLeft, sub, unit } from './geom';
import type { EdgeKind, Pt, Ring, Side, Street } from './types';

export const SHARE_TOL = 1.5; // ft
const STREET_SEARCH = 80; // ft from an unshared edge's midpoint to a street centerline
const TURN = Math.sin((25 * Math.PI) / 180); // direction change that starts a new side

export interface Neighbor {
  pin: string;
  ring: Ring;
  built: boolean;
  addr: string;
  lot: number | null;
}

export interface EdgeLabelResult {
  ring: Ring; // oriented, open
  sides: Omit<Side, 'setback' | 'setback_rule_ids' | 'setback_trust' | 'setback_note'>[];
  ok: boolean;
  note: string | null;
}

const SUFFIX: Record<string, string> = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', av: 'ave', way: 'way', wy: 'way', road: 'rd', rd: 'rd',
  boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', place: 'pl', pl: 'pl', lane: 'ln', ln: 'ln',
  terrace: 'ter', ter: 'ter', court: 'ct', ct: 'ct', alley: 'aly', aly: 'aly', highway: 'hwy', hwy: 'hwy',
  square: 'sq', sq: 'sq', circle: 'cir', cir: 'cir', parkway: 'pkwy', pkwy: 'pkwy', row: 'row',
};
const DIRS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west']);

/** "MAHON ST" and "Mahon Street" → { base: "mahon", suffix: "st" }. */
export function normStreet(s: string | null | undefined): { base: string; suffix: string | null } | null {
  if (!s) return null;
  const toks = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!toks.length) return null;
  let suffix: string | null = null;
  const last = toks[toks.length - 1];
  if (SUFFIX[last] && toks.length > 1) {
    suffix = SUFFIX[last];
    toks.pop();
  }
  const base = toks.filter((t) => !DIRS.has(t)).join(' ') || toks.join(' ');
  return { base, suffix };
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Same street, allowing the small spelling differences between County/City addresses and
 *  OpenStreetMap ("Stolz"/"Stoltz", "Crossman"/"Crosman", "Clairtonica"/"Clairtonic"). */
export function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normStreet(a);
  const y = normStreet(b);
  if (!x || !y) return false;
  const suffixOk = !x.suffix || !y.suffix || x.suffix === y.suffix;
  if (x.base === y.base) return suffixOk;
  const n = Math.min(x.base.length, y.base.length);
  const tol = n >= 7 ? 2 : n >= 5 ? 1 : 0;
  return tol > 0 && suffixOk && x.base[0] === y.base[0] && editDistance(x.base, y.base) <= tol;
}

/** The street an unshared edge faces: among centerlines within reach, prefer ones running parallel
 *  to the edge (a corner lot's front is closer to the cross street at one end), then the nearest by
 *  mean distance over the edge. */
export function nearestParallelStreet(a: Pt, b: Pt, streets: Street[]): string | null {
  const dir = unit(sub(b, a));
  let best: { name: string; score: number } | null = null;
  for (const s of streets) {
    let sum = 0;
    let cosSum = 0;
    const K = 5;
    for (let k = 0; k < K; k++) {
      const t = (k + 0.5) / K;
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let dmin = Infinity;
      let segDir: Pt = [1, 0];
      for (let i = 0; i + 1 < s.line.length; i++) {
        const d = distPointPolyline(p, [s.line[i], s.line[i + 1]]);
        if (d < dmin) {
          dmin = d;
          segDir = unit(sub(s.line[i + 1], s.line[i]));
        }
      }
      sum += dmin;
      cosSum += Math.abs(dot(dir, segDir));
    }
    const mean = sum / K;
    if (mean > STREET_SEARCH) continue;
    const parallel = cosSum / K; // 1 = parallel, 0 = perpendicular
    const score = mean + (parallel > 0.8 ? 0 : 1000);
    if (!best || score < best.score) best = { name: s.name, score };
  }
  return best ? best.name : null;
}

/** Label the sides of `ring` against its neighbors and the street network. */
/** Two parcels share a lot line (not just a corner): some edge of `a` has at least 2 of 9 samples within
 *  SHARE_TOL of `b`, the same test `labelEdges` uses to call an edge shared. */
export function sharesEdge(a: Ring, b: Ring): boolean {
  const r = openRing(a);
  const rb = openRing(b);
  for (let i = 0; i < r.length; i++) {
    const p0 = r[i];
    const p1 = r[(i + 1) % r.length];
    let hits = 0;
    for (let k = 1; k <= 9; k++) {
      const t = k / 10;
      if (distPointRing([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], rb) <= SHARE_TOL) hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/** Connected groups of rings under `sharesEdge`; each group lists indexes into `rings`. */
export function contiguousGroups(rings: Ring[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let s = 0; s < rings.length; s++) {
    if (seen.has(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      for (let j = 0; j < rings.length; j++) if (!seen.has(j) && sharesEdge(rings[i], rings[j])) (seen.add(j), stack.push(j));
    }
    out.push(comp.sort((x, y) => x - y));
  }
  return out;
}

export function labelEdges(ring: Ring, neighbors: Neighbor[], streets: Street[], addrStreet: string | null): EdgeLabelResult {
  const r = orientLeft(openRing(ring));
  const n = r.length;
  type E = { i: number; a: Pt; b: Pt; shared: boolean; pins: string[]; street: string | null; dir: Pt };
  const edges: E[] = [];
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const hits = new Map<string, number>();
    let anyHit = 0;
    const S = 9;
    for (let k = 1; k <= S; k++) {
      const t = k / (S + 1);
      const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let hit = false;
      for (const nb of neighbors) {
        if (distPointRing(p, nb.ring) <= SHARE_TOL) {
          hits.set(nb.pin, (hits.get(nb.pin) ?? 0) + 1);
          hit = true;
        }
      }
      if (hit) anyHit++;
    }
    const shared = anyHit / S >= 0.5;
    const pins = [...hits.entries()].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).map(([p]) => p);
    let street: string | null = null;
    if (!shared) street = nearestParallelStreet(a, b, streets);
    edges.push({ i, a, b, shared, pins, street, dir: unit(sub(b, a)) });
  }

  // Group consecutive edges into sides: same shared-ness and no sharp turn.
  const breaks: boolean[] = edges.map((e, k) => {
    const prev = edges[(k - 1 + n) % n];
    return Math.abs(cross(prev.dir, e.dir)) > TURN || dot(prev.dir, e.dir) < 0 || prev.shared !== e.shared;
  });
  let start = breaks.findIndex(Boolean);
  if (start < 0) start = 0;
  const groups: E[][] = [];
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    if (k === 0 || breaks[(start + k) % n]) groups.push([e]);
    else groups[groups.length - 1].push(e);
  }

  const nbByPin = new Map(neighbors.map((x) => [x.pin, x]));
  type G = { es: E[]; shared: boolean; street: string | null; len: number; dir: Pt };
  const gs: G[] = groups.map((es) => {
    const len = es.reduce((s, e) => s + dist(e.a, e.b), 0);
    const first = es[0].a;
    const last = es[es.length - 1].b;
    const streetVotes = new Map<string, number>();
    for (const e of es) if (e.street) streetVotes.set(e.street, (streetVotes.get(e.street) ?? 0) + dist(e.a, e.b));
    const street = [...streetVotes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return { es, shared: es[0].shared, street, len, dir: unit(sub(last, first)) };
  });

  // Front: the street-facing side on the addressed street.
  const open = gs.filter((g) => !g.shared);
  let front: G | undefined = open.filter((g) => sameStreet(g.street, addrStreet)).sort((x, y) => y.len - x.len)[0];
  let note: string | null = null;
  if (!front) {
    if (open.length === 1) {
      front = open[0];
      note = addrStreet
        ? `The addressed street (${addrStreet}) wasn't matched to a street line; the lot's only street-facing side is used as the front.`
        : 'No addressed street; the only street-facing side is used as the front.';
    } else {
      const why = open.length === 0 ? 'no side of this lot faces a street' : `${open.length} sides face streets and none matches the address`;
      return { ring: r, sides: [], ok: false, note: `Edges not computed: ${why}.` };
    }
  }
  // Rear: the side most opposite the front.
  const rest = gs.filter((g) => g !== front);
  let rear: G | undefined;
  let bestDot = -0.5;
  for (const g of rest) {
    const d = dot(g.dir, front.dir);
    if (d < bestDot) {
      bestDot = d;
      rear = g;
    }
  }

  const sides = gs.map((g) => {
    let kind: EdgeKind;
    if (g === front) kind = 'front';
    else if (g === rear) kind = 'rear';
    else kind = g.shared ? 'side_interior' : 'side_exterior';
    const pins = [...new Set(g.es.flatMap((e) => e.pins))];
    const pts: Pt[] = [g.es[0].a, ...g.es.map((e) => e.b)];
    return {
      kind,
      edge_idx: g.es.map((e) => e.i),
      a: pts[0],
      b: pts[pts.length - 1],
      points: pts,
      length: g.len,
      neighbors: pins
        .map((p) => nbByPin.get(p))
        .filter((x): x is Neighbor => !!x)
        .map((x) => ({ pin: x.pin, built: x.built, addr: x.addr, lot: x.lot })),
      street: g.shared ? null : g.street,
      through_lot: kind === 'rear' && !g.shared ? true : undefined,
    };
  });
  return { ring: r, sides, ok: true, note };
}
