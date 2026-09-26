// The lot view: the signature layout. What fits · What blocks it · What to do next, the plate, and
// the two walls. Every number comes from the engine's result object.
import { useEffect, useMemo, useState } from 'react';
import { candidateGroups, explanation, headline, nextStep, placeName, type Seg } from '@engine/index';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, LotResult, Parcel, TemplateId } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { Plate } from '../components/Plate';
import { MoneyWall, RulesWall } from '../components/Walls';
import { Chip, DISCLAIMER, Ev, ftFmt, Label, money1 } from '../components/ui';
import { useCountTo } from '../lib/craft';
import { REFRESH, refreshChangesFor } from '../lib/data';
import { lotKey, mainRow, TYPE_ORDER, type LotModel } from '../lib/model';
import type { UrlState } from '../lib/url';

function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        !s.num && s.ref && s.t.length > 24 ? (
          <span key={i} className={s.trust && s.trust !== 'ink' ? `ev-${s.trust}` : undefined}>
            {s.t.replace(/\s*\(§[^)]+\)\.?$/, '')}{' '}
            <Chip refId={s.ref} trust={s.trust === 'pencil' ? 'pencil' : 'ink'}>
              {(s.t.match(/§\d{3}\.\d{2}(?:\.[A-Z0-9]+)*(?:\([a-z0-9]+\))?/) ?? ['source'])[0]}
            </Chip>{' '}
          </span>
        ) : s.num || s.ref ? (
          <Ev key={i} trust={s.trust ?? 'ink'} refId={s.ref} num={s.num}>
            {s.t}
          </Ev>
        ) : (
          <span key={i} className={s.trust && s.trust !== 'ink' ? `ev-${s.trust}` : undefined}>
            {s.t}
          </span>
        ),
      )}
    </>
  );
}

function Numeral({ r, still }: { r: LotResult; still: boolean }) {
  const w = r.width;
  const v = w ? w.deed ?? w.mapped : 0;
  const shown = useCountTo(v, still ? 0 : 320);
  if (r.state !== 'ok' || !w) {
    return (
      <div className="numeral-block">
        <div className={`stamp stamp-refuse big ${r.refusal?.code === 'missing_rule' ? 'is-grey' : ''}`}>{r.refusal?.code === 'missing_rule' ? 'RULES NOT LOADED' : 'CAN’T SCORE'}</div>
      </div>
    );
  }
  const check = r.checks.find((c) => c.id === 'width')!;
  const tone = check.trust === 'red' ? 'red' : check.status === 'open' || check.trust === 'pencil' ? 'pencil' : check.status === 'fail' ? 'short' : 'fits';
  const row = r.scenario.type === 'row';
  return (
    <div className={`numeral-block tone-${tone}`}>
      <Ev trust={check.trust === 'pencil' ? 'pencil' : check.trust === 'red' ? 'red' : 'ink'} refId="measure:width" className="numeral" title={w.formula}>
        {w.none ? '0' : ftFmt(shown)}
        <span className="numeral-unit">ft</span>
      </Ev>
      <p className="numeral-cap">
        {w.none ? 'no buildable width' : tone === 'red' ? `${row ? 'end units, ' : ''}under your assumption · not confirmed` : tone === 'pencil' ? `${row ? 'end units, ' : ''}pencil · depends on an open question` : row ? 'end units, as of right · by deed' : 'wide, as of right · by deed'}
        {!w.none && <span className="muted"> · {ftFmt(w.mapped)} ft on the City map</span>}
      </p>
      {check.alternative && (
        <p className="numeral-alt">
          or{' '}
          <Ev trust={check.alternative.trust} refId={`question:${check.alternative.question_id}`} num>
            {ftFmt(check.alternative.available)} ft
          </Ev>{' '}
          if the City answers {check.alternative.choice}
        </p>
      )}
    </div>
  );
}

function defaultGroup(model: LotModel, block: BlockFile, pin: string): string[] {
  const groups = candidateGroups(model.ctx, pin);
  const threes = groups.filter((g) => g.length === 3);
  const pool = threes.length ? threes : groups;
  if (!pool.length) return [pin];
  const score = (g: string[]) => {
    const ps = g.map((x) => block.parcels.find((p) => p.pin === x)!);
    return [ps.filter((p) => p.city?.status === 'Available for Sale').length, ps.filter((p) => p.city).length, -Math.min(...ps.map((p) => p.lot ?? 0))];
  };
  return [...pool].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  })[0];
}

function lotsLabel(block: BlockFile, pins: string[]): string {
  const lots = pins.map((p) => block.parcels.find((x) => x.pin === p)!.lot ?? 0).sort((a, b) => a - b);
  return lots.length > 1 ? `lots ${lots[0]}–${lots[lots.length - 1]}` : `lot ${lots[0]}`;
}

function useNarrow(): boolean {
  const q = '(max-width: 767px)';
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}

export function LotView({ block, model, s, update, crumbsSet }: { block: BlockFile; model: LotModel; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; crumbsSet?: void }) {
  void crumbsSet;
  const r = model.result;
  const sel = block.parcels.find((p) => p.pin === r.pins[0])!;
  const selectedLot = block.parcels.find((p) => lotKey(p) === s.lot) ?? sel;
  const group = useMemo(() => defaultGroup(model, block, selectedLot.pin), [model.ctx, block, selectedLot.pin]);
  const rowLots = mainRow(block);
  const frameLots = rowLots.filter((p) => p.zone === sel.zone);
  const multi = r.pins.length > 1;
  const narrow = useNarrow();
  const focus = useMemo(() => {
    if (!narrow) undefined;
    const order = rowLots.filter((p) => p.zone === sel.zone).map((p) => p.pin);
    const idx = r.pins.map((pin) => order.indexOf(pin)).filter((i) => i >= 0);
    if (!idx.length) return r.pins;
    const lo = Math.max(0, Math.min(...idx) - 1);
    const hi = Math.min(order.length - 1, Math.max(...idx) + 1);
    return order.slice(lo, hi + 1);
  }, [narrow, r.pins.join(','), rowLots, sel.zone]);

  const selectScenario = (type: TemplateId) => {
    const lots = TEMPLATES[type].multi_lot ? group.map((pin) => lotKey(block.parcels.find((p) => p.pin === pin)!)) : [];
    update({ type, lots, w: undefined, d: undefined, st: undefined, h: undefined }, { push: true });
  };
  const tryOption = (o: UnlockOption) => {
    const lots = o.scenario.pins.length > 1 ? o.scenario.pins.map((pin) => lotKey(block.parcels.find((p) => p.pin === pin)!)) : [];
    update({ type: o.scenario.type, lots, lot: lotKey(selectedLot), w: undefined, d: undefined, st: undefined, h: undefined, drawer: null }, { push: true });
  };
  const onSelectLot = (p: Parcel) => {
    if (!rowLots.includes(p) && !block.parcels.includes(p)) return;
    update({ lot: lotKey(p), lots: TEMPLATES[s.type].multi_lot ? [] : [], type: TEMPLATES[s.type].multi_lot ? 'two' : s.type, drawer: null }, { push: true });
  };

  const next = nextStep(model.unlock, block);
  const fits = r.state === 'ok' && ['width', 'depth', 'area', 'height'].every((id) => r.checks.find((c) => c.id === id)?.status === 'pass');
  const cityLots = r.pins
    .map((pin) => block.parcels.find((p) => p.pin === pin)!)
    .filter((p) => p.city)
    .sort((a, b) => (a.pin === selectedLot.pin ? -1 : b.pin === selectedLot.pin ? 1 : (a.lot ?? 0) - (b.lot ?? 0)));
  const otherLots = r.pins.map((pin) => block.parcels.find((p) => p.pin === pin)!).filter((p) => !p.city);
  const rco = (sel.overlays ?? []).find((o) => o.startsWith('RCO'))?.replace(/^RCO - /, '');
  const m = model.money;
  const inquiryHref = `?view=inquiry&block=${block.meta.id}&lot=${lotKey(selectedLot)}&type=${s.type}${s.lots.length > 1 ? `&lots=${s.lots.join(',')}` : ''}${s.assume.length ? `&assume=${s.assume.join(',')}` : ''}`;

  return (
    <main className="lot-view" id="main">
      <section className="top">
        <div className="plate-col">
          <div className="scenario-rail" role="radiogroup" aria-label="Building type">
            <span className="label rail-label">Try</span>
            {TYPE_ORDER.map((t) => {
              const on = s.type === t;
              return (
                <button key={t} role="radio" aria-checked={on} className={`rail-opt ${on ? 'is-on' : ''}`} onClick={() => selectScenario(t)}>
                  {TEMPLATES[t].short}
                  {TEMPLATES[t].multi_lot && <span className="nowrap"> on {lotsLabel(block, group)}</span>}
                </button>
              );
            })}
          </div>
          <Plate
            block={block}
            frameLots={frameLots}
            row={model.row.filter((x) => x.parcel.zone === sel.zone)}
            selected={r}
            onSelect={onSelectLot}
            present={s.present}
            record={s.record}
            still={s.still}
            slope={s.slope}
            focus={narrow ? focus : undefined}
            label={`Plate of ${block.meta.name}, ${block.meta.neighborhood}: every lot on ${block.meta.main_street} with its buildable envelope for a ${TEMPLATES[s.type].name.toLowerCase()}.`}
          />
          <p className="explain">
            <Segs segs={explanation(r, block)} />
          </p>
          <p className="plate-legend">
            <span className="nowrap"><span className="lg lg-short" /> narrower than your proposal</span>
            <span className="nowrap"><span className="lg lg-fits" /> fits</span>
            <span className="nowrap"><span className="lg lg-open" /> pencil: open question</span>
            <span className="nowrap"><span className="lg lg-prop" /> your proposal (red)</span>
            <span className="nowrap"><span className="lg lg-coin" /> City-owned, for sale</span>
            <span className="nowrap"><span className="lg lg-held" /> City-owned, held</span>
          </p>
          <RulesWall result={r} rs={model.ctx.rs} unlock={model.unlock} onTry={tryOption} block={block} />
        </div>

        <div className="answer-col">
          <p className="sentence" aria-live="polite">
            <Segs segs={headline(r, block, model.ctx.rs)} />
          </p>
          {refreshChangesFor(r.pins).length > 0 && (
            <p className="refresh-note pencil-text">
              Changed on the last refresh ({REFRESH?.meta?.run_at?.slice(0, 10)}):{' '}
              {refreshChangesFor(r.pins)
                .map((c) => `${c.addr}: ${c.field} ${String(c.before ?? '—')} → ${String(c.after ?? '—')}`)
                .join('; ')}
              . Shown in pencil until someone checks it. <a href="?view=changes">What changed</a>
            </p>
          )}
          <div className="answers">
            <div className="answer">
              <Label as="h2">What fits</Label>
              <Numeral r={r} still={s.still} />
            </div>
            <div className="answer">
              <Label as="h2">What blocks it</Label>
              {r.state !== 'ok' ? (
                <p>{r.refusal?.reason}</p>
              ) : (
                <ul className="blocks">
                  <li>
                    <span className="wall-tag">Rules</span>{' '}
                    {r.checks.find((c) => c.id === 'width')?.status === 'open' ? (
                      <span className="pencil-text">an open question: does the narrow-lot rule cover attached houses? If not, {r.relief.map((x) => x.text).join('; ')} (a variance).</span>
                    ) : r.checks.find((c) => c.id === 'width')?.trust === 'red' ? (
                      <span className="red-text">nothing, if your assumption holds. The City hasn't answered, so the question stays in the inquiry.</span>
                    ) : r.relief.length ? (
                      <span className="red-text">{r.relief.map((x) => x.text).join('; ')} (a variance).</span>
                    ) : (
                      <span>nothing in the dimensional rules{otherLots.length ? `; ${otherLots.map((p) => `lot ${p.lot}`).join(', ')} ${otherLots.length > 1 ? 'are' : 'is'} not City-owned` : ''}.</span>
                    )}
                  </li>
                  {m && (
                    <li>
                      <span className="wall-tag">Money · H5</span> homes here sell for a median {money1(m.value.median)}; break-even needs ≤{' '}
                      <Ev trust="red" refId="money:breakeven" num>
                        {money1(m.break_even_psf.value)}/sq ft
                      </Ev>
                      .
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="answer">
              <Label as="h2">What to do next</Label>
              {r.state !== 'ok' ? (
                r.refusal?.code === 'missing_rule' ? (
                  <p>
                    Load and check the {r.district} rules first; until a person signs them, the numbers stay pencil.{' '}
                    <a className="btn btn-ink btn-small" href={`?view=review&district=${r.district}`}>
                      Review {r.district} rules
                    </a>
                  </p>
                ) : r.refusal?.code === 'records_disagree' ? (
                  <p>Ask the County or a surveyor to settle the lot area; then it can be scored.</p>
                ) : (
                  <p>{r.refusal?.reason}</p>
                )
              ) : fits || multi ? (
                <p>
                  {cityLots.length ? `Ask City Real Estate about ${cityLots.map((p) => placeName(p)).join(' and ')}. ` : ''}
                  {otherLots.length ? `${otherLots.map((p) => `Lot ${p.lot}`).join(', ')} would have to be bought from its owner. ` : ''}
                  {rco ? `Take it to the RCO (${rco}). ` : ''}
                  <a className="btn btn-ink btn-small" href={inquiryHref}>
                    Draft the inquiry
                  </a>
                </p>
              ) : next.primary ? (
                <p>
                  {next.primary.label}: <Ev trust={next.primary.result.trust}>{ftFmt(next.primary.result.width?.deed ?? 0)} ft</Ev>
                  {next.primary.scenario.pins.some((pin) => !block.parcels.find((p) => p.pin === pin)!.city) ? ', but it needs a lot that isn’t City-owned' : ''}.{' '}
                  <button className="btn btn-ink btn-small" onClick={() => tryOption(next.primary!)}>
                    Try it
                  </button>
                  {next.fewest && next.fewest !== next.primary && (
                    <span className="small muted">
                      {' '}
                      Fewest approvals overall: {next.fewest.label.toLowerCase()} ({ftFmt(next.fewest.result.width?.deed ?? 0)} ft).
                    </span>
                  )}
                </p>
              ) : (
                <p>{next.text}</p>
              )}
            </div>
          </div>
          <MoneyWall result={r} m={m} />
        </div>
      </section>


      <section className="lot-list" aria-labelledby="lot-list-h">
        <h2 id="lot-list-h" className="label">
          Lots on {block.meta.main_street} · {TEMPLATES[s.type].name.toLowerCase()}, each lot alone
        </h2>
        <p className="small muted">{block.meta.counts_note}</p>
        <table className="lots-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Lot</th>
              <th>Plan lot</th>
              <th>Width available</th>
              <th>Status</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {model.row.map(({ parcel, result }) => (
              <tr key={parcel.pin} className={r.pins.includes(parcel.pin) ? 'is-selected' : ''}>
                <td>
                  <button className="link" onClick={() => onSelectLot(parcel)} aria-pressed={r.pins.includes(parcel.pin)}>
                    {placeName(parcel)}
                  </button>
                </td>
                <td>{lotKey(parcel)}</td>
                <td>
                  <em>{parcel.deed?.plan_lot ?? '—'}</em>
                </td>
                <td className="num">{result.state === 'ok' ? `${ftFmt(result.width!.deed ?? result.width!.mapped)} ft` : '—'}</td>
                <td>{result.state === 'ok' ? statusWords(result) : result.refusal?.code === 'missing_rule' ? `rules not loaded (${parcel.zone})` : `can't score: ${result.refusal?.code.replace('_', ' ')}`}</td>
                <td>{parcel.city ? `City · ${parcel.city.status}` : `other (${(parcel.assess?.ownercat ?? '—').toLowerCase()})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="lot-foot">
        <p>{DISCLAIMER}</p>
        <p className="small muted">
          Not assessed, never scored: water and sewer capacity, soils and fill, title and liens, community priorities{rco ? ` (RCO: ${rco})` : ''}. Parcel shapes come from GIS, not a survey.{' '}
          <a href={`?view=about&block=${block.meta.id}&section=limits`}>What 24×100 doesn’t know</a>
        </p>
      </footer>
    </main>
  );
}

function statusWords(r: LotResult): string {
  const w = r.checks.find((c) => c.id === 'width')!;
  if (w.status === 'open') return 'open question';
  return w.status === 'pass' ? 'fits' : `short ${ftFmt(w.shortfall ?? 0)} ft`;
}
