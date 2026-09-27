// The city map: every City-owned vacant lot as a dot, colored by its first blocker. The canvas holds
// the dots (decoration of a computed answer: every dot is also a row in the table); the SVG over it
// holds outlines, lettering, the selection mark, the north arrow and the scale bar.
//
// The camera (team review, round 3): wheel and pinch zoom, drag to pan, + / − and "Whole city" controls, and
// an animated zoom when the neighbourhood changes. The view the SVG is laid out for (`shown`) changes only when
// a move ends; while the camera moves, the canvas is redrawn at the live view every frame (11,247 arcs) and the
// SVG layer is carried along by one transform, so React never re-renders mid-move. Record and present mode keep
// a still, fixed view: no gestures, no controls, no animation (a neighbourhood change is the old 160 ms cut).
import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Blocker, CityClass } from '@engine/city';
import { PAINT_ORDER, STYLE, n } from './blockers';
import type { CityLotRow, Hood } from './cityData';

// Equirectangular around Pittsburgh's center: x = lon · cos(lat₀), y = −lat (units: degrees of latitude).
const LAT0 = 40.44;
const KX = Math.cos((LAT0 * Math.PI) / 180);
const MI_PER_DEG_LAT = 69.05;
/** City limits (approximate bounding box), used only when no neighborhood outlines are loaded. */
const PGH: [number, number, number, number] = [-80.0955, 40.3614, -79.8657, 40.5012];
const ASPECT = (PGH[3] - PGH[1]) / ((PGH[2] - PGH[0]) * KX);
/** Height over width of the city map (the workspace sizes its box to fit the canvas). */
export const MAP_ASPECT = ASPECT;

type XY = [number, number];
const proj = (ll: readonly [number, number]): XY => [ll[0] * KX, -ll[1]];

type Box = [number, number, number, number]; // x0 y0 x1 y1 in projected units
function grow(b: Box, p: XY): Box {
  return [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])];
}
const EMPTY: Box = [Infinity, Infinity, -Infinity, -Infinity];

/** A camera: screen = world · k + o (px). */
export interface View {
  k: number;
  ox: number;
  oy: number;
}

function ringCentroid(r: XY[]): XY {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return r[0];
  return [cx / (3 * a), cy / (3 * a)];
}
function ringArea(r: XY[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
  return Math.abs(a / 2);
}
function inRing(p: XY, r: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Resolve a color token to something a canvas accepts (color-mix() tokens included). */
function resolveColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  const c = getComputedStyle(probe).color;
  const m = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/);
  if (m) return `rgba(${Math.round(+m[1] * 255)}, ${Math.round(+m[2] * 255)}, ${Math.round(+m[3] * 255)}, ${m[4] ?? 1})`;
  return c;
}

/** Changes whenever the theme does (system preference or ?theme=), so washes and dots redraw. */
export function useThemeKey(): string {
  const [k, setK] = useState(() => `${document.documentElement.dataset.theme ?? ''}:${window.matchMedia('(prefers-color-scheme: dark)').matches}`);
  useEffect(() => {
    const read = () => setK(`${document.documentElement.dataset.theme ?? ''}:${window.matchMedia('(prefers-color-scheme: dark)').matches}`);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', read);
      mo.disconnect();
    };
  }, []);
  return k;
}

export interface HoodInfo {
  name: string;
  lots: number;
  rings: XY[][]; // projected
  anchor: XY; // label anchor, projected
  box: Box;
  lotBox: Box; // extent of its lots (empty when it has none)
}

export function hoodIndex(lots: CityLotRow[], hoods: Hood[]): Map<string, HoodInfo> {
  const out = new Map<string, HoodInfo>();
  for (const h of hoods) {
    const rings = h.rings.map((r) => r.map(proj));
    if (!rings.length || !rings[0].length) continue;
    const big = [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
    let box = EMPTY;
    for (const r of rings) for (const p of r) box = grow(box, p);
    out.set(h.name, { name: h.name, lots: 0, rings, anchor: ringCentroid(big), box, lotBox: EMPTY });
  }
  const sums = new Map<string, { x: number; y: number; k: number; box: Box }>();
  for (const l of lots) {
    const p = proj(l.ll);
    const s = sums.get(l.hood) ?? { x: 0, y: 0, k: 0, box: EMPTY };
    s.x += p[0];
    s.y += p[1];
    s.k++;
    s.box = grow(s.box, p);
    sums.set(l.hood, s);
  }
  for (const [name, s] of sums) {
    const h = out.get(name);
    if (h) {
      h.lots = s.k;
      h.lotBox = s.box;
    } else out.set(name, { name, lots: s.k, rings: [], anchor: [s.x / s.k, s.y / s.k], box: s.box, lotBox: s.box });
  }
  return out;
}

interface Props {
  lots: CityLotRow[];
  water?: Hood[]; // rivers, drawn as a wash under the dots
  classes: CityClass[];
  hoods: Map<string, HoodInfo>;
  focus: string | null; // neighborhood zoomed to
  focusIsFilter?: boolean; // the focus is the link's neighbourhood filter (Whole city clears it) rather than a lot's own
  selected: number | null; // index into lots
  onSelect: (i: number | null) => void;
  onZoom: (hood: string | null) => void;
  present: boolean;
  record: boolean;
  animate?: boolean; // film (anim=1): a staged page that still zooms and pans, so a clip can show the camera move
  stacked?: boolean; // the page scrolls (phone): one-finger touch scrolls the page; zoom with the buttons
  label: string;
  inset?: ReactNode; // the selected lot's card, set in the corner away from its dot
  insetWide?: boolean; // a plan inset (spec §0.15 P2): wider, joined to its dot by a leader line
  onInsetOpen?: () => void; // double-clicking the inset (opens the Plan view)
  marks?: number[]; // "Combine to fit" layer: City lots in a qualifying run, ringed (indexes into lots)
  markStrong?: number[]; // the selected run's lots, ringed heavier
  whatIf?: number[]; // a rule what-if's lots (spec §0.16): the rest of the map dims, these keep their dot and get a pencil ring
}

const PAD = 26;
/** The room an inset has inside the map (px): its content width and the tallest it may draw, so a tall plan
 *  or outline fits inside the map instead of running off its bottom. */
export const InsetRoom = createContext<{ w: number; maxH: number } | null>(null);
/** Zoom range, relative to the whole-city fit: a little out, and in to about a block. */
const K_MIN = 0.8;
const K_MAX = 80;
const FLY_MS = 420;
const STEP = 1.8; // + and −

function fitBox(box: Box, w: number, h: number): View {
  const bw = box[2] - box[0] || 1e-6;
  const bh = box[3] - box[1] || 1e-6;
  const k = Math.min((w - PAD * 2) / bw, (h - PAD * 2) / bh);
  return { k, ox: (w - bw * k) / 2 - box[0] * k, oy: (h - bh * k) / 2 - box[1] * k };
}
const sameView = (a: View, b: View) => Math.abs(a.k - b.k) < 1e-9 * a.k && Math.abs(a.ox - b.ox) < 0.01 && Math.abs(a.oy - b.oy) < 0.01;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CityMap(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const moveG = useRef<SVGGElement>(null);
  const [w, setW] = useState(800);
  const h = Math.round(w * ASPECT);
  const themeKey = useThemeKey();
  const hoverOn = !p.present && !p.record;
  // A still map: the film and the projector get a fixed view (no gestures, no animation).
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = (p.present || p.record) && !p.animate;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // A zero width (the first layout pass on some narrow layouts) is ignored, never drawn.
    const read = () => el.clientWidth > PAD * 3 && setW(el.clientWidth);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  // The whole city's box, and the focused neighbourhood's (never smaller than ~0.6 mi across).
  const cityBox = useMemo(() => {
    let box: Box = EMPTY;
    const withRings = [...p.hoods.values()].filter((x) => x.rings.length);
    if (withRings.length) for (const x of withRings) box = grow(grow(box, [x.box[0], x.box[1]]), [x.box[2], x.box[3]]);
    else box = [PGH[0] * KX, -PGH[3], PGH[2] * KX, -PGH[1]];
    for (const l of p.lots) box = grow(box, proj(l.ll));
    return box;
  }, [p.hoods, p.lots]);
  const focusBox = useMemo((): Box | null => {
    const f = p.focus ? p.hoods.get(p.focus) : null;
    if (!f) return null;
    const box = f.box;
    // An outlined neighborhood shows whole; a cluster without an outline gets a block-scale frame.
    const min = (f.rings.length ? 0.6 : 0.15) / MI_PER_DEG_LAT;
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const hw = Math.max((box[2] - box[0]) / 2, min / 2);
    const hh = Math.max((box[3] - box[1]) / 2, min / 2);
    return [cx - hw, cy - hh, cx + hw, cy + hh];
  }, [p.focus, p.hoods]);
  const cityFit = useMemo(() => fitBox(cityBox, w, h), [cityBox, w, h]);
  const fit = useMemo(() => (focusBox ? fitBox(focusBox, w, h) : cityFit), [focusBox, cityFit, w, h]);
  const focusKey = p.focus ?? 'city';

  // The camera the SVG is laid out for: null follows the fit (the focus); a view once the reader moves.
  const [cam, setCam] = useState<View | null>(null);
  const shown: View = cam ?? fit;
  const view = { ...shown, key: focusKey };

  // Keep a camera inside sensible bounds: zoom within [K_MIN, K_MAX] of the city fit, and some of the city in view.
  const clamp = (v: View): View => {
    const k = Math.min(cityFit.k * K_MAX, Math.max(cityFit.k * K_MIN, v.k));
    const cx = w / 2 - ((w / 2 - v.ox) * k) / v.k;
    const cy = h / 2 - ((h / 2 - v.oy) * k) / v.k;
    let ox = v.k === k ? v.ox : cx;
    let oy = v.k === k ? v.oy : cy;
    const bx0 = cityBox[0] * k + ox;
    const bx1 = cityBox[2] * k + ox;
    const by0 = cityBox[1] * k + oy;
    const by1 = cityBox[3] * k + oy;
    const mx = Math.min(w * 0.3, (bx1 - bx0) / 2);
    const my = Math.min(h * 0.3, (by1 - by0) / 2);
    if (bx1 < mx) ox += mx - bx1;
    if (bx0 > w - mx) ox -= bx0 - (w - mx);
    if (by1 < my) oy += my - by1;
    if (by0 > h - my) oy -= by0 - (h - my);
    return { k, ox, oy };
  };
  const zoomAt = (v: View, f: number, x: number, y: number): View => {
    const k = Math.min(cityFit.k * K_MAX, Math.max(cityFit.k * K_MIN, v.k * f));
    const g = k / v.k;
    return clamp({ k, ox: x - (x - v.ox) * g, oy: y - (y - v.oy) * g });
  };

  // World coordinates once per lot list; screen positions at the shown view (hit tests, labels, marks).
  const world = useMemo(() => {
    const xs = new Float64Array(p.lots.length);
    const ys = new Float64Array(p.lots.length);
    p.lots.forEach((l, i) => {
      const q = proj(l.ll);
      xs[i] = q[0];
      ys[i] = q[1];
    });
    return { xs, ys };
  }, [p.lots]);
  const pos = useMemo(() => {
    const xs = new Float32Array(p.lots.length);
    const ys = new Float32Array(p.lots.length);
    for (let i = 0; i < p.lots.length; i++) {
      xs[i] = world.xs[i] * shown.k + shown.ox;
      ys[i] = world.ys[i] * shown.k + shown.oy;
    }
    return { xs, ys };
  }, [world, shown.k, shown.ox, shown.oy, p.lots.length]);
  const toPx = (q: XY): XY => [q[0] * shown.k + shown.ox, q[1] * shown.k + shown.oy];
  const water = useMemo(() => (p.water ?? []).map((wt) => ({ name: wt.name, rings: wt.rings.map((r) => r.map(proj)) })), [p.water]);

  // Dots grow a little as the camera zooms in: 3 px citywide, 5 px in a neighbourhood, up to 8 px close in.
  const radius = (k: number) => {
    const base = p.focus || p.lots.length < 1000 ? 2.6 : 1.6;
    return Math.min(4, Math.max(base, 1.6 * Math.pow(k / cityFit.k, 0.33)));
  };
  const r = radius(shown.k);

  // ── The canvas, drawn at any view (the live one while the camera moves) ──
  const colorCache = useRef<{ key: string; c: Partial<Record<string, string>> }>({ key: '', c: {} });
  const drawAt = (v: View) => {
    const c = canvas.current;
    const pr = probe.current;
    if (!c || !pr) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (colorCache.current.key !== themeKey) colorCache.current = { key: themeKey, c: {} };
    const col = colorCache.current.c;
    const color = (t: string) => (col[t] ??= resolveColor(pr, t));
    const rr = radius(v.k);
    const X = (i: number) => world.xs[i] * v.k + v.ox;
    const Y = (i: number) => world.ys[i] * v.k + v.oy;
    // Rivers: a quiet wash with a hairline bank, under everything else.
    if (water.length) {
      g.save();
      g.beginPath();
      for (const wt of water)
        for (const ring of wt.rings)
          ring.forEach((q, i) => {
            const x = q[0] * v.k + v.ox;
            const y = q[1] * v.k + v.oy;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          });
      g.fillStyle = color('--stone');
      g.globalAlpha = 0.45;
      g.fill('evenodd');
      g.globalAlpha = 0.5;
      g.strokeStyle = color('--stone');
      g.lineWidth = 0.8;
      g.stroke();
      g.restore();
    }
    const groups = new Map<Blocker, number[]>();
    p.classes.forEach((c2, i) => {
      const x = X(i);
      const y = Y(i);
      if (x < -8 || y < -8 || x > w + 8 || y > h + 8) return;
      const arr = groups.get(c2.blocker) ?? [];
      arr.push(i);
      groups.set(c2.blocker, arr);
    });
    const zoomed = !!p.focus || v.k > cityFit.k * 2;
    for (const b of PAINT_ORDER) {
      const idx = groups.get(b);
      if (!idx?.length) continue;
      const st = STYLE[b];
      g.save();
      g.globalAlpha = st.alpha ?? 1;
      g.beginPath();
      for (const i of idx) {
        g.moveTo(X(i) + rr, Y(i));
        g.arc(X(i), Y(i), rr, 0, Math.PI * 2);
      }
      if (st.hollow) {
        g.strokeStyle = color(st.token);
        g.lineWidth = zoomed ? 1.2 : 1;
        if (st.dashed) g.setLineDash(zoomed ? [1.6, 1.4] : [1.1, 1.1]);
        g.stroke();
      } else {
        g.fillStyle = color(st.token);
        g.fill();
      }
      if (st.ring) {
        g.beginPath();
        for (const i of idx) {
          g.moveTo(X(i) + rr + 1.4, Y(i));
          g.arc(X(i), Y(i), rr + 1.4, 0, Math.PI * 2);
        }
        g.strokeStyle = color(st.ring);
        g.lineWidth = 1;
        g.stroke();
      }
      g.restore();
    }
    // For the film's pen (data-marks-box): the box, in the map's layout px, around the ringed lots on screen.
    {
      const ringed = [...(p.marks ?? []), ...(p.markStrong ?? [])].filter((i) => i >= 0 && i < world.xs.length && X(i) >= 0 && X(i) <= w && Y(i) >= 0 && Y(i) <= h);
      if (ringed.length) {
        const xs = ringed.map(X);
        const ys = ringed.map(Y);
        c.dataset.marksBox = [Math.min(...xs) - rr - 4, Math.min(...ys) - rr - 4, Math.max(...xs) + rr + 4, Math.max(...ys) + rr + 4].map((v) => Math.round(v)).join(',');
      } else delete c.dataset.marksBox;
    }
    // "Combine to fit" (C15): a ring around each City lot in a qualifying run; the selected run heavier.
    for (const [idx, lw, extra] of [
      [p.marks ?? [], 1.2, 2.6],
      [p.markStrong ?? [], 2.2, 3.6],
    ] as const) {
      if (!idx.length) continue;
      g.save();
      g.beginPath();
      for (const i of idx) {
        if (i < 0 || i >= world.xs.length) continue;
        g.moveTo(X(i) + rr + extra, Y(i));
        g.arc(X(i), Y(i), rr + extra, 0, Math.PI * 2);
      }
      g.strokeStyle = color('--ink');
      g.lineWidth = lw;
      g.stroke();
      g.restore();
    }
    // A rule what-if (spec §0.16): hypothetical, so never coloured as "fits". The rest of the map dims under a
    // paper wash; these lots keep today's dot and get a dashed pencil ring.
    const wi = (p.whatIf ?? []).filter((i) => i >= 0 && i < world.xs.length);
    if (wi.length) {
      g.save();
      g.fillStyle = color('--paper');
      g.globalAlpha = 0.7;
      g.fillRect(0, 0, w, h);
      g.restore();
      for (const i of wi) {
        const st = STYLE[p.classes[i].blocker];
        g.save();
        g.beginPath();
        g.arc(X(i), Y(i), rr, 0, Math.PI * 2);
        if (st.hollow) {
          g.strokeStyle = color(st.token);
          g.lineWidth = 1.2;
          g.stroke();
        } else {
          g.fillStyle = color(st.token);
          g.fill();
        }
        g.restore();
      }
      g.save();
      g.beginPath();
      for (const i of wi) {
        g.moveTo(X(i) + rr + 3.8, Y(i));
        g.arc(X(i), Y(i), rr + 3.8, 0, Math.PI * 2);
      }
      g.setLineDash([2.6, 1.8]);
      g.strokeStyle = color('--graphite');
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  };

  // ── Motion: the live camera, applied to the canvas (redrawn) and the SVG layer (one transform) ──
  const live = useRef<View>(shown);
  const shownRef = useRef<View>(shown);
  const moving = useRef(false); // an animation or a gesture is running: the live view leads
  const raf = useRef(0);
  const drawRef = useRef(drawAt);
  drawRef.current = drawAt;
  const applyLive = () => {
    const v = live.current;
    const s = shownRef.current;
    const g = moveG.current;
    if (g) {
      const sc = v.k / s.k;
      g.setAttribute('transform', sameView(v, s) ? '' : `translate(${(v.ox - s.ox * sc).toFixed(2)} ${(v.oy - s.oy * sc).toFixed(2)}) scale(${sc.toFixed(5)})`);
    }
    drawRef.current(v);
  };
  const setMoving = (on: boolean) => {
    moving.current = on;
    wrap.current?.classList.toggle('is-moving', on);
  };
  const fly = (to: View, ms = FLY_MS) => {
    cancelAnimationFrame(raf.current);
    const from = live.current;
    if (still || reduced || ms <= 0 || sameView(from, to)) {
      live.current = to;
      setMoving(false);
      applyLive();
      return;
    }
    setMoving(true);
    const t0 = performance.now();
    // Zoom in log space around the screen centre, so a long zoom reads as one steady move.
    const c0: XY = [(w / 2 - from.ox) / from.k, (h / 2 - from.oy) / from.k];
    const c1: XY = [(w / 2 - to.ox) / to.k, (h / 2 - to.oy) / to.k];
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      const cx = c0[0] + (c1[0] - c0[0]) * e;
      const cy = c0[1] + (c1[1] - c0[1]) * e;
      live.current = t < 1 ? { k, ox: w / 2 - cx * k, oy: h / 2 - cy * k } : to;
      applyLive();
      if (t < 1) raf.current = requestAnimationFrame(step);
      else setMoving(false);
    };
    raf.current = requestAnimationFrame(step);
  };
  /** Move the camera to `to` (null: back to the fit of the focus), animated unless the map is still. */
  const flyTo = (to: View | null) => {
    const target = to ? clamp(to) : fit;
    setMoving(!(still || reduced));
    setCam(to ? target : null);
    fly(target);
  };

  // A new focus (the neighbourhood filter, or the selected lot's neighbourhood): zoom to it from wherever the
  // camera is. Declared before the effect below so the move starts from the old live view.
  const lastFocus = useRef(focusKey);
  useLayoutEffect(() => {
    if (lastFocus.current === focusKey) return;
    lastFocus.current = focusKey;
    shownRef.current = fit;
    if (still) {
      cancelAnimationFrame(raf.current);
      setCam(null);
      live.current = fit;
      return;
    }
    setCam(null);
    fly(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Every render: the SVG is laid out for `shown`; unless the camera is moving, the live view is `shown`.
  useLayoutEffect(() => {
    shownRef.current = shown;
    if (!moving.current) live.current = shown;
    applyLive();
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // The focus's fit changes with the pane's size: a camera the reader set keeps its centre and relative zoom.
  const lastW = useRef(w);
  useLayoutEffect(() => {
    if (lastW.current === w) return;
    const f = w / lastW.current;
    lastW.current = w;
    if (cam) setCam(clamp({ k: cam.k * f, ox: cam.ox * f, oy: cam.oy * f }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w]);

  // ── Gestures: wheel and pinch zoom, drag to pan; a drag never selects ──
  const gesture = useRef<{ pts: Map<number, XY>; start: View; startPts: Map<number, XY>; dragged: boolean; suppress: boolean }>({ pts: new Map(), start: shown, startPts: new Map(), dragged: false, suppress: false });
  const commitTimer = useRef(0);
  const commit = () => {
    window.clearTimeout(commitTimer.current);
    setMoving(false);
    const v = live.current;
    setCam(sameView(v, fit) ? null : v);
  };
  const liveFrame = useRef(0);
  const frame = () => {
    if (liveFrame.current) return;
    liveFrame.current = requestAnimationFrame(() => {
      liveFrame.current = 0;
      applyLive();
    });
  };
  const local = (e: { clientX: number; clientY: number }): XY => {
    // In layout px: under record and present mode's CSS zoom the rect is zoomed and the map's own units are not,
    // so a wheel zoomed about the wrong point (the Hill came out as Greenfield).
    const el = wrap.current!;
    const b = el.getBoundingClientRect();
    const s = el.clientWidth ? b.width / el.clientWidth : 1;
    return [(e.clientX - b.left) / s, (e.clientY - b.top) / s];
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el || still) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(raf.current);
      const [x, y] = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1;
      // A trackpad pinch arrives as a wheel with ctrlKey: finer steps.
      const f = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
      setMoving(true);
      live.current = zoomAt(live.current, f, x, y);
      frame();
      window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(commit, 180);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (still || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const G = gesture.current;
    cancelAnimationFrame(raf.current);
    G.pts.set(e.pointerId, local(e));
    G.startPts = new Map(G.pts);
    G.start = live.current;
    if (G.pts.size === 1) G.dragged = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const G = gesture.current;
    if (!G.pts.has(e.pointerId)) return onMove(e);
    G.pts.set(e.pointerId, local(e));
    const ids = [...G.pts.keys()];
    if (ids.length === 1) {
      const a0 = G.startPts.get(ids[0])!;
      const a1 = G.pts.get(ids[0])!;
      const dx = a1[0] - a0[0];
      const dy = a1[1] - a0[1];
      if (!G.dragged && Math.hypot(dx, dy) < 4) return;
      if (!G.dragged) {
        G.dragged = true;
        setMoving(true);
        if (hover.current) hover.current.hidden = true;
        e.currentTarget.style.cursor = 'grabbing';
      }
      live.current = clamp({ k: G.start.k, ox: G.start.ox + dx, oy: G.start.oy + dy });
    } else {
      // Two fingers: zoom by the change in their distance, around their midpoint, and pan with it.
      const [i, j] = ids;
      const a0 = G.startPts.get(i) ?? G.pts.get(i)!;
      const b0 = G.startPts.get(j) ?? G.pts.get(j)!;
      const a1 = G.pts.get(i)!;
      const b1 = G.pts.get(j)!;
      const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
      const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) || 1;
      const m0: XY = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
      const m1: XY = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
      G.dragged = true;
      setMoving(true);
      const z = zoomAt(G.start, d1 / d0, m0[0], m0[1]);
      live.current = clamp({ k: z.k, ox: z.ox + m1[0] - m0[0], oy: z.oy + m1[1] - m0[1] });
    }
    frame();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const G = gesture.current;
    if (!G.pts.has(e.pointerId)) return;
    G.pts.delete(e.pointerId);
    G.startPts = new Map(G.pts);
    G.start = live.current;
    if (G.pts.size === 0) {
      e.currentTarget.style.cursor = '';
      if (G.dragged) {
        G.suppress = true; // the click that ends a drag selects nothing
        commit();
      }
    }
  };

  // The inset's real height, so the leader line lands on the card, not below it.
  const insetEl = useRef<HTMLDivElement>(null);
  const [insetH, setInsetH] = useState(0);
  useLayoutEffect(() => {
    const el = insetEl.current;
    if (!el) return;
    const read = () => setInsetH(el.offsetHeight);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [!!p.inset]);
  const sel = p.selected != null && p.selected < p.lots.length ? ([pos.xs[p.selected], pos.ys[p.selected]] as XY) : null;
  const selOn = !!sel && sel[0] >= 0 && sel[0] <= w && sel[1] >= 0 && sel[1] <= h;
  const insetLeft = !!sel && sel[0] > w / 2;
  // A wide (plan) inset takes the side with more room and never covers its own dot: it stops 36 px short.
  const room = sel ? (insetLeft ? sel[0] - 36 - 14 : w - 14 - (sel[0] + 36)) : w;
  const insetW = p.insetWide
    ? Math.max(Math.min(240, w * 0.4), Math.min(p.present ? 520 : 440, w * 0.56, room))
    : p.present
      ? Math.min(400, w * 0.52)
      : Math.min(304, w * 0.46);
  const insetBox: [number, number, number, number] | null = p.inset ? (insetLeft ? [14, 42, 14 + insetW, h - 42] : [w - 14 - insetW, 42, w - 14, h - 42]) : null;

  // River names in italic, at the widest-looking interior point we can find cheaply: the midpoint
  // of the longest ring's bounding box if it lies in the water, else skipped (never on land).
  const riverLabels = useMemo(() => {
    const out: { name: string; x: number; y: number }[] = [];
    for (const wt of water) {
      const ring = [...wt.rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
      if (!ring) continue;
      let bx: Box = EMPTY;
      for (const q of ring) bx = grow(bx, q);
      const tries: XY[] = [
        [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2],
        ...[0.3, 0.7, 0.2, 0.8].flatMap((f) => [0.5, 0.35, 0.65].map((g2): XY => [bx[0] + (bx[2] - bx[0]) * f, bx[1] + (bx[3] - bx[1]) * g2])),
      ];
      const inside = tries.find((q) => inRing(q, ring));
      if (!inside) continue;
      const [x, y] = toPx(inside);
      if (x < 40 || x > w - 40 || y < 40 || y > h - 40) continue;
      out.push({ name: wt.name, x, y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [water, shown.k, shown.ox, shown.oy, w, h]);

  // Neighborhood lettering: the busiest neighborhoods, greedily placed without overlaps (and never
  // under the selected lot's card).
  const labels = useMemo(() => {
    const fs = p.present ? 13 : w < 520 ? 9.5 : 10.5;
    const rfs = p.present ? 15 : 12.5;
    const placed: [number, number, number, number][] = [
      ...(insetBox ? [insetBox] : []),
      ...riverLabels.map((l): [number, number, number, number] => [l.x - (l.name.length * rfs * 0.5) / 2, l.y - rfs, l.x + (l.name.length * rfs * 0.5) / 2, l.y + 3]),
    ];
    const out: { name: string; x: number; y: number }[] = [];
    const list = [...p.hoods.values()].sort((a, b) => b.lots - a.lots);
    const zoomedIn = !!p.focus || shown.k > cityFit.k * 2;
    const max = w < 520 ? (zoomedIn ? 5 : 7) : zoomedIn ? 10 : p.present ? 10 : 16;
    // How many dots a label box would hide.
    const covers = (b: [number, number, number, number]) => {
      let c = 0;
      for (let i = 0; i < pos.xs.length; i++) if (pos.xs[i] >= b[0] - 3 && pos.xs[i] <= b[2] + 3 && pos.ys[i] >= b[1] - 3 && pos.ys[i] <= b[3] + 3) c++;
      return c;
    };
    for (const hd of list) {
      if (out.length >= max) break;
      if (!zoomedIn && hd.lots === 0) continue;
      if (hd.name === p.focus) continue; // the plate's title already names it
      const tw = hd.name.length * fs * 0.62 + 6;
      const at = (x: number, y: number): [number, number, number, number] => [x - tw / 2, y - fs, x + tw / 2, y + 3];
      // Candidates: the outline's center, then just above and just below the neighborhood's dots.
      const [cx, cy] = toPx(hd.anchor);
      const top = toPx([0, hd.lotBox[1]])[1];
      const bottom = toPx([0, hd.lotBox[3]])[1];
      const lx = hd.lots ? toPx([(hd.lotBox[0] + hd.lotBox[2]) / 2, 0])[0] : cx;
      const cands: [number, number][] = [...(hd.rings.length ? [[cx, cy] as [number, number]] : []), ...(hd.lots ? [[lx, top - 8] as [number, number], [lx, bottom + fs + 6] as [number, number]] : [])];
      let best: { x: number; y: number; box: [number, number, number, number]; hidden: number } | null = null;
      for (const [k, [x, y]] of cands.entries()) {
        const box = at(x, y);
        if (box[0] < 10 || box[2] > w - 10 || box[1] < 34 || box[3] > h - 44) continue;
        // Zoomed in, a name reads as a place: above or below the dots it must not land inside another neighbourhood
        // (Troy Hill's lowest lots are on the river bank, and "just below" them put its name across the Allegheny,
        // on the Strip District). Citywide, a name above its cluster labels the cluster, as before.
        if (zoomedIn && k > 0 && hd.rings.length) {
          const q: XY = [(x - shown.ox) / shown.k, (y - fs / 2 - shown.oy) / shown.k];
          if (!hd.rings.some((ring) => inRing(q, ring)) && [...p.hoods.values()].some((o) => o !== hd && o.rings.some((ring) => inRing(q, ring)))) continue;
        }
        if (placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3]))) continue;
        const hidden = covers(box);
        if (!best || hidden < best.hidden) best = { x, y, box, hidden };
        if (hidden === 0) break;
      }
      if (!best) continue;
      placed.push(best.box);
      out.push({ name: hd.name, x: best.x, y: best.y });
    }
    return { items: out, fs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.hoods, shown.k, shown.ox, shown.oy, pos, p.present, w, h, p.focus, insetBox?.join(','), riverLabels]);

  const hitLot = (x: number, y: number, radius: number): number | null => {
    let best = -1;
    let bd = radius * radius;
    for (let i = 0; i < pos.xs.length; i++) {
      const dx = pos.xs[i] - x;
      const dy = pos.ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  };
  const hitHood = (x: number, y: number): string | null => {
    const q: XY = [(x - shown.ox) / shown.k, (y - shown.oy) / shown.k];
    for (const hd of p.hoods.values()) if (hd.rings.some((ring) => inRing(q, ring))) return hd.name;
    return null;
  };

  const onClick = (e: React.MouseEvent) => {
    if (gesture.current.suppress) {
      gesture.current.suppress = false;
      return;
    }
    const [x, y] = local(e);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const i = hitLot(x, y, coarse ? 14 : Math.max(8, r + 4));
    if (i != null) return p.onSelect(i);
    const hd = hitHood(x, y);
    if (hd && hd !== p.focus) return p.onZoom(hd);
    p.onSelect(null);
  };
  const onMove = (e: React.PointerEvent | React.MouseEvent) => {
    if (!hoverOn || moving.current) return;
    const el = hover.current;
    const [x, y] = local(e);
    const i = hitLot(x, y, Math.max(8, r + 4));
    let text = '';
    if (i != null) text = `${p.lots[i].addr} · ${STYLE[p.classes[i].blocker].words}`;
    else {
      const hd = hitHood(x, y);
      if (hd && hd !== p.focus) text = `${hd} · ${n(p.hoods.get(hd)?.lots ?? 0)} ${p.hoods.get(hd)?.lots === 1 ? 'lot' : 'lots'} · click to zoom`;
    }
    (e.currentTarget as HTMLElement).style.cursor = i != null ? 'pointer' : text ? 'zoom-in' : still ? 'default' : 'grab';
    if (!el) return;
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
    const left = Math.min(x + 12, w - el.offsetWidth - 6);
    el.style.transform = `translate(${Math.max(6, left)}px, ${Math.max(6, y - 28)}px)`;
  };

  // The controls: + and − zoom about the centre; Whole city goes back out (and clears a neighbourhood filter).
  const zoomBy = (f: number) => flyTo(zoomAt(live.current, f, w / 2, h / 2));
  const wholeCity = () => {
    if (p.focus && p.focusIsFilter) p.onZoom(null); // the filter goes; the focus change flies out
    else flyTo(sameView(cityFit, fit) ? null : cityFit);
  };
  const atCity = sameView(shown, cityFit) && !p.focus;

  const selStyle = p.selected != null ? STYLE[p.classes[p.selected]?.blocker ?? 'rules'] : null;

  // Scale bar: a round length, 60–170 px long; miles at city scale, feet at block scale.
  const pxPerMile = shown.k / MI_PER_DEG_LAT;
  const minPx = w < 520 ? 60 : 84;
  const steps: { mi: number; label: (f: number) => string; unit: string }[] = [
    ...[50, 100, 200, 500, 1000].map((ft) => ({ mi: ft / 5280, label: (f: number) => String(Math.round(ft * f)), unit: 'ft' })),
    ...[0.5, 1, 2, 4].map((m) => ({ mi: m, label: (f: number) => String(m * f).replace(/^0\./, '.'), unit: 'mi' })),
  ];
  const step = steps.find((x) => x.mi * pxPerMile >= minPx) ?? steps[steps.length - 1];
  const sbLen = step.mi * pxPerMile;

  return (
    <div className={`city-plate ${p.present ? 'is-present' : ''}${still ? ' is-still' : ''}`} ref={wrap} style={{ height: h }} role="group" aria-label={p.label}>
      {/* A still map keeps the old cut (a 160 ms crossfade) between neighbourhoods; a live one zooms. */}
      <div key={still ? view.key : 'stage'} className="city-stage">
        <canvas
          ref={canvas}
          className={`city-dots${p.stacked ? ' is-stacked' : ''}`}
          style={{ width: w, height: h }}
          aria-hidden="true"
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseLeave={() => hover.current && (hover.current.hidden = true)}
        />
        <svg className="city-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <g ref={moveG} className="city-move">
            <g className="hoods">
              {[...p.hoods.values()]
                .filter((hd) => hd.rings.length)
                .map((hd) => (
                  <path
                    key={hd.name}
                    className={`hood-line ${hd.name === p.focus ? 'is-focus' : ''}`}
                    d={hd.rings.map((ring) => `M${ring.map((q) => toPx(q).map((v) => v.toFixed(1)).join(' ')).join('L')}Z`).join('')}
                  />
                ))}
            </g>
            <g className="river-names">
              {riverLabels.map((l) => (
                <text key={l.name} x={l.x} y={l.y} textAnchor="middle" fontSize={p.present ? 15 : 12.5} className="river-name">
                  {l.name}
                </text>
              ))}
            </g>
            <g className="hood-names">
              {labels.items.map((l) => (
                <text key={l.name} x={l.x} y={l.y} textAnchor="middle" fontSize={labels.fs} className="hood-name">
                  {l.name.toUpperCase()}
                </text>
              ))}
            </g>
            {sel && selOn && selStyle && (
              <g className="sel-mark" transform={`translate(${sel[0]} ${sel[1]})`}>
                <circle r={2.5} className={`sel-dot bk-${selStyle.id}`} />
                <circle r={8} className="sel-ring" />
                {[0, 90, 180, 270].map((a) => (
                  <line key={a} x1={0} y1={-11} x2={0} y2={-17} transform={`rotate(${a})`} className="sel-tick" />
                ))}
              </g>
            )}
          </g>
          {sel && selOn && insetBox && p.insetWide && (
            // The leader line (spec §0.15 P2): from the selected lot to the edge of its inset plan (hidden mid-move).
            <line
              className="inset-leader"
              x1={sel[0]}
              y1={sel[1]}
              x2={insetLeft ? insetBox[2] : insetBox[0]}
              y2={Math.max(insetBox[1] + 16, Math.min(Math.min(insetBox[3], insetBox[1] + (insetH || insetBox[3] - insetBox[1])) - 16, sel[1]))}
            />
          )}
          <g className="map-chrome">
            <text x={18} y={30} className="map-title" fontSize={p.present ? 15 : 12}>
              {p.focus ? p.focus.toUpperCase() : 'CITY OF PITTSBURGH'}
            </text>
            <g transform={`translate(${w - 34} ${h - 34})`} className="north">
              <circle r={11} className="north-ring" />
              <path d="M0 -9 L3.2 5 L0 2.5 L-3.2 5 Z" className="north-arrow" />
              <text y={-15} fontSize={p.present ? 13 : 10} textAnchor="middle" className="north-n">
                N
              </text>
            </g>
            <g transform={`translate(22 ${h - 20})`} className="scale-bar">
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={(i * sbLen) / 4} y={0} width={sbLen / 4} height={3.2} className={i % 2 ? 'sb-empty' : 'sb-full'} />
              ))}
              {[0, 0.5, 1].map((f) => (
                <text key={f} x={f * sbLen} y={-4} fontSize={p.present ? 13 : 10.5} textAnchor="middle" className="sb-num">
                  {f === 0 ? '0' : step.label(f)}
                  {f === 1 ? ` ${step.unit}` : ''}
                </text>
              ))}
            </g>
          </g>
        </svg>
      </div>
      {!still && (
        // Opposite the inset, so the card never covers them: bottom right, or above the scale bar when the card is on the right.
        <div className={`map-controls${p.inset && !insetLeft ? ' is-left' : ''}`} role="group" aria-label="Map zoom">
          <button type="button" className="map-ctl" data-map-control="zoom-in" aria-label="Zoom in" title="Zoom in (or scroll, or pinch)" onClick={() => zoomBy(STEP)}>
            +
          </button>
          <button type="button" className="map-ctl" data-map-control="zoom-out" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / STEP)}>
            −
          </button>
          <button
            type="button"
            className="map-ctl is-text"
            data-map-control="whole-city"
            disabled={atCity}
            title={p.focus && p.focusIsFilter ? `Back out to the whole city (clears the ${p.focus} filter)` : 'Back out to the whole city'}
            onClick={wholeCity}
          >
            Whole city
          </button>
        </div>
      )}
      {p.inset && (
        <div
          ref={insetEl}
          className={`city-inset ${insetLeft ? 'is-left' : 'is-right'}${p.insetWide ? ' is-wide' : ''}${p.onInsetOpen ? '' : ' is-static'}`}
          style={p.insetWide ? { width: insetW } : undefined}
          onDoubleClick={p.onInsetOpen}
          title={p.onInsetOpen ? 'Double-click to open the plan' : undefined}
        >
          <InsetRoom.Provider value={{ w: Math.max(120, insetW - 22), maxH: Math.max(120, h - 84 - 16 - 34) }}>{p.inset}</InsetRoom.Provider>
        </div>
      )}
      <div className="city-hover" ref={hover} hidden aria-hidden="true" />
      <span className="city-probe" ref={probe} aria-hidden="true" />
    </div>
  );
}
