// The city map: every City-owned vacant lot as a dot, colored by its first blocker. The canvas holds
// the dots (decoration of a computed answer: every dot is also a row in the table); the SVG over it
// holds outlines, lettering, the selection mark, the north arrow and the scale bar.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

type XY = [number, number];
const proj = (ll: readonly [number, number]): XY => [ll[0] * KX, -ll[1]];

type Box = [number, number, number, number]; // x0 y0 x1 y1 in projected units
function grow(b: Box, p: XY): Box {
  return [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])];
}
const EMPTY: Box = [Infinity, Infinity, -Infinity, -Infinity];

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
}

export function hoodIndex(lots: CityLotRow[], hoods: Hood[]): Map<string, HoodInfo> {
  const out = new Map<string, HoodInfo>();
  for (const h of hoods) {
    const rings = h.rings.map((r) => r.map(proj));
    if (!rings.length || !rings[0].length) continue;
    const big = [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
    let box = EMPTY;
    for (const r of rings) for (const p of r) box = grow(box, p);
    out.set(h.name, { name: h.name, lots: 0, rings, anchor: ringCentroid(big), box });
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
    if (h) h.lots = s.k;
    else out.set(name, { name, lots: s.k, rings: [], anchor: [s.x / s.k, s.y / s.k], box: s.box });
  }
  return out;
}

interface Props {
  lots: CityLotRow[];
  classes: CityClass[];
  hoods: Map<string, HoodInfo>;
  focus: string | null; // neighborhood zoomed to
  selected: number | null; // index into lots
  onSelect: (i: number | null) => void;
  onZoom: (hood: string | null) => void;
  present: boolean;
  record: boolean;
  label: string;
}

const PAD = 26;

export function CityMap(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const h = Math.round(w * ASPECT);
  const themeKey = useThemeKey();
  const hoverOn = !p.present && !p.record;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The view: the whole city, or one neighborhood (never smaller than ~0.6 mi across).
  const view = useMemo(() => {
    let box: Box = EMPTY;
    const f = p.focus ? p.hoods.get(p.focus) : null;
    if (f) {
      box = f.box;
      const min = 0.6 / MI_PER_DEG_LAT;
      const cx = (box[0] + box[2]) / 2;
      const cy = (box[1] + box[3]) / 2;
      const hw = Math.max((box[2] - box[0]) / 2, min / 2);
      const hh = Math.max((box[3] - box[1]) / 2, min / 2);
      box = [cx - hw, cy - hh, cx + hw, cy + hh];
    } else {
      const withRings = [...p.hoods.values()].filter((x) => x.rings.length);
      if (withRings.length) for (const x of withRings) box = grow(grow(box, [x.box[0], x.box[1]]), [x.box[2], x.box[3]]);
      else box = [PGH[0] * KX, -PGH[3], PGH[2] * KX, -PGH[1]];
      for (const l of p.lots) box = grow(box, proj(l.ll));
    }
    const bw = box[2] - box[0] || 1e-6;
    const bh = box[3] - box[1] || 1e-6;
    const k = Math.min((w - PAD * 2) / bw, (h - PAD * 2) / bh);
    const ox = (w - bw * k) / 2 - box[0] * k;
    const oy = (h - bh * k) / 2 - box[1] * k;
    return { k, ox, oy, key: p.focus ?? 'city' };
  }, [p.focus, p.hoods, p.lots, w, h]);

  const toPx = (q: XY): XY => [q[0] * view.k + view.ox, q[1] * view.k + view.oy];

  // Screen positions of every lot, for drawing and hit-testing.
  const pos = useMemo(() => {
    const xs = new Float32Array(p.lots.length);
    const ys = new Float32Array(p.lots.length);
    p.lots.forEach((l, i) => {
      const q = proj(l.ll);
      xs[i] = q[0] * view.k + view.ox;
      ys[i] = q[1] * view.k + view.oy;
    });
    return { xs, ys };
  }, [p.lots, view]);

  const r = p.focus ? 2.6 : 1.6; // 5px dots in a neighborhood, 3px citywide

  useEffect(() => {
    const c = canvas.current;
    const pr = probe.current;
    if (!c || !pr) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const col: Partial<Record<string, string>> = {};
    const color = (t: string) => (col[t] ??= resolveColor(pr, t));
    const groups = new Map<Blocker, number[]>();
    p.classes.forEach((c2, i) => {
      const x = pos.xs[i];
      const y = pos.ys[i];
      if (x < -8 || y < -8 || x > w + 8 || y > h + 8) return;
      const arr = groups.get(c2.blocker) ?? [];
      arr.push(i);
      groups.set(c2.blocker, arr);
    });
    for (const b of PAINT_ORDER) {
      const idx = groups.get(b);
      if (!idx?.length) continue;
      const st = STYLE[b];
      g.save();
      g.globalAlpha = st.alpha ?? 1;
      g.beginPath();
      for (const i of idx) {
        g.moveTo(pos.xs[i] + r, pos.ys[i]);
        g.arc(pos.xs[i], pos.ys[i], r, 0, Math.PI * 2);
      }
      if (st.hollow) {
        g.strokeStyle = color(st.token);
        g.lineWidth = p.focus ? 1.2 : 1;
        if (st.dashed) g.setLineDash(p.focus ? [1.6, 1.4] : [1.1, 1.1]);
        g.stroke();
      } else {
        g.fillStyle = color(st.token);
        g.fill();
      }
      if (st.ring) {
        g.beginPath();
        for (const i of idx) {
          g.moveTo(pos.xs[i] + r + 1.4, pos.ys[i]);
          g.arc(pos.xs[i], pos.ys[i], r + 1.4, 0, Math.PI * 2);
        }
        g.strokeStyle = color(st.ring);
        g.lineWidth = 1;
        g.stroke();
      }
      g.restore();
    }
  }, [p.classes, pos, w, h, r, themeKey, p.focus]);

  // Neighborhood lettering: the busiest neighborhoods, greedily placed without overlaps.
  const labels = useMemo(() => {
    const fs = p.present ? 13 : 10.5;
    const placed: [number, number, number, number][] = [];
    const out: { name: string; x: number; y: number; focus: boolean }[] = [];
    const list = [...p.hoods.values()].sort((a, b) => (b.name === p.focus ? 1 : 0) - (a.name === p.focus ? 1 : 0) || b.lots - a.lots);
    const max = p.focus ? 10 : p.present ? 10 : 16;
    for (const hd of list) {
      if (out.length >= max) break;
      if (!p.focus && hd.lots === 0) continue;
      const [x, y] = toPx(hd.anchor);
      const tw = hd.name.length * fs * 0.62 + 6;
      const box: [number, number, number, number] = [x - tw / 2, y - fs, x + tw / 2, y + 3];
      if (box[0] < 10 || box[2] > w - 10 || box[1] < 34 || box[3] > h - 44) continue;
      if (placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3]))) continue;
      placed.push(box);
      out.push({ name: hd.name, x, y, focus: hd.name === p.focus });
    }
    return { items: out, fs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.hoods, view, p.present, w, h, p.focus]);

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
    const q: XY = [(x - view.ox) / view.k, (y - view.oy) / view.k];
    for (const hd of p.hoods.values()) if (hd.rings.some((ring) => inRing(q, ring))) return hd.name;
    return null;
  };
  const local = (e: { clientX: number; clientY: number }): XY => {
    const b = wrap.current!.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };

  const onClick = (e: React.MouseEvent) => {
    const [x, y] = local(e);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const i = hitLot(x, y, coarse ? 14 : 8);
    if (i != null) return p.onSelect(i);
    const hd = hitHood(x, y);
    if (hd && hd !== p.focus) return p.onZoom(hd);
    p.onSelect(null);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!hoverOn) return;
    const el = hover.current;
    const [x, y] = local(e);
    const i = hitLot(x, y, 8);
    let text = '';
    if (i != null) text = `${p.lots[i].addr} · ${STYLE[p.classes[i].blocker].words}`;
    else {
      const hd = hitHood(x, y);
      if (hd && hd !== p.focus) text = `${hd} · ${n(p.hoods.get(hd)?.lots ?? 0)} ${p.hoods.get(hd)?.lots === 1 ? 'lot' : 'lots'} · click to zoom`;
    }
    (e.currentTarget as HTMLElement).style.cursor = i != null ? 'pointer' : text ? 'zoom-in' : 'default';
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

  const sel = p.selected != null && p.selected < p.lots.length ? ([pos.xs[p.selected], pos.ys[p.selected]] as XY) : null;
  const selStyle = p.selected != null ? STYLE[p.classes[p.selected]?.blocker ?? 'rules'] : null;

  // Scale bar: a round number of miles, 60–150 px long.
  const pxPerMile = view.k / MI_PER_DEG_LAT;
  const miles = [0.2, 0.5, 1, 2, 4].find((m) => m * pxPerMile >= 60) ?? 4;
  const sbLen = miles * pxPerMile;
  const fmtMi = (v: number) => (v < 1 ? String(v).replace(/^0/, '') : String(v));

  return (
    <div className={`city-plate ${p.present ? 'is-present' : ''}`} ref={wrap} style={{ height: h }} role="group" aria-label={p.label}>
      <div key={view.key} className="city-stage">
        <canvas ref={canvas} className="city-dots" style={{ width: w, height: h }} aria-hidden="true" onClick={onClick} onMouseMove={onMove} onMouseLeave={() => hover.current && (hover.current.hidden = true)} />
        <svg className="city-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
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
          <g className="hood-names">
            {labels.items.map((l) => (
              <text key={l.name} x={l.x} y={l.y} textAnchor="middle" fontSize={labels.fs * (l.focus ? 1.25 : 1)} className={`hood-name ${l.focus ? 'is-focus' : ''}`}>
                {l.name.toUpperCase()}
              </text>
            ))}
          </g>
          {sel && selStyle && (
            <g className="sel-mark" transform={`translate(${sel[0]} ${sel[1]})`}>
              <circle r={2.5} className={`sel-dot bk-${selStyle.id}`} />
              <circle r={8} className="sel-ring" />
              {[0, 90, 180, 270].map((a) => (
                <line key={a} x1={0} y1={-11} x2={0} y2={-17} transform={`rotate(${a})`} className="sel-tick" />
              ))}
            </g>
          )}
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
            {[0, miles / 2, miles].map((v, i) => (
              <text key={i} x={(v / miles) * sbLen} y={-4} fontSize={p.present ? 12 : 9.5} textAnchor="middle" className="sb-num">
                {v === 0 ? '0' : fmtMi(v)}
                {v === miles ? ' mi' : ''}
              </text>
            ))}
          </g>
        </svg>
      </div>
      <div className="city-hover" ref={hover} hidden aria-hidden="true" />
      <span className="city-probe" ref={probe} aria-hidden="true" />
    </div>
  );
}
