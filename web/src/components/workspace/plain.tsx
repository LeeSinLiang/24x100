// Plain words for the inspector header and tiles (spec §0.15): no jargon in headlines, the status
// sentence or tile labels. Jargon lives in the tabs, behind a glossary tooltip. Every number here is
// read from the engine's result; nothing is computed.
import type { ReactNode } from 'react';
import { needsUseVariance } from '@engine/evaluate';
import { HEADLINE_WORDS, type Headline } from '@engine/verdict';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, LotResult, MoneyResult, TemplateId } from '@engine/types';
import { usd } from '@engine/format';
import { Ev, ftFmt } from '../ui';

/** The glossary (DESIGN_GUIDE §8), shown as a dotted-underline tooltip on first use in a tab. */
export const GLOSSARY: Record<string, string> = {
  asofright: 'As of right: allowed without a hearing or special approval.',
  setback: 'Setback: the distance a building must keep from a lot line.',
  variance: 'Variance: permission from the Zoning Board of Adjustment to depart from a dimensional rule, after a hearing.',
  envelope: 'Envelope: the part of the lot left after setbacks.',
  rco: 'RCO: Registered Community Organization; hosts the community meeting for a project.',
  district: 'Zoning district (RM‑M, R1D‑H, …): each has its own setbacks and minimum lot size.',
  ami: 'AMI: Area Median Income, from HUD’s income limits for the Pittsburgh area.',
  trust: 'Ink is known (a person checked it against its source). Pencil is not known yet. Red is yours: your proposal and your assumptions. Violet is a practitioner’s estimate.',
};

export function Gloss({ k, children }: { k: keyof typeof GLOSSARY | string; children: ReactNode }) {
  const def = GLOSSARY[k];
  if (!def) return <>{children}</>;
  return (
    <span className="gloss" tabIndex={0} title={def} aria-label={`${typeof children === 'string' ? children : ''} (${def})`}>
      {children}
    </span>
  );
}

/** "$270k", "−$30k", "$9.6k": the tile's short money (one decimal under $100k, so $9,600 never reads as $10k). */
export function kFmt(n: number): string {
  const k = n / 1000;
  const v = Math.abs(k) >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}k`;
}

export function aType(type: TemplateId): string {
  return type === 'row' ? 'rowhouses' : `a ${TEMPLATES[type].name.toLowerCase()}`;
}

const n = (v: number) => v.toLocaleString('en-US');

// ── The status chip: the engine's verdict words, as a stamp ──────────────────────────────────────
const MONEY_HEADLINES: Headline[] = ['only_with_subsidy', 'depends_on_builder', 'worth_pricing_site'];

export function VerdictStamp({ headline, refusal, quote }: { headline: Headline; refusal?: string | null; quote?: boolean }) {
  if (headline === 'cant_tell') {
    const grey = refusal === 'missing_rule';
    return (
      <span className={`stamp stamp-refuse ws-stamp ${grey ? 'is-grey' : ''}`} data-verdict={headline} title={HEADLINE_WORDS[headline]}>
        {grey ? 'RULES NOT LOADED' : 'CAN’T SCORE'}
      </span>
    );
  }
  const words = HEADLINE_WORDS[headline];
  const m = words.match(/^(.*?)\s*\((screening estimate)\)$/);
  const est = MONEY_HEADLINES.includes(headline);
  // With the user's own builder's quote, the money verdict is theirs: red, and it says so.
  const mine = est && quote;
  return (
    <span className={`stamp ws-stamp ${mine ? 'stamp-subsidy is-quote' : est ? 'stamp-subsidy' : 'stamp-ink'}`} data-verdict={headline} data-quote={mine ? '1' : undefined} title={/as of right/.test(words) ? `${words}. ${GLOSSARY.asofright}` : words}>
      {(m ? m[1] : words).toUpperCase()}
      {m && <small>{mine ? 'your builder’s quote' : m[2]}</small>}
    </span>
  );
}

// ── The one plain sentence ────────────────────────────────────────────────────────────────────────
function lotsPhrase(r: LotResult, block: BlockFile): string {
  if (r.pins.length < 2) return 'This lot';
  const lots = r.pins.map((p) => block.parcels.find((x) => x.pin === p)?.lot ?? 0).sort((a, b) => a - b);
  return `Together, lots ${lots[0]}–${lots[lots.length - 1]}`;
}

function moneyClause(m: MoneyResult | null): ReactNode {
  if (!m) return <>money isn’t checked for this lot</>;
  if (m.money_verdict === 'no_new_build' || !m.new_build) return <>there is no recent new-build sale in this ward to compare</>;
  // The deciding estimate: the user's builder's quote when given (red, theirs), else the practitioner's.
  const A = m.quote ?? m.estimates.find((e) => e.default) ?? m.estimates[0];
  const ev = m.quote ? ({ trust: 'red' } as const) : ({ trust: 'estimate', refId: `money:estimate:${A.id}` } as const);
  const at = m.quote ? ' at your builder’s quote' : '';
  if (m.money_verdict === 'only_with_subsidy')
    return A.left[0] < 0 ? (
      <>building costs more than the newest sale{at}</>
    ) : (
      <>
        at most{' '}
        <Ev {...ev} num>
          {usd(A.left[0], 100)}
        </Ev>{' '}
        is left per home{at}, under typical site work
      </>
    );
  if (m.money_verdict === 'depends_on_builder') return <>whether any money is left depends on the builder’s price</>;
  return (
    <>
      building leaves{' '}
      <Ev {...ev} num>
        {A.left[0] === A.left[1] ? usd(A.left[0], 100) : `${usd(A.left[1], 100)}–${usd(A.left[0], 100)}`}
      </Ev>{' '}
      per home for the site{at}: worth pricing it
    </>
  );
}

export function LotSentence({ r, m, block, detail }: { r: LotResult; m: MoneyResult | null; block: BlockFile; detail: string }) {
  if (r.state !== 'ok') {
    const v = r.refusal?.values;
    if (r.refusal?.code === 'records_disagree' && v && typeof v.assessed === 'number' && typeof v.mapped === 'number')
      return (
        <>
          The County says this lot is <Ev num>{n(v.assessed)} sf</Ev>; the City map measures <Ev num>{n(v.mapped)} sf</Ev>. Until someone settles it, we can’t tell.
        </>
      );
    if (r.refusal?.code === 'missing_rule') return <>The rules for this lot’s district aren’t loaded and checked yet, so we can’t tell.</>;
    return <>{detail}</>;
  }
  const type = r.scenario.type;
  const w = r.checks.find((c) => c.id === 'width')!;
  const avail = r.width ? r.width.deed ?? r.width.mapped : 0;
  const wTrust = w.trust === 'red' ? 'red' : w.status === 'open' || w.trust === 'pencil' ? 'pencil' : 'ink';
  const width = (
    <Ev trust={wTrust} refId="measure:width" num>
      {ftFmt(avail)} ft
    </Ev>
  );
  const req = (
    <Ev trust="red" refId="proposal:width" num>
      {ftFmt(w.required ?? 0)} ft
    </Ev>
  );
  const where = lotsPhrase(r, block);
  const plural = r.pins.length > 1;
  const dims = ['depth', 'area', 'height'];
  const otherFail = r.checks.find((c) => dims.includes(c.id) && c.status === 'fail' && c.trust !== 'red');
  const useNo = needsUseVariance(r);
  const useInk = useNo && r.approvals.ink.some((a) => a.kind === 'use_variance');
  const alt = w.alternative ? (
    <Ev trust={w.alternative.trust === 'red' ? 'red' : 'pencil'} refId={`question:${w.alternative.question_id}`} num>
      {ftFmt(w.alternative.available)} ft
    </Ev>
  ) : null;
  let rules: ReactNode;
  if (w.trust === 'red')
    rules = (
      <>
        {where} {plural ? 'fit' : 'fits'} {aType(type)} only under your assumption ({width} to build on)
      </>
    );
  else if (w.status === 'open')
    rules = (
      <>
        {type === 'row' ? 'End units get' : `${where} ${plural ? 'leave' : 'leaves'}`} {width}
        {alt ? <> to build on, or {alt} depending on a question for the City</> : <> to build on, depending on a question for the City</>}, and your plan is {req} wide
      </>
    );
  else if (w.status === 'fail')
    rules = (
      <>
        The rules leave only {width} to build on, against your {req} plan
      </>
    );
  else if (otherFail)
    rules = (
      <>
        {where} {plural ? 'are' : 'is'} wide enough, but {otherFail.id === 'area' ? 'too small' : otherFail.id === 'depth' ? 'too shallow' : 'the height limit is under your plan'} for {aType(type)}
      </>
    );
  else
    rules = (
      <>
        {where} {plural ? 'leave' : 'leaves'} {width} to build on, enough for {aType(type)}
        {wTrust === 'pencil' ? ', pending a check of the rules' : ''}
        {useNo ? `, but ${useInk ? '' : 'an unchecked reading says '}the rules don’t allow ${aType(type)} here` : ''}
      </>
    );
  return (
    <>
      {rules}; {moneyClause(m)}.
    </>
  );
}

// ── Combine to fit (C15): runs named by their County lot numbers ───────────────────────────────────
// Judge round 2 read "625 Lawson St · 620 Lawson St" as opposite sides of the street; the lots do share
// lot lines (the finder pairs them from the parcel map). The block and lot numbers say so; the
// addresses stay as secondary text.

/** "10‑K" from a County PIN ("0010K00212000000"): the block number and letter. */
export function blockOfPin(pin: string): string {
  const m = pin.match(/^(\d{4})([A-Z])/);
  return m ? `${Number(m[1])}‑${m[2]}` : pin;
}

/** A run's lots by County number: "10‑K lots 25 · 26 · 27", or block by block when it spans two. */
export function runLotsLabel(lots: { pin: string; lot: string | null }[]): string {
  const lotOf = (l: { pin: string; lot: string | null }) => l.lot ?? String(Number(l.pin.slice(5, 10)));
  const blocks = [...new Set(lots.map((l) => blockOfPin(l.pin)))];
  if (blocks.length === 1) return `${blocks[0]} ${lots.length === 1 ? 'lot' : 'lots'} ${lots.map(lotOf).join(' · ')}`;
  return lots.map((l) => `${blockOfPin(l.pin)} lot ${lotOf(l)}`).join(' · ');
}

/** A run's addresses, as the City and County list them (secondary text). */
export function runAddrs(lots: { pin: string; addr: string | null }[]): string {
  return lots.map((l) => l.addr ?? 'no address').join(' · ');
}

/** The honesty line for the addresses in a run; shown once on a screen that lists runs. */
export const RUN_ADDR_NOTE = 'Addresses are the City’s and County’s; lots are paired from the parcel map, not by house number.';

/** Lot groups, counted honestly: `cityLots` the City-owned lots they touch, `candidates` the City lots among
 *  them that don't fit alone (the finder's candidates; film/facts.json counts these), each counted once;
 *  `shared` whether any lot sits in more than one group. */
export function runCounts(runs: { lots: { pin: string; city: boolean }[]; candidates: string[] }[]): { cityLots: number; candidates: number; shared: boolean } {
  const all = runs.flatMap((r) => r.lots.map((l) => l.pin));
  return {
    cityLots: new Set(runs.flatMap((r) => r.lots.filter((l) => l.city).map((l) => l.pin))).size,
    candidates: new Set(runs.flatMap((r) => r.candidates)).size,
    shared: new Set(all).size < all.length,
  };
}
