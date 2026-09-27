// The inspector for a lot with block detail (spec §0.15): header, four tiles, and the tabs Money ·
// Rules · Site · Next · Sources. The tabs hold today's lot-page panels, unchanged in substance.
import { explanation, getQuestion, headline, nextStep, placeName, type VerdictChip } from '@engine/index';
import { varianceWords } from '@engine/verdict';
import type { BlockFile, Parcel } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { MoneyPanel, EstimateMark, SitePanel, VerdictBlock } from '../Panels';
import { RulesWall } from '../Walls';
import { Ev, ftFmt, Label, DISCLAIMER } from '../ui';
import { COMPS_BY_WARD, REFRESH, refreshChangesFor } from '../../lib/data';
import { lotKey, parcelByLot, type LotModel } from '../../lib/model';
import type { InspectorTab, UrlState } from '../../lib/url';
import { Dash, InspectorShell, Tile, type TabDef } from './Shell';
import { Gloss, kFmt, LotSentence, VerdictStamp } from './plain';
import { Segs } from './Segs';
import { MoneySources, RecordList, RuleSources } from './Sources';
import { stepFromText, type Step } from './Tray';
import { whatIfLine } from '../city/WhatIfs';
import { WatchToggle } from '../WatchToggle';
import { QuoteForm } from './QuoteForm';

const GLYPH = { blocks: '✕', open: '?', clear: '✓', unknown: '—' } as const;

export function glyphOf(c: VerdictChip | undefined) {
  return c ? { mark: GLYPH[c.state], state: c.state, words: c.words } : null;
}

/** The verdict chip's words, leading its tab, in the chip's evidence color. */
export function ChipLine({ c }: { c: VerdictChip | undefined }) {
  if (!c) return null;
  return (
    <p className={`ws-chipline vchip-${c.state} ev-class-${c.evidence}`} data-trust={c.evidence === 'ink' ? 'ink' : c.evidence}>
      <span className="vchip-glyph" aria-hidden="true">
        {GLYPH[c.state]}
      </span>{' '}
      <span className="vchip-words">{c.words}</span>
    </p>
  );
}

export function inquiryHref(block: BlockFile, s: UrlState, lot: string, office?: string): string {
  // A full page load: the stage (record, present) and the theme come along, or the film's letter opens unstaged.
  const stage = `${s.record ? '&record=1' : s.present ? '&present=1' : ''}${s.theme ? `&theme=${s.theme}` : ''}`;
  return `?view=inquiry&block=${block.meta.id}&lot=${lot}&type=${s.type}${s.lots.length > 1 ? `&lots=${s.lots.join(',')}` : ''}${s.assume.length ? `&assume=${s.assume.join(',')}` : ''}${office ? `&letter=${office}` : ''}${stage}`;
}

function LotTiles({ model }: { model: LotModel }) {
  const r = model.result;
  const m = model.money;
  if (r.state !== 'ok') {
    const why = r.refusal?.code === 'missing_rule' ? 'rules not loaded' : r.refusal?.code === 'records_disagree' ? 'records disagree' : 'not scored';
    return (
      <>
        <Tile id="width" label="Buildable width" value={<Dash why={why} />} sub={`can’t score: ${why}`} className="is-na" />
        <Tile id="cost" label="Build cost per home" value={<Dash why="the lot is not scored" />} sub="not assessed" className="is-na" />
        <Tile id="sale" label="Newest new-build sale" value={<Dash why="the lot is not scored" />} sub="not assessed" className="is-na" />
        <Tile id="left" label="Left after building" value={<Dash why="the lot is not scored" />} sub="not assessed" className="is-na" />
      </>
    );
  }
  const w = r.width!;
  const check = r.checks.find((c) => c.id === 'width')!;
  const tone = check.trust === 'red' ? 'red' : check.status === 'open' || check.trust === 'pencil' ? 'pencil' : check.status === 'fail' ? 'short' : 'fits';
  const trust = check.trust === 'pencil' ? 'pencil' : check.trust === 'red' ? 'red' : 'ink';
  const v = w.deed ?? w.mapped;
  const row = r.scenario.type === 'row';
  const caption = `${w.none ? 'no buildable width' : tone === 'red' ? 'under your assumption, not confirmed' : tone === 'pencil' ? 'pencil: depends on an open question or unreviewed rules' : 'as of right, by deed'} · ${ftFmt(w.mapped)} ft on the City map · ${w.formula}`;
  // An open question with two readings (§925.06.C.1 for a detached house, or the narrow-lot table for
  // rowhouse end units): the buildable width is a range until the City answers, and it sits apart from
  // your plan (team review, round 3: "Your plan: 16 ft" and "Buildable: 11–18 ft" were run together).
  const alt = check.alternative;
  const pending = !!alt && alt.trust === 'pencil' && !w.none; // open, not assumed (red) or confirmed
  const lo = pending ? Math.min(v, alt!.available) : v;
  const hi = pending ? Math.max(v, alt!.available) : v;
  const ask = pending ? getQuestion(model.ctx.rs, alt!.question_id)?.question.ask ?? 'the City' : null;
  // The deciding estimate: the user's builder's quote when given (red, theirs), else the practitioner's.
  const Q = m?.quote ?? null;
  const A = Q ?? m?.estimates.find((e) => e.default) ?? m?.estimates[0];
  const tt = Q ? 'red' : 'estimate';
  const moneyWhy = m ? 'no recent new-build sale in this ward' : model.moneyGap ?? 'no money data';
  return (
    <>
      <Tile
        id="width"
        label={row ? 'End-unit width' : 'Buildable width'}
        title={caption}
        className={`tone-${tone}`}
        value={
          <span className="numeral-block" data-trust={trust === 'ink' && check.status !== 'open' ? 'ink' : trust === 'red' ? 'red' : 'pencil'}>
            <Ev trust={trust} refId={pending ? `question:${alt!.question_id}` : 'measure:width'} className={`numeral${pending ? ' is-range' : ''}`} title={pending ? `${ftFmt(v)} ft (${w.formula}) or ${ftFmt(alt!.available)} ft (${alt!.formula}), pending the ${ask}’s reading` : w.formula}>
              {w.none ? '0' : pending ? `${ftFmt(lo)}–${ftFmt(hi)}` : ftFmt(v)}
              <span className="numeral-unit">ft</span>
            </Ev>
          </span>
        }
        sub={
          pending ? (
            <>
              <span className="ws-tile-line pencil-text" data-trust="pencil">
                {`pending the ${ask}’s reading`}
              </span>
              <span className="ws-tile-line">
                your plan{' '}
                <Ev trust="red" refId="proposal:width" num>
                  {ftFmt(check.required ?? 0)} ft
                </Ev>
              </span>
            </>
          ) : (
            <>
              {alt ? (
                <>
                  or{' '}
                  <Ev trust={alt.trust === 'red' ? 'red' : 'pencil'} refId={`question:${alt.question_id}`} num>
                    {ftFmt(alt.available)} ft
                  </Ev>{' '}
                  on the other reading ·{' '}
                </>
              ) : null}
              your plan{' '}
              <Ev trust="red" refId="proposal:width" num>
                {ftFmt(check.required ?? 0)} ft
              </Ev>
            </>
          )
        }
      />
      {A ? (
        <Tile
          id="cost"
          label={`Build cost · ${m!.sqft.toLocaleString('en-US')} sf home`}
          title={`${A.label}: ${A.psf[0] === A.psf[1] ? `$${A.psf[0]}` : `$${A.psf[0]}–$${A.psf[1]}`}/sq ft × ${m!.sqft.toLocaleString('en-US')} sq ft. ${A.note} Source: ${A.supplied_by}.`}
          className={Q ? 'is-quote' : 'is-est'}
          value={
            <span data-trust={tt}>
              {Q ? null : <EstimateMark />}
              <Ev trust={tt} {...(Q ? {} : { refId: `money:estimate:${A.id}` })} num>
                {A.vertical[0] === A.vertical[1] ? (
                  kFmt(A.vertical[0])
                ) : (
                  <>
                    <span className="nowrap">{kFmt(A.vertical[0])}–</span>
                    <wbr />
                    <span className="nowrap">{kFmt(A.vertical[1])}</span>
                  </>
                )}
              </Ev>
            </span>
          }
          sub={Q ? <span className="red-text">your builder’s quote, ${Q.psf[0]}/sf</span> : <span className="est">{A.supplied_by.replace(/ \(.*$/, '').replace(/, unconfirmed$/, '')}</span>}
        />
      ) : (
        <Tile id="cost" label="Build cost per home" value={<Dash why={moneyWhy} />} sub="not assessed" title={moneyWhy} className="is-na" />
      )}
      {m?.new_build ? (
        <Tile
          id="sale"
          label="Newest new-build sale"
          value={
            <ul className="ws-prices" aria-label="Sale prices">
              <li data-price="newest">
                <Ev trust="ink" refId="money:comps" num>
                  {kFmt(m.new_build.value)}
                </Ev>
              </li>
            </ul>
          }
          sub={
            <span className="gloss" tabIndex={0} title={`Caveat: ${m.new_build.note}.`}>
              {m.new_build.label.replace(/^Newest new build: /, '').replace(/,\s*[\d,]+ sf\)$/, ')')} · one sale · unverified
            </span>
          }
        />
      ) : (
        <Tile id="sale" label="Newest new-build sale" value={<Dash why={moneyWhy} />} sub="not assessed" title={moneyWhy} className="is-na" />
      )}
      {A ? (
        <Tile
          id="left"
          label="Left after building"
          className={Q ? 'is-quote' : 'is-est'}
          title={`${A.formula}. Before site work, soft costs and land; ${Q ? 'your builder’s quote, not checked' : "a practitioner's estimate"}.`}
          value={
            <span data-trust={tt}>
              <Ev trust={tt} {...(Q ? {} : { refId: `money:estimate:${A.id}` })} num>
                {A.left[0] === A.left[1] ? (
                  kFmt(A.left[0])
                ) : (
                  <>
                    <span className="nowrap">{kFmt(A.left[0])} to</span> <span className="nowrap">{kFmt(A.left[1])}</span>
                  </>
                )}
              </Ev>
            </span>
          }
          sub={<span className={Q ? 'red-text' : 'est'}>{A.left[0] < 0 ? 'nothing left, per home' : 'per home'}{Q ? ', at your quote' : ''}</span>}
        />
      ) : (
        <Tile id="left" label="Left after building" value={<Dash why={moneyWhy} />} sub="not assessed" title={moneyWhy} className="is-na" />
      )}
    </>
  );
}

/** What to do next, first: moved from the lot page's answer column. */
function NextAnswer({ model, block, s, onTry }: { model: LotModel; block: BlockFile; s: UrlState; onTry: (o: UnlockOption) => void }) {
  const r = model.result;
  const selectedLot = block.parcels.find((p) => lotKey(p) === s.lot) ?? block.parcels.find((p) => p.pin === r.pins[0])!;
  const next = nextStep(model.unlock, block);
  const multi = r.pins.length > 1;
  const fits = r.state === 'ok' && ['width', 'depth', 'area', 'height'].every((id) => r.checks.find((c) => c.id === id)?.status === 'pass');
  const cityLots = r.pins
    .map((pin) => block.parcels.find((p) => p.pin === pin)!)
    .filter((p) => p.city)
    .sort((a, b) => (a.pin === selectedLot.pin ? -1 : b.pin === selectedLot.pin ? 1 : (a.lot ?? 0) - (b.lot ?? 0)));
  const otherLots = r.pins.map((pin) => block.parcels.find((p) => p.pin === pin)!).filter((p) => !p.city);
  const sel = block.parcels.find((p) => p.pin === r.pins[0])!;
  const rco = (sel.overlays ?? []).find((o) => o.startsWith('RCO'))?.replace(/^RCO - /, '');
  return (
    <div className="ws-first">
      <Label as="h3">What to do next</Label>
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
          Check first, for free: {cityLots.length ? `ask City Real Estate about ${cityLots.map((p) => placeName(p)).join(' and ')}` : 'ask City Real Estate'}
          {otherLots.length ? ` and who owns ${otherLots.map((p) => `lot ${p.lot}`).join(', ')}` : ''}; then ask the URA about gap financing.
          {rco ? (
            <span className="small muted">
              {' '}
              · then the <Gloss k="rco">RCO</Gloss> ({rco})
            </span>
          ) : null}
        </p>
      ) : next.primary ? (
        <p>
          {next.primary.label}: <Ev trust={next.primary.result.trust}>{ftFmt(next.primary.result.width?.deed ?? 0)} ft</Ev>
          {next.primary.scenario.pins.some((pin) => !block.parcels.find((p) => p.pin === pin)!.city) ? ', but it needs a lot that isn’t City-owned' : ''}.{' '}
          <button className="btn btn-ink btn-small" onClick={() => onTry(next.primary!)}>
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
  );
}

function Letters({ model, block, s }: { model: LotModel; block: BlockFile; s: UrlState }) {
  const letters = model.inquiry.letters;
  if (!letters.length) return null;
  return (
    <section className="ws-letters" aria-label="Draft letters, one per office">
      <Label as="h3">Every draft letter · you decide whether to send them</Label>
      <ul>
        {letters.map((l) => (
          <li key={l.office}>
            <a href={inquiryHref(block, s, s.lot, l.office)}>Letter to {l.tab}</a> <span className="small muted">· {l.about}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The route for a scored lot: the inquiry's "what to check next" items, cheapest to learn first, each with
 *  its cost tag and a link to every letter whose office it names. The tray lists them; the Next tab details one. */
export function lotSteps(model: LotModel, block: BlockFile, s: UrlState): Step[] {
  if (model.result.state !== 'ok') return [];
  const letters = model.inquiry.letters;
  return (model.inquiry.sections.find((x) => x.id === 'next')?.items ?? []).map((it) => ({
    ...stepFromText(it.text, letters, (office) => inquiryHref(block, s, s.lot, office)),
    trust: it.trust === 'ink' ? ('ink' as const) : it.trust === 'red' ? ('red' as const) : ('pencil' as const),
  }));
}

/** The Next tab (team review, round 3): the detail of the step chosen in the tray's route (its words, its
 *  letter, the other steps one click away), "Watch this lot", and the letter itself. The tray stays the route. */
function NextDetail({ model, block, s, steps, onStep }: { model: LotModel; block: BlockFile; s: UrlState; steps: Step[]; onStep: (i: number) => void }) {
  const r = model.result;
  const sel = parcelByLot(block, s.lot) ?? block.parcels.find((p) => p.pin === r.pins[0])!;
  const k = Math.min(Math.max(1, s.step ?? 1), Math.max(1, steps.length)) - 1; // 0-based, clamped
  const st = steps[k];
  // The step's words after its cost tag ("Free: City Real Estate and the URA. What would …").
  const colon = st ? st.text.indexOf(': ') : -1;
  const body = st && st.tag && colon > 0 ? st.text.slice(colon + 2) : st?.text ?? '';
  return (
    <section className="wall next-wall ws-next" aria-labelledby="next-h" data-panel="next">
      <div className="ws-next-top">
        <h2 id="next-h" className="wall-title">
          What to check next{st ? <span className="wall-sub"> · step {k + 1} of {steps.length}</span> : null}
        </h2>
        <p className="ws-watch">
          <WatchToggle pin={sel.pin} />
        </p>
      </div>
      {st ? (
        <>
          <div className="ws-next-nav" role="group" aria-label="Steps of the route, cheapest to learn first">
            {steps.map((x, i) => (
              <button key={i} type="button" className={`ws-next-dot ${i === k ? 'is-on' : ''}`} aria-pressed={i === k} aria-label={`Step ${i + 1}: ${x.head}`} title={x.head} onClick={() => onStep(i)}>
                {i + 1}
              </button>
            ))}
          </div>
          <ol className="next-steps ws-next-step" start={k + 1}>
            <li data-step={k + 1} data-trust={st.trust ?? 'pencil'}>
              {st.tag ? (
                <span className="step-tag" data-step-tag={st.tag.toLowerCase()}>
                  {st.tag}
                </span>
              ) : null}
              {/* The step's own words, its first phrase (the tray's line) set as the lead. */}
              <p className={`ws-next-body${st.trust === 'pencil' ? ' pencil-text' : ''}`}>
                {body.toLowerCase().startsWith(st.head.toLowerCase()) ? (
                  <>
                    <strong className="ws-next-head">{st.head}</strong>
                    {body.slice(st.head.length)}
                  </>
                ) : (
                  body
                )}
              </p>
              {st.links.length > 0 && (
                <p className="ws-next-letters">
                  {st.links.map((l) => (
                    <a key={l.href} className="btn btn-small" href={l.href}>
                      Letter to {l.label}
                    </a>
                  ))}
                </p>
              )}
            </li>
          </ol>
        </>
      ) : (
        <p className="na">— nothing to check until the lot can be scored.</p>
      )}
      <p>
        <a className="btn btn-ink" href={inquiryHref(block, s, s.lot)}>
          Draft the letter
        </a>{' '}
        <span className="small muted">A draft: you decide whether and where to send it.</span>
      </p>
    </section>
  );
}

export function LotInspector({
  model,
  block,
  s,
  onTab,
  onTry,
  onStep,
  update,
}: {
  model: LotModel;
  block: BlockFile;
  s: UrlState;
  onTab: (t: InspectorTab) => void;
  onTry: (o: UnlockOption) => void;
  onStep: (i: number) => void; // choose a step of the route (0-based): the Next tab shows its detail
  update?: (p: Partial<UrlState>, o?: { push?: boolean }) => void; // the builder's quote
}) {
  const r = model.result;
  const v = model.verdict;
  const chip = (id: VerdictChip['id']) => v.chips.find((c) => c.id === id);
  const sel: Parcel = parcelByLot(block, s.lot) ?? block.parcels.find((p) => p.pin === r.pins[0])!;
  const lots = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!.lot ?? 0).sort((a, b) => a - b);
  const addr = sel.addr.replace(/\s*\(no number\)$/, '');
  // A refused group names only the selected lot (the rest may not exist or may not touch it).
  const title = `${addr} · ${lots.length > 1 && r.state === 'ok' ? `lots ${lots[0]}–${lots[lots.length - 1]}` : `lot ${lotKey(sel)}`}`;
  // The way forward, on the first screen (judge round 2): the recommended option, or the one with fewest approvals.
  const step = nextStep(model.unlock, block);
  const way = step.primary ?? step.fewest;
  const wayW = way?.result.width ? ftFmt(way.result.width.deed ?? way.result.width.mapped) : null;
  const wayOthers = way ? way.scenario.pins.map((pin) => block.parcels.find((p) => p.pin === pin)!).filter((p) => !p.city).map((p) => `lot ${lotKey(p)}`) : [];
  // Only when this scenario doesn't already fit on dimensions: then there's something to unlock.
  const fitsNow = r.state === 'ok' && ['width', 'depth', 'area', 'height'].every((id) => r.checks.find((c) => c.id === id)?.status === 'pass');
  const unlockLine =
    r.state !== 'ok' || fitsNow ? null : way ? (
      <p className="ws-way" data-way>
        <span className="label">Way forward</span>{' '}
        <button className="link" onClick={() => onTry(way)}>
          {way.label}
        </button>
        {wayW ? `: ${wayW} ft` : ''}
        {wayOthers.length ? `; needs ${wayOthers.join(' and ')}, not City-owned` : ''}.
      </p>
    ) : (
      <p className="ws-way" data-way>
        <span className="label">Way forward</span> {varianceWords(r.relief.some((x) => x.check === 'width' && x.text.startsWith('side setbacks')), model.vctx, r.district)}
      </p>
    );
  const changed = refreshChangesFor(r.pins);
  const w = r.width;
  const comps = block.meta.ward != null ? COMPS_BY_WARD[block.meta.ward] ?? null : null;
  const rco = (sel.overlays ?? []).find((o) => o.startsWith('RCO'))?.replace(/^RCO - /, '');
  const wc = r.checks.find((c) => c.id === 'width');
  const wTrust = wc?.trust === 'red' ? 'red' : wc && (wc.status === 'open' || wc.trust === 'pencil') ? 'pencil' : 'ink';
  // The engine's explanation after its width part (which the sentence and the wall's verdict already say):
  // the contextual-setback note and the owners, from the contextual check's own words onward.
  const ctxCheck = r.checks.find((c) => c.id === 'contextual');
  const expl = explanation(r, block, model.vctx);
  const ctxAt = ctxCheck ? expl.findIndex((sg) => sg.t === ctxCheck.text) : -1;
  const whyTail = ctxAt >= 0 ? expl.slice(ctxAt) : [];

  // A single lot that a rule what-if (spec §0.16) would open: one line in the Rules tab, never a verdict.
  const wi = r.pins.length === 1 ? whatIfLine(r.pins[0], r.scenario.type) : null;
  const tabs: TabDef[] = [
    {
      id: 'money',
      label: 'Money',
      glyph: glyphOf(chip('money')),
      panel: (
        <>
          {model.money?.new_build && update ? <QuoteForm s={s} update={update} /> : null}
          <MoneyPanel result={r} m={model.money} gap={model.moneyGap} />
        </>
      ),
    },
    {
      id: 'rules',
      label: 'Rules',
      glyph: glyphOf(chip('rules')),
      panel: (
        <>
          {/* The width conclusion once, above the table (team review, round 3: it was stated five times): the
              engine's sentence, then the rules wall's verdict (the fix) right over the ledger. How the width is
              measured and why the district setback stands follow the table. */}
          <p className="ws-engine-sentence" data-rules-conclusion>
            <Segs segs={headline(r, block, model.ctx.rs)} />
          </p>
          {wi && (
            <p className="small whatif-lot" data-whatif-lot={wi.ids.join(',')}>
              <span className="stamp stamp-pencil whatif-stamp">What-if</span> {wi.words}
            </p>
          )}
          <RulesWall result={r} rs={model.ctx.rs} unlock={model.unlock} onTry={onTry} block={block} vctx={model.vctx} />
          {r.state === 'ok' && w ? (
            <p className="small ws-width-line">
              How it’s measured: <Gloss k="asofright">as of right</Gloss>,{' '}
              <Ev trust={wTrust} refId="measure:width" num>
                {w.formula}
              </Ev>{' '}
              {w.deed != null ? 'by deed' : 'on the City map'} · {ftFmt(w.mapped)} ft on the City map. The <Gloss k="envelope">envelope</Gloss> is what the{' '}
              <Gloss k="setback">setbacks</Gloss> leave.
            </p>
          ) : null}
          {whyTail.length ? (
            <p className="explain small">
              <Segs segs={whyTail} />
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: 'site',
      label: 'Site',
      glyph: glyphOf(chip('site')),
      panel: (
        <>
          <ChipLine c={chip('site')} />
          <SitePanel rows={model.site} />
          <p className="small muted ws-limits">
            Not assessed, never scored: water and sewer capacity, soils and fill, title and liens, community priorities{rco ? ` (RCO: ${rco})` : ''}. Parcel shapes come from GIS, not a survey.{' '}
            <a href={`?view=about&block=${block.meta.id}&section=limits`}>What 24×100 doesn’t know</a>
          </p>
        </>
      ),
    },
    {
      id: 'next',
      label: 'Next',
      panel: (
        <>
          <NextDetail model={model} block={block} s={s} steps={lotSteps(model, block, s)} onStep={onStep} />
          <NextAnswer model={model} block={block} s={s} onTry={onTry} />
          <Letters model={model} block={block} s={s} />
        </>
      ),
    },
    {
      id: 'sources',
      label: 'Sources',
      panel: (
        <>
          <RecordList rows={block.meta.sources} title={`Records · ${block.meta.name}`} />
          <MoneySources comps={comps} />
          <RuleSources rs={model.ctx.rs} />
          <p className="small muted">{DISCLAIMER}</p>
        </>
      ),
    },
  ];

  return (
    <InspectorShell
      title={title}
      status={<VerdictStamp headline={v.headline} refusal={r.refusal?.code} quote={!!model.money?.quote} />}
      statusDetail={
        <>
          <Label as="h3">What blocks it</Label>
          <VerdictBlock v={v} />
        </>
      }
      sentence={<LotSentence r={r} m={model.money} block={block} detail={v.detail} />}
      note={
        <>
          {unlockLine}
          {changed.length ? (
          <p className="ws-refresh pencil-text" data-trust="pencil">
            Changed on the last refresh ({REFRESH?.meta?.run_at?.slice(0, 10)}): {changed.map((c) => `${c.field} ${String(c.before ?? '—')} → ${String(c.after ?? '—')}`).join('; ')}. Pencil until someone checks it.
          </p>
          ) : null}
        </>
      }
      tiles={<LotTiles model={model} />}
      tabs={tabs}
      active={s.tab}
      onTab={onTab}
    />
  );
}

