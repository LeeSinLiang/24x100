// The map's inset for a City lot without block detail (team review, round 3: "an inset for every lot"):
// the parcel outline and its immediate neighbours from the City parcel map, its width and depth, and the
// buildable area the setbacks leave (the lot engine's labelEdges + envelope, with the lot's own setbacks from
// the rule set: engine/src/outline.ts). It is labelled "plan detail: outline only": there are no buildings,
// no deed lot lines and no plan-lot numbers here, only what the citywide files hold.
import { useContext, useMemo } from 'react';
import type { CityClass } from '@engine/city';
import { outlinePlan, ringCentre } from '@engine/outline';
import { TEMPLATES } from '@engine/templates';
import type { Pt, Ring, RuleSet, TemplateId } from '@engine/types';
import { InsetRoom } from '../city/CityMap';
import type { CityLotRow } from '../city/cityData';
import { useLotOutline } from '../city/outlineData';
import { BLOCKS } from '../../lib/data';
import { ftFmt } from '../ui';

const path = (r: Ring) => (r.length ? `M${r.map((q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join('L')}Z` : '');
const line = (r: Pt[]) => (r.length ? `M${r.map((q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join('L')}` : '');

export function MapInsetOutline({ lot, cls, rs, type }: { lot: CityLotRow; cls: CityClass; rs: RuleSet | null; type: TemplateId }) {
  const data = useLotOutline(lot.pin);
  const room = useContext(InsetRoom);
  const plan = useMemo(() => (data.state === 'ready' ? outlinePlan(data.outline, lot, cls, rs, type) : null), [data, lot, cls, rs, type]);
  const blocks = Object.values(BLOCKS)
    .map((b) => b.meta.name.replace(/-/g, '‑'))
    .join(' and ');
  const head = (
    <p className="map-inset-head">
      <strong>{lot.addr}</strong>
      <span className="muted" data-inset="outline-only">
        plan detail: outline only
      </span>
    </p>
  );
  if (!plan)
    return (
      <div className="map-inset-plan map-inset-outline" data-inset-state={data.state}>
        {head}
        <p className="small muted" role="status">
          {data.state === 'loading' ? 'Loading the lot outline…' : `No outline: ${data.state === 'absent' ? data.why : ''}.`}
        </p>
      </div>
    );

  // The frame: the lot and a margin of its neighbours, the front along the bottom with room for its street.
  const xs = plan.ring.map((q) => q[0]);
  const ys = plan.ring.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const lw = x1 - x0;
  const lh = y1 - y0;
  const mx = Math.max(22, lw * 0.45);
  const top = Math.max(12, lh * 0.12);
  const bottom = Math.max(30, lh * 0.3);
  const F = { x: x0 - mx - 14, y: y0 - top, w: lw + 2 * mx + 28, h: lh + top + bottom };
  // Pixel size: the inset's width, unless that would run past the map's bottom.
  const wPx = room?.w ?? 300;
  const hPx = Math.min((wPx * F.h) / F.w, (room?.maxH ?? 400) - 60); // room for the note under it
  const k = Math.min(wPx / F.w, hPx / F.h); // px per foot
  const px = (n: number) => n / k;

  const tname = TEMPLATES[type].name.toLowerCase();
  const P = TEMPLATES[type].proposal;
  const grey = ['rules', 'records', 'edges'].includes(cls.blocker);
  const short = !grey && cls.width != null && cls.width < P.width;
  const tone = grey ? 'none' : cls.widthTrust === 'pencil' ? 'open' : short ? 'short' : 'fits';
  const hatch = px(3.4);
  const id = `ol-${lot.pin}`;
  const f = plan.front;
  const fy = f ? (f.a[1] + f.b[1]) / 2 : y1;
  const fx0 = f ? Math.min(f.a[0], f.b[0]) : x0;
  const fx1 = f ? Math.max(f.a[0], f.b[0]) : x1;
  const fmid = (fx0 + fx1) / 2;
  const frontSetback = plan.sides.find((s) => s.kind === 'front')?.setback ?? null;
  // Deed dimensions are integers and ink; without a deed, the City map's, one decimal, in pencil.
  // Without a front (edges not computed) the drawing stays north-up and draws no dimension lines: the deed's
  // numbers go in the note instead, as they can't be laid along a side we couldn't find.
  const mappedFront = cls.front != null && !lot.deed ? cls.front : plan.mapped?.front ?? null; // the classifier's own frontage when it used the map
  const wDim = !plan.ok ? null : lot.deed ? { v: String(lot.deed.front), trust: 'ink' } : mappedFront != null ? { v: ftFmt(mappedFront), trust: 'pencil' } : null;
  const dDim = !plan.ok ? null : lot.deed ? { v: String(lot.deed.depth), trust: 'ink' } : plan.mapped ? { v: ftFmt(plan.mapped.depth), trust: 'pencil' } : null;
  // Neighbour labels on the side of the lot each neighbour lies (left, right, behind), stacked when several share one.
  const lcx = (x0 + x1) / 2;
  const sideOf = (c: Pt) => (c[1] < y0 - lh * 0.05 && c[0] > x0 && c[0] < x1 ? 'rear' : c[0] < lcx ? 'left' : 'right');
  const bySide: Record<string, { pin: string; lot: number | null; built: boolean; c: Pt }[]> = { left: [], right: [], rear: [] };
  for (const n of plan.neighbors) {
    const c = ringCentre(n.ring);
    bySide[sideOf(c)].push({ pin: n.pin, lot: n.lot, built: n.built, c });
  }
  const nbLabels = [
    ...(['left', 'right'] as const).flatMap((sd) =>
      bySide[sd]
        .sort((a, b) => b.c[1] - a.c[1])
        .map((n, i) => ({ ...n, x: sd === 'left' ? x0 - mx / 2 - 7 : x1 + mx / 2 + 7, y: Math.max(F.y + px(14), fy - px(26) - i * px(26)) })),
    ),
    ...bySide.rear.map((n, i) => ({ ...n, x: Math.max(x0 + px(20), Math.min(x1 - px(20), n.c[0])) + i * px(40), y: F.y + px(12) })),
  ];
  // A width of 0 by deed draws nothing and says so, as on the plate (DESIGN_GUIDE §4): the City map's outline
  // can leave a hairline the deed doesn't.
  const none = !grey && cls.width != null && cls.width <= 0;
  const env = none ? null : plan.envelope;
  const ec = env ? ringCentre(env) : null;
  const ey0 = env ? Math.min(...env.map((q) => q[1])) : 0;
  const ew = env ? Math.max(...env.map((q) => q[0])) - Math.min(...env.map((q) => q[0])) : 0;
  const street = f?.street ?? (data.state === 'ready' ? data.outline.addr_street : null);
  // The scale bar sits in the top-left margin, clear of the street name: as long as the margin allows.
  const sbFt = mx + 14 - px(12) >= 50 ? 50 : mx + 14 - px(12) >= 25 ? 25 : 10;

  return (
    <div className="map-inset-plan map-inset-outline" data-inset-state="ready" data-pin={lot.pin}>
      {head}
      <svg className="ol-svg" width={F.w * k} height={F.h * k} viewBox={`${F.x} ${F.y} ${F.w} ${F.h}`} role="img" aria-label={`Outline of ${lot.addr} from the City parcel map, with its neighbours${env ? ` and the buildable area for a ${tname}` : ''}.`}>
        <defs>
          {(['ink', 'red', 'graphite'] as const).map((c) => (
            <pattern key={c} id={`${id}-h-${c}`} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2={hatch} className={`hatch-line hatch-${c}`} style={{ strokeWidth: px(0.8) }} />
            </pattern>
          ))}
          <clipPath id={`${id}-clip`}>
            <rect x={F.x} y={F.y} width={F.w} height={F.h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}-clip)`}>
          {/* Neighbours: thin, with their County lot number and whether they are built. */}
          {plan.neighbors.map((n) => (
            <g key={n.pin} className={`ol-nb ${n.built ? 'is-built' : ''}`}>
              <path d={path(n.ring)} className="ol-nb-line" />
            </g>
          ))}
          {nbLabels.map((l) => (
            <text key={`t-${l.pin}`} x={l.x} y={l.y} className="ol-nb-name" fontSize={px(9.5)} textAnchor="middle">
              {l.lot != null ? `lot ${l.lot}` : ''}
              <tspan x={l.x} dy={px(11)}>
                {l.built ? 'built' : 'vacant'}
              </tspan>
            </text>
          ))}
          {/* The buildable area (envelope), hatched like the plate: red when narrower than your plan. */}
          {env && <path d={path(env)} className={`env ${tone}`} style={{ fill: `url(#${id}-h-${tone === 'short' ? 'red' : tone === 'open' ? 'graphite' : 'ink'})` }} data-inset="envelope" />}
          {/* Your plan, in red: the building you want, on the front setback line. */}
          {!grey && f && frontSetback != null && <rect x={fmid - P.width / 2} y={fy - frontSetback - P.depth} width={P.width} height={P.depth} className="proposal" />}
          <path d={path(plan.ring)} className="ol-lot" />
          {none && f && (
            // In the lot's rear quarter, one word a line, so a narrow lot holds it.
            <text x={fmid} y={y0 + (fy - y0) * 0.22} className="cant" fontSize={px(8.5)} textAnchor="middle" data-inset="no-width">
              NO
              <tspan x={fmid} dy={px(10)}>
                BUILDABLE
              </tspan>
              <tspan x={fmid} dy={px(10)}>
                WIDTH
              </tspan>
            </text>
          )}
          {/* Street name along the front. */}
          {street && plan.ok && (
            <text x={fmid} y={fy + px(34)} className="street-name" fontSize={px(10)} textAnchor="middle">
              {street.toUpperCase()}
            </text>
          )}
        </g>
        {/* Width: a dimension line under the front. Depth: one down the right side. */}
        {wDim && f && (
          <g className={`ol-dim ${wDim.trust === 'pencil' ? 'is-pencil' : ''}`} data-inset="width">
            <path d={line([[fx0, fy + px(10)], [fx1, fy + px(10)]])} />
            <path d={line([[fx0, fy + px(6)], [fx0, fy + px(14)]])} />
            <path d={line([[fx1, fy + px(6)], [fx1, fy + px(14)]])} />
            <text x={fmid} y={fy + px(22)} fontSize={px(10)} textAnchor="middle" style={{ strokeWidth: px(3) }}>
              {wDim.v} FT{wDim.trust === 'pencil' ? ' (CITY MAP)' : ''}
            </text>
          </g>
        )}
        {dDim && (
          <g className={`ol-dim ${dDim.trust === 'pencil' ? 'is-pencil' : ''}`} data-inset="depth">
            <path d={line([[x1 + px(8), y0], [x1 + px(8), fy]])} />
            <path d={line([[x1 + px(4), y0], [x1 + px(12), y0]])} />
            <path d={line([[x1 + px(4), fy], [x1 + px(12), fy]])} />
            <text x={x1 + px(12)} y={y0 + (fy - y0) * 0.3} fontSize={px(10)} textAnchor="start" dominantBaseline="middle" style={{ strokeWidth: px(3) }}>
              {dDim.v} FT
            </text>
          </g>
        )}
        {/* The buildable width, on its envelope (by deed, as the plate labels it). */}
        {env && ec && cls.width != null && (
          <text x={ec[0] + (ew < px(26) ? px(8) + ew / 2 : 0)} y={ey0 + px(16)} className={`env-width ${tone}`} fontSize={px(13)} strokeWidth={px(3)} textAnchor={ew < px(26) ? 'start' : 'middle'} data-inset="width-numeral">
            {ftFmt(cls.width)}
            <tspan className="unit">′</tspan>
          </text>
        )}
        <rect x={F.x + px(2)} y={F.y + px(2)} width={F.w - px(4)} height={F.h - px(4)} className="plate-frame" />
        <g transform={`translate(${F.x + F.w - px(18)} ${F.y + px(20)}) rotate(${plan.north})`} className="north" aria-hidden="true">
          <circle r={px(9)} className="north-ring" />
          <path d={`M0 ${-px(7)} L${px(2.6)} ${px(4)} L0 ${px(2)} L${-px(2.6)} ${px(4)} Z`} className="north-arrow" />
        </g>
        <g transform={`translate(${F.x + px(10)} ${F.y + px(20)})`} className="scale-bar" aria-hidden="true">
          {[0, 1].map((i) => (
            <rect key={i} x={(i * sbFt) / 2} y={0} width={sbFt / 2} height={px(3)} className={i % 2 ? 'sb-empty' : 'sb-full'} />
          ))}
          <text x={sbFt} y={-px(3.5)} fontSize={px(9)} textAnchor="middle" className="sb-num">
            {sbFt} ft
          </text>
        </g>
      </svg>
      <p className="small ol-note">
        {grey ? (
          <span className="muted">
            {plan.envelopeNote}
            {!plan.ok && lot.deed ? ` By deed, ${lot.deed.front} × ${lot.deed.depth} ft.` : ''}
          </span>
        ) : env ? (
          <>
            <span className={tone === 'short' ? 'red-text' : tone === 'open' ? 'pencil-text' : undefined} data-trust={tone === 'open' ? 'pencil' : tone === 'short' ? 'red' : 'ink'}>
              {cls.width != null ? `${ftFmt(cls.width)} ft` : '—'}
            </span>{' '}
            to build on, {lot.deed ? 'by deed' : 'on the City map (no deed dimensions)'} ({cls.formula}); your {P.width} ft plan in red dashes.
          </>
        ) : (
          <>
            {lot.deed ? 'By deed' : 'On the City map'}, {cls.formula ?? plan.envelopeNote}; your {P.width} ft plan in red dashes.
          </>
        )}{' '}
        <span className="muted" title={`Plans with buildings and deed lot lines cover ${blocks}.`}>
          City parcel map, not a survey.
        </span>
      </p>
    </div>
  );
}
