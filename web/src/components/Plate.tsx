// The plate: an atlas drawing of one block. SVG is the data; the canvas under it is decoration.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { centroid, openRing, sub, unit } from '@engine/geom';
import type { BlockFile, LotResult, Parcel, Pt, Ring } from '@engine/types';
import { TEMPLATES } from '@engine/templates';
import { cssVar, deform, hash, ringPath, useBoil, useTweenRing } from '../lib/craft';
import { lotKey } from '../lib/model';

export interface PlateLot {
  parcel: Parcel;
  result: LotResult;
}

interface Props {
  block: BlockFile;
  frameLots: Parcel[]; // lots that define the frame (the main row)
  row: PlateLot[]; // single-lot results for every lot on the row, current type
  selected: LotResult; // the scenario being looked at
  onSelect: (p: Parcel) => void;
  present: boolean;
  record: boolean;
  still: boolean;
  slope: boolean;
  focus?: string[]; // crop to these pins (phone)
  label: string;
  hideSelection?: boolean; // block view: no selected lot, no proposal outline
}

const PAD = { top: 16, bottom: 40, side: 16 };

function bbox(rings: Ring[]): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}

function frontSide(r: LotResult): { a: Pt; b: Pt; setback: number } | null {
  const f = r.sides.find((s) => s.kind === 'front');
  return f ? { a: f.a, b: f.b, setback: f.setback ?? 0 } : null;
}

/** Point `along` feet from the front midpoint along the front, `inward` feet into the lot. */
function frontPoint(f: { a: Pt; b: Pt }, inward: number, along = 0): Pt {
  const u = unit(sub(f.b, f.a));
  const n: Pt = [-u[1], u[0]];
  const m: Pt = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  return [m[0] + n[0] * inward + u[0] * along, m[1] + n[1] * inward + u[1] * along];
}

function proposalRect(f: { a: Pt; b: Pt; setback: number }, w: number, d: number): Ring {
  const u = unit(sub(f.b, f.a));
  const n: Pt = [-u[1], u[0]];
  const m: Pt = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  const p = (along: number, inward: number): Pt => [m[0] + u[0] * along + n[0] * inward, m[1] + u[1] * along + n[1] * inward];
  return [p(-w / 2, f.setback), p(w / 2, f.setback), p(w / 2, f.setback + d), p(-w / 2, f.setback + d)];
}

function statusClass(r: LotResult): string {
  if (r.state !== 'ok') return 'refused';
  const w = r.checks.find((c) => c.id === 'width')!;
  if (w.trust === 'red') return w.status === 'pass' ? 'fits assumed' : 'short assumed';
  if (w.status === 'open' || w.trust === 'pencil') return 'open';
  return w.status === 'pass' ? 'fits' : 'short';
}

function Envelope({ ring, cls, anchor, ms, filter }: { ring: Ring; cls: string; anchor?: Pt; ms: number; filter?: string }) {
  const shown = useTweenRing(ring, ms, anchor);
  if (shown.length < 3) return null;
  return <path className={`env ${cls}`} d={ringPath(shown)} filter={filter} />;
}

export function Plate(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const boil = useBoil(!p.still);

  // Frame: the main row plus pads, or the focus lots on a phone.
  const frame = useMemo(() => {
    const focusParcels = p.focus?.length ? p.block.parcels.filter((x) => p.focus!.includes(x.pin)) : null;
    const rings = (focusParcels ?? p.frameLots).map((x) => openRing(x.poly[0]));
    const [x0, y0, x1, y1] = bbox(rings);
    const side = focusParcels ? 10 : PAD.side;
    return { x: x0 - side, y: y0 - PAD.top, w: x1 - x0 + side * 2, h: y1 - y0 + PAD.top + PAD.bottom };
  }, [p.block, p.frameLots, p.focus?.join(',')]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      // A hidden pane reports 0 px: keep the last size rather than scale everything to Infinity.
      if (!(w > 0) || !(frame.w > 0)) return;
      setSize({ w, h: (w * frame.h) / frame.w });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame.w, frame.h]);

  const k = frame.w > 0 && size.w > 0 ? size.w / frame.w : 1; // px per foot (guarded: never Infinity)
  const px = (n: number) => n / k; // px → feet (user units)
  const ms = p.still ? 0 : p.record ? 280 : 320;

  const selectedPins = new Set(p.hideSelection ? [] : p.selected.pins);
  const multi = !p.hideSelection && p.selected.pins.length > 1;
  const type = p.selected.scenario.type;
  const theme = typeof document !== 'undefined' ? document.documentElement.dataset.theme ?? '' : '';

  // Watercolor washes on the canvas: buildings by material, and a faint wash on the selection.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr * k, 0, 0, dpr * k, -frame.x * dpr * k, -frame.y * dpr * k);
    g.clearRect(frame.x, frame.y, frame.w, frame.h);
    const alpha = Number(cssVar('--wash-alpha')) || 0.05;
    const color = (m: string | null) => cssVar(m === 'Frame' ? '--frame' : m === 'Brick' ? '--brick' : '--stone');
    const wash = (ring: Ring, col: string, seedKey: string, layers = 14, amp = 1.2) => {
      g.save();
      g.beginPath();
      ring.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.clip();
      g.fillStyle = col;
      g.globalAlpha = alpha * 1.5;
      for (let l = 0; l < layers; l++) {
        const d = deform(ring, hash(`${seedKey}:${l}`), amp);
        g.beginPath();
        d.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
      }
      g.restore();
    };
    for (const b of p.block.buildings) wash(openRing(b.poly[0]), color(b.material), b.id);
  }, [p.block, size.w, size.h, k, frame.x, frame.y, frame.w, frame.h, theme]);

  const streetsSeen = new Set<string>();
  const streetLabels = p.block.streets
    .map((s) => {
      // Longest segment inside the frame.
      let best: { a: Pt; b: Pt; len: number } | null = null;
      for (let i = 0; i + 1 < s.line.length; i++) {
        const a = s.line[i];
        const b = s.line[i + 1];
        // Clip the segment to the frame's x range (and skip it if it misses the frame).
        const fx0 = frame.x;
        const fx1 = frame.x + frame.w;
        if (Math.max(a[0], b[0]) < fx0 || Math.min(a[0], b[0]) > fx1) continue;
        if (Math.max(a[1], b[1]) < frame.y - 5 || Math.min(a[1], b[1]) > frame.y + frame.h + 5) continue;
        const lerp = (x: number): Pt => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-9)];
        const ca: Pt = Math.abs(b[0] - a[0]) > 1 ? lerp(Math.max(fx0, Math.min(a[0], b[0]))) : a;
        const cb: Pt = Math.abs(b[0] - a[0]) > 1 ? lerp(Math.min(fx1, Math.max(a[0], b[0]))) : b;
        const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
        if (!best || len > best.len) best = { a: ca, b: cb, len };
      }
      return best ? { name: s.name, ...best } : null;
    })
    .filter((x): x is { name: string; a: Pt; b: Pt; len: number } => !!x && x.len > Math.min(60, frame.w * 0.5))
    .sort((a, b) => b.len - a.len)
    .filter((s) => (streetsSeen.has(s.name) ? false : (streetsSeen.add(s.name), true)));

  const clipX = (x: number) => Math.max(frame.x + px(40), Math.min(frame.x + frame.w - px(40), x));
  const clipY = (y: number) => Math.max(frame.y + px(14), Math.min(frame.y + frame.h - px(10), y));

  const hatch = px(p.present ? 5.2 : 3.4);
  const fs = (n: number) => px(p.present && !p.record ? n * 1.2 : n);
  const selFront = frontSide(p.selected);
  const P = p.selected.scenario.proposal;
  const north = p.block.meta.rotation_deg;

  return (
    <div className={`plate ${p.present ? 'is-present' : ''}`} ref={wrap} style={{ height: size.h }}>
      <canvas ref={canvas} className="plate-wash" style={{ width: size.w, height: size.h }} aria-hidden="true" />
      <svg className="plate-svg" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} width={size.w} height={size.h} aria-label={p.label}>
        <defs>
          {(['ink', 'red', 'graphite'] as const).map((c) => (
            <pattern key={c} id={`hatch-${c}`} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2={hatch} className={`hatch-line hatch-${c}`} style={{ strokeWidth: px(p.present ? 0.7 : 0.8) }} />
            </pattern>
          ))}
          <pattern id="hatch-slope" patternUnits="userSpaceOnUse" width={hatch * 2.2} height={hatch * 2.2} patternTransform="rotate(-30)">
            <line x1="0" y1="0" x2="0" y2={hatch * 2.2} className="hatch-line hatch-slope" style={{ strokeWidth: px(0.6) }} />
          </pattern>
          {[0, 1, 2, 3, 4].map((i) => (
            <filter key={i} id={`boil-${i}`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency={0.035 / k} numOctaves={2} seed={i * 7 + boil} />
              <feDisplacementMap in="SourceGraphic" scale={px(1.4)} />
            </filter>
          ))}
          <clipPath id="plate-clip">
            <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} />
          </clipPath>
        </defs>

        <g clipPath="url(#plate-clip)">
          {/* Streets: names along the centerline. */}
          {streetLabels.map((s) => {
            const horizontal = Math.abs(s.b[0] - s.a[0]) >= Math.abs(s.b[1] - s.a[1]);
            const m: Pt = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
            let ang = (Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180) / Math.PI;
            if (ang > 90) ang -= 180;
            if (ang < -90) ang += 180;
            const vertical = !horizontal;
            if (vertical && (p.present || p.record)) {
              // Presentation: no rotated text; a horizontal tag at the street's top end.
              return (
                <text key={s.name} className="street-name" x={clipX(m[0])} y={frame.y + px(12)} fontSize={fs(10)} textAnchor="middle">
                  {s.name.replace(/ Street$/, ' St').toUpperCase()}
                </text>
              );
            }
            return (
              <text
                key={s.name}
                className="street-name"
                x={clipX(m[0])}
                y={clipY(m[1])}
                fontSize={fs(horizontal ? 12 : 10)}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${ang} ${clipX(m[0])} ${clipY(m[1])})`}
              >
                {s.name.toUpperCase()}
              </text>
            );
          })}

          {/* Slope 25%+ (toggle). */}
          {p.slope && p.block.slope.map((poly, i) => <path key={i} d={poly.map((r) => ringPath(openRing(r))).join(' ')} className="slope" fill="url(#hatch-slope)" fillRule="evenodd" />)}

          {/* Lots. */}
          {p.block.parcels.map((x) => {
            const r = openRing(x.poly[0]);
            const inRow = p.row.find((rr) => rr.parcel.pin === x.pin);
            const sel = selectedPins.has(x.pin);
            const label = `${x.addr}, lot ${lotKey(x)}${inRow ? `, ${describe(inRow.result)}` : ''}`;
            return (
              <g
                key={x.pin}
                className={`lot ${sel ? 'is-selected' : ''} ${multi && sel ? 'in-group' : ''}`}
                role="button"
                tabIndex={inRow ? 0 : -1}
                aria-label={label}
                aria-pressed={sel}
                onClick={() => p.onSelect(x)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    p.onSelect(x);
                  }
                }}
              >
                <path d={ringPath(r)} className="lot-line" />
              </g>
            );
          })}

          {/* Every lot on the row shows its own envelope for the chosen building type. */}
          {p.row.map(({ parcel, result }) => {
            if (multi && selectedPins.has(parcel.pin)) return null;
            if (result.state !== 'ok') return null;
            const cls = statusClass(result);
            const env = result.envelope.poly;
            const f = frontSide(result);
            return <Envelope key={parcel.pin} ring={env} cls={`${cls} ${selectedPins.has(parcel.pin) ? 'is-selected' : ''}`} anchor={f?.a} ms={ms} filter={cls === 'open' && !p.still ? `url(#boil-${hash(parcel.pin) % 5})` : undefined} />;
          })}

          {/* The selected group: one envelope (combined) or one per unit (rowhouses). */}
          {multi && p.selected.state === 'ok' &&
            (type === 'row'
              ? p.selected.units.map((u) => {
                  const w = p.selected.checks.find((c) => c.id === 'width')!;
                  const cls = !u.end ? 'fits' : w.trust === 'pencil' ? 'open' : w.trust === 'red' ? (w.status === 'pass' ? 'fits assumed' : 'short assumed') : (u.width.deed ?? 0) >= P.width ? 'fits' : 'short';
                  return <Envelope key={`unit-${u.pin}`} ring={u.envelope} cls={`${cls} is-selected`} anchor={u.front?.a} ms={ms} filter={cls === 'open' && !p.still ? `url(#boil-${hash(u.pin) % 5})` : undefined} />;
                })
              : [<Envelope key="group" ring={p.selected.envelope.poly} cls={`${statusClass(p.selected)} is-selected`} anchor={selFront?.a} ms={ms} />])}

          {/* Group outline and merged lot lines. */}
          {multi && <path d={ringPath(p.selected.lot_poly)} className="group-line" />}

          {/* The proposal, in red: the building you want. */}
          {!p.hideSelection && p.selected.state === 'ok' &&
            (type === 'row'
              ? p.selected.units.map((u) => (u.front ? <path key={`prop-${u.pin}`} d={ringPath(proposalRect(u.front, P.width, P.depth))} className="proposal" /> : null))
              : selFront && <path d={ringPath(proposalRect(selFront, P.width, P.depth))} className="proposal" />)}

          {/* Labels on every row lot. */}
          {p.row.map(({ parcel, result }) => {
            const f = frontSide(result);
            const r = openRing(parcel.poly[0]);
            const c = centroid(r);
            const sel = selectedPins.has(parcel.pin);
            const rearY = Math.min(...r.map((q) => q[1]));
            const frontMid: Pt = f ? [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2] : [c[0], Math.max(...r.map((q) => q[1]))];
            const planLot = parcel.deed?.plan_lot;
            const w = result.width;
            const wv = w ? w.deed ?? w.mapped : null;
            const cls = statusClass(result);
            const inGroup = multi && sel;
            return (
              <g key={`lab-${parcel.pin}`} className={`lot-labels ${sel ? 'is-selected' : ''}`} aria-hidden="true">
                <text x={c[0]} y={rearY + px(18)} className="plan-lot" fontSize={fs(14)} textAnchor="middle">
                  {planLot ?? ''}
                </text>
                <text x={c[0]} y={rearY + px(30)} className="county-lot" fontSize={fs(9.5)} textAnchor="middle">
                  {lotKey(parcel)}
                </text>
                {parcel.city && (
                  <circle cx={frontMid[0]} cy={frontMid[1] - px(9)} r={px(3.6)} className={`coin ${parcel.city.status === 'Available for Sale' ? 'is-sale' : 'is-held'}`} />
                )}
                {!inGroup && result.state === 'ok' && wv != null && (
                  <text x={frontMid[0]} y={frontMid[1] - px(22)} className={`env-width ${cls}`} fontSize={fs(13)} textAnchor="middle">
                    {Math.round(wv * 10) / 10}
                    <tspan className="unit">′</tspan>
                  </text>
                )}
                {result.state !== 'ok' && (
                  <text x={frontMid[0]} y={frontMid[1] - px(22)} className={`cant ${result.refusal?.code === 'records_disagree' ? '' : 'is-grey'}`} fontSize={fs(8.5)} textAnchor="middle">
                    {result.refusal?.code === 'records_disagree' ? 'CAN’T' : result.refusal?.code === 'missing_rule' ? 'NO' : 'NOT'}
                    <tspan x={frontMid[0]} dy={fs(9)}>
                      {result.refusal?.code === 'records_disagree' ? 'SCORE' : result.refusal?.code === 'missing_rule' ? 'RULES' : 'SCORED'}
                    </tspan>
                  </text>
                )}
                {parcel.deed && (
                  <text x={frontMid[0]} y={frontMid[1] + px(11)} className="frontage" fontSize={fs(10)} textAnchor="middle">
                    {parcel.deed.front}
                  </text>
                )}
              </g>
            );
          })}

          {/* The selected group's width, large, inside its envelope. */}
          {multi && p.selected.state === 'ok' && p.selected.width && (() => {
            const f = selFront!;
            const at = frontPoint(f, f.setback + P.depth / 2 + 4);
            const v = type === 'row' ? null : p.selected.width.deed ?? p.selected.width.mapped;
            return v != null ? (
              <g className="group-width" aria-hidden="true">
                <rect x={at[0] - px(34)} y={at[1] - px(15)} width={px(68)} height={px(26)} className="group-width-bg" />
                <text x={at[0]} y={at[1] + px(4)} fontSize={fs(19)} textAnchor="middle" className={`env-width big ${statusClass(p.selected)}`}>
                  {v} ft
                </text>
              </g>
            ) : null;
          })()}

        </g>

        {/* Frame, north arrow, scale bar. */}
        <rect x={frame.x + px(3)} y={frame.y + px(3)} width={frame.w - px(6)} height={frame.h - px(6)} className="plate-frame" />
        <g transform={`translate(${frame.x + frame.w - px(26)} ${frame.y + frame.h - px(20)}) rotate(${-north})`} className="north" aria-hidden="true">
          <circle r={px(11)} className="north-ring" />
          <path d={`M0 ${-px(9)} L${px(3.2)} ${px(5)} L0 ${px(2.5)} L${-px(3.2)} ${px(5)} Z`} className="north-arrow" />
          <text y={-px(14)} fontSize={fs(10)} textAnchor="middle" className="north-n" transform={`rotate(${north} 0 ${-px(14)})`}>
            N
          </text>
        </g>
        <g transform={`translate(${frame.x + px(22)} ${frame.y + frame.h - px(16)})`} className="scale-bar" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 25} y={0} width={25} height={px(3.2)} className={i % 2 ? 'sb-empty' : 'sb-full'} />
          ))}
          {[0, 50, 100].map((v) => (
            <text key={v} x={v} y={-px(3.5)} fontSize={fs(9)} textAnchor="middle" className="sb-num">
              {v}
              {v === 100 ? ' ft' : ''}
            </text>
          ))}
        </g>
      </svg>
      <p className="visually-hidden">
        {TEMPLATES[type].name}: the plate shows each lot's buildable envelope. {describe(p.selected)}
      </p>
    </div>
  );
}

function describe(r: LotResult): string {
  if (r.state !== 'ok') return `can't score: ${r.refusal?.reason ?? ''}`;
  const w = r.width!;
  return `${w.deed ?? w.mapped} ft of buildable width as of right`;
}
