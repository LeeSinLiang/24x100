// The inspector for a lot with block detail (spec §0.15): header, four tiles, and the tabs Money ·
// Rules · Site · Next · Sources. The tabs hold today's lot-page panels, unchanged in substance.
import { explanation, headline, nextStep, placeName, type VerdictChip } from '@engine/index';
import { varianceWords } from '@engine/verdict';
import type { BlockFile, Parcel } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { MoneyPanel, EstimateMark, NextSteps, SitePanel, VerdictBlock } from '../Panels';
import { RulesWall } from '../Walls';
import { Ev, ftFmt, Label, DISCLAIMER } from '../ui';
import { COMPS_BY_WARD, REFRESH, refreshChangesFor } from '../../lib/data';
import { lotKey, parcelByLot, type LotModel } from '../../lib/model';
import type { InspectorTab, UrlState } from '../../lib/url';
import { Dash, InspectorShell, Tile, type TabDef } from './Shell';
import { Gloss, kFmt, LotSentence, VerdictStamp } from './plain';
import { Segs } from './Segs';
import { MoneySources, RecordList, RuleSources } from './Sources';
import { WatchToggle } from '../WatchToggle';

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
  return `?view=inquiry&block=${block.meta.id}&lot=${lot}&type=${s.type}${s.lots.length > 1 ? `&lots=${s.lots.join(',')}` : ''}${s.assume.length ? `&assume=${s.assume.join(',')}` : ''}${office ? `&letter=${office}` : ''}`;
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
  const A = m?.estimates.find((e) => e.default) ?? m?.estimates[0];
  const moneyWhy = m ? 'no recent new-build sale in this ward' : model.moneyGap ?? 'no money data';
  return (
    <>
      <Tile
        id="width"
        label="Buildable width"
        title={caption}
        className={`tone-${tone}`}
        value={
          <span className="numeral-block" data-trust={trust === 'ink' && check.status !== 'open' ? 'ink' : trust === 'red' ? 'red' : 'pencil'}>
            <Ev trust={trust} refId="measure:width" className="numeral" title={w.formula}>
              {w.none ? '0' : ftFmt(v)}
              <span className="numeral-unit">ft</span>
            </Ev>
          </span>
        }
        sub={
          <>
            {check.alternative ? (
              <>
                or{' '}
                <Ev trust={check.alternative.trust === 'red' ? 'red' : 'pencil'} refId={`question:${check.alternative.question_id}`} num>
                  {ftFmt(check.alternative.available)} ft
                </Ev>{' '}
                on the other reading ·{' '}
              </>
            ) : null}
            {row ? 'end units · ' : ''}your plan{' '}
            <Ev trust="red" refId="proposal:width" num>
              {ftFmt(check.required ?? 0)} ft
            </Ev>
          </>
        }
      />
      {A ? (
        <Tile
          id="cost"
          label="Build cost per home"
          title={`${A.label}: ${A.psf[0] === A.psf[1] ? `$${A.psf[0]}` : `$${A.psf[0]}–$${A.psf[1]}`}/sq ft × ${m!.sqft.toLocaleString('en-US')} sq ft. ${A.note} Source: ${A.supplied_by}.`}
          className="is-est"
          value={
            <span data-trust="estimate">
              <EstimateMark />
              <Ev trust="estimate" refId={`money:estimate:${A.id}`} num>
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
          sub={<span className="est">{A.supplied_by.replace(/ \(.*$/, '').replace(/, unconfirmed$/, '')}</span>}
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
          className="is-est"
          title={`${A.formula}. Before site work, soft costs and land; a practitioner's estimate.`}
          value={
            <span data-trust="estimate">
              <Ev trust="estimate" refId={`money:estimate:${A.id}`} num>
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
          sub={<span className="est">{A.left[0] < 0 ? 'nothing left, per home' : 'per home'}</span>}
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
      <Label as="h3">Draft letters · you decide whether to send them</Label>
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

export function LotInspector({
  model,
  block,
  s,
  onTab,
  onTry,
}: {
  model: LotModel;
  block: BlockFile;
  s: UrlState;
  onTab: (t: InspectorTab) => void;
  onTry: (o: UnlockOption) => void;
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

  const tabs: TabDef[] = [
    {
      id: 'money',
      label: 'Money',
      glyph: glyphOf(chip('money')),
      panel: (
        <>
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
          <ChipLine c={chip('rules')} />
          <p className="ws-engine-sentence">
            <Segs segs={headline(r, block, model.ctx.rs)} />
          </p>
          {r.state === 'ok' && w ? (
            <p className="small ws-width-line">
              <Gloss k="asofright">As of right</Gloss>:{' '}
              <Ev trust={wTrust} refId="measure:width" num>
                {w.none ? 'no buildable width' : `${ftFmt(w.deed ?? w.mapped)} ft`}
              </Ev>{' '}
              {w.deed != null ? 'by deed' : 'on the City map'} ({w.formula}) · {ftFmt(w.mapped)} ft on the City map. The{' '}
              <Gloss k="envelope">envelope</Gloss> is what the <Gloss k="setback">setbacks</Gloss> leave.
            </p>
          ) : null}
          <p className="explain">
            <Segs segs={explanation(r, block, model.vctx)} />
          </p>
          <RulesWall result={r} rs={model.ctx.rs} unlock={model.unlock} onTry={onTry} block={block} vctx={model.vctx} />
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
          <NextAnswer model={model} block={block} s={s} onTry={onTry} />
          <NextSteps inquiry={r.state === 'ok' ? model.inquiry : null} href={inquiryHref(block, s, s.lot)} />
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
      status={<VerdictStamp headline={v.headline} refusal={r.refusal?.code} />}
      statusDetail={
        <>
          <Label as="h3">What blocks it</Label>
          <VerdictBlock v={v} />
        </>
      }
      action={<WatchToggle pin={sel.pin} />}
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

