import type React from 'react';
// The left rail (spec §0.15). It follows the canvas: on the Map and the Table, the layers (with live
// counts from summarize()) and the filters; on the Plan, the plate's key and its slope layer; on the
// Graph, a slot for the graph's node-type filters (P1).
import type { Blocker } from '@engine/city';
import { STYLE, lotsWord, n, zoneName } from '../city/blockers';
import { Label } from '../ui';
import { LAYERS, type CityModel } from '../../lib/city';
import type { Canvas, UrlState } from '../../lib/url';
import { Gloss } from './plain';

const CHECKED: Blocker[] = ['width', 'area', 'depth', 'ownership', 'fits', 'use', 'records', 'edges'];
/** The rail's layers: the shared list, with "not permitted here" after "fits" (lots whose district's use table
 *  forbids the building; they were in "In checked districts" but in no layer below it, so the group didn't add up). */
const RAIL_LAYERS: { id: Blocker; words: string }[] = LAYERS.flatMap((l) => (l.id === 'fits' ? [l, { id: 'use' as Blocker, words: 'Not permitted here' }] : [l]));

function Check({ on, mixed, onChange, children, count, swatch, id }: { on: boolean; mixed?: boolean; onChange: () => void; children: React.ReactNode; count: string; swatch?: string; id: string }) {
  return (
    <label className="ws-layer" data-layer={id}>
      <input
        type="checkbox"
        checked={on}
        ref={(el) => {
          if (el) el.indeterminate = !!mixed;
        }}
        onChange={onChange}
      />
      {swatch ? <span className={`bk bk-${swatch}`} aria-hidden="true" /> : <span className="ws-layer-pad" aria-hidden="true" />}
      <span className="ws-layer-name">{children}</span>
      <span className="ws-layer-n">{count}</span>
    </label>
  );
}

export function Rail({
  canvas,
  s,
  update,
  cm,
  runCount,
  planType,
  graphFilters,
}: {
  graphFilters?: React.ReactNode; // the Graph canvas's node-type filters (GraphRailFilters)
  canvas: Canvas;
  s: UrlState;
  update: (p: Partial<UrlState>, o?: { push?: boolean }) => void;
  cm: CityModel | null;
  runCount: number | null;
  planType: string;
}) {
  if (canvas === 'plan') return <PlanKey s={s} update={update} planType={planType} />;
  if (canvas === 'graph')
    return (
      <nav className="ws-rail" aria-label="Graph filters">
        {graphFilters}
      </nav>
    );
  const ready = cm?.data.state === 'ready';
  const sum = cm?.sum;
  const hide = new Set(s.hide);
  const setHide = (ids: Blocker[], show: boolean) => {
    const next = new Set(hide);
    for (const id of ids) {
      if (show) next.delete(id);
      else next.add(id);
    }
    update({ hide: [...next].sort() });
  };
  const count = (v: number | undefined) => (ready && v != null ? n(v) : '…');
  const allIds = RAIL_LAYERS.map((l) => l.id);
  const allOn = allIds.every((id) => !hide.has(id));
  const anyOn = allIds.some((id) => !hide.has(id));
  const chkOn = CHECKED.every((id) => !hide.has(id));
  const chkAny = CHECKED.some((id) => !hide.has(id));
  const checkedCount = sum ? sum.total - sum.byBlocker.rules : undefined;
  const filtersOn = !!(s.hood || s.sale || s.ward != null || s.zone);
  const hoods = cm ? [...cm.hoods.values()].filter((h) => h.lots > 0).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')) : [];
  // Every count here is for the lots the filters show: say so (team review, round 3).
  const scope = s.hood && !(s.sale || s.ward != null || s.zone) ? `in ${s.hood}` : filtersOn ? 'filtered' : 'citywide';
  const could = sum ? sum.total - sum.byBlocker.rules - sum.byBlocker.records - sum.byBlocker.edges : 0;
  return (
    <nav className="ws-rail" aria-label="Layers and filters">
      <section className="ws-rail-sec" aria-labelledby="ws-layers-h">
        <Label as="h2">
          <span id="ws-layers-h">
            Layers <span className="ws-rail-scope" data-scope={scope}>· {scope}</span>
          </span>
        </Label>
        <div className="ws-layers" role="group" aria-labelledby="ws-layers-h">
          <Check id="all" on={allOn} mixed={anyOn && !allOn} onChange={() => setHide(allIds, !allOn)} count={count(sum?.total)}>
            City-owned vacant lots
          </Check>
          <div className="ws-layer-group">
            <Check id="checked" on={chkOn} mixed={chkAny && !chkOn} onChange={() => setHide(CHECKED, !chkOn)} count={count(checkedCount)}>
              <span title={ready && sum ? `Lots in districts whose rules a person has signed. ${n(could)} of them could be checked (the inspector's "Lots checked"); ${n(sum.byBlocker.records)} have records that disagree and ${n(sum.byBlocker.edges)} edges not computed.` : undefined}>
                In checked districts
              </span>
            </Check>
            {RAIL_LAYERS.filter((l) => l.id !== 'rules').map((l) => (
              <Check key={l.id} id={l.id} swatch={l.id} on={!hide.has(l.id)} onChange={() => setHide([l.id], hide.has(l.id))} count={count(sum?.byBlocker[l.id])}>
                <span title={STYLE[l.id].gloss}>{l.words}</span>
              </Check>
            ))}
          </div>
          <Check id="rules" swatch="rules" on={!hide.has('rules')} onChange={() => setHide(['rules'], hide.has('rules'))} count={count(sum?.byBlocker.rules)}>
            <span title={STYLE.rules.gloss}>Not checked</span>
          </Check>
          {ready && cm && cm.pencilSum.total > 0 && (
            // The grey explained, as its own layer (off by default): what the AI's reading of the unchecked rules says,
            // drawn in pencil and never counted with the signed districts.
            <label className="ws-layer is-ai" data-layer="ai" title="Districts whose rules the model has read but no person has checked yet. Drawn in pencil; not counted in the numbers above.">
              <input type="checkbox" checked={s.ai} onChange={() => update({ ai: !s.ai })} />
              <span className="bk bk-ai" aria-hidden="true" />
              <span className="ws-layer-name">AI-read, awaiting a person</span>
              <span className="ws-layer-n">{n(cm.pencilSum.total)}</span>
            </label>
          )}
          <label className="ws-layer is-asm" data-layer="assemble">
            <input type="checkbox" checked={s.layer === 'assemble'} onChange={() => update({ view: 'city', layer: s.layer === 'assemble' ? null : 'assemble', run: null, pin: null }, { push: true })} />
            <span className="ws-asm-ring" aria-hidden="true" />
            <span className="ws-layer-name" title="Possible lot groups of 2–3 side-by-side lots. Groups that share a lot are alternatives, not separate sites.">Combine to fit</span>
            <span className="ws-layer-n">{runCount != null ? n(runCount) : '…'}</span>
          </label>
        </div>
        <details className="ws-about-dots small">
          <summary>About these dots</summary>
          <p>
            One dot per City-owned vacant lot, at its representative point. Color is the first thing that blocks {planType}; grey means we did not compute it. Combine to fit counts lot groups of 2–3 lots, not lots.
            {ready && cm!.data.state === 'ready' ? ` The map holds ${n(cm!.lots.length)} ${lotsWord(cm!.lots.length)}${cm!.data.meta.source ? `, from ${cm!.data.meta.source}` : ''}.` : ''}
          </p>
        </details>
      </section>

      <section className="ws-rail-sec" aria-labelledby="ws-filters-h">
        <div className="ws-rail-row">
          <Label as="h2">
            <span id="ws-filters-h">Filters</span>
          </Label>
          {filtersOn && (
            <button type="button" className="link small" onClick={() => update({ hood: null, sale: false, ward: null, zone: null }, { push: true })}>
              Clear
            </button>
          )}
        </div>
        <label className="ws-field">
          <span className="ws-field-name">Neighborhood</span>
          <select value={s.hood ?? ''} onChange={(e) => update({ hood: e.target.value || null, ...(e.target.value ? {} : {}) }, { push: true })}>
            <option value="">All of Pittsburgh</option>
            {hoods.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name} · {n(h.lots)}
              </option>
            ))}
          </select>
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={s.sale} onChange={() => update({ sale: !s.sale }, { push: true })} /> Listed for sale only
        </label>
        <label className="ws-field">
          <span className="ws-field-name">Ward</span>
          <select value={s.ward ?? ''} onChange={(e) => update({ ward: e.target.value ? Number(e.target.value) : null }, { push: true })}>
            <option value="">All wards</option>
            {(cm?.wards ?? []).map((w) => (
              <option key={w} value={w}>
                Ward {w}
              </option>
            ))}
          </select>
        </label>
        <label className="ws-field">
          <span className="ws-field-name">
            <Gloss k="district">District</Gloss>
          </span>
          <select value={s.zone ?? ''} onChange={(e) => update({ zone: e.target.value || null }, { push: true })}>
            <option value="">All districts</option>
            {(cm?.zones ?? []).map((z) => (
              <option key={z} value={z}>
                {zoneName(z)}
              </option>
            ))}
          </select>
        </label>
        {ready && filtersOn && (
          <p className="small muted ws-inview">
            {n(sum!.total)} {lotsWord(sum!.total)} shown
          </p>
        )}
      </section>
    </nav>
  );
}

function PlanKey({ s, update, planType }: { s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; planType: string }) {
  return (
    <nav className="ws-rail" aria-label={`Plan key and layers: each lot's envelope for ${planType}`}>
      <section className="ws-rail-sec" aria-labelledby="ws-key-h">
        <Label as="h2">
          <span id="ws-key-h">Key</span>
        </Label>
        <ul className="ws-key">
          <li>
            <span className="lg lg-short" /> narrower than your proposal
          </li>
          <li>
            <span className="lg lg-fits" /> fits
          </li>
          <li>
            <span className="lg lg-open" /> pencil: open question
          </li>
          <li>
            <span className="lg lg-prop" /> your proposal (red)
          </li>
          <li>
            <span className="lg lg-coin" /> City-owned, for sale
          </li>
          <li>
            <span className="lg lg-held" /> City-owned, held
          </li>
        </ul>
      </section>
      <section className="ws-rail-sec" aria-labelledby="ws-plan-layers-h">
        <Label as="h2">
          <span id="ws-plan-layers-h">Layers</span>
        </Label>
        <label className="ws-check">
          <input type="checkbox" checked={s.slope} onChange={() => update({ slope: !s.slope })} /> Slope 25% or more
        </label>
      </section>
    </nav>
  );
}
