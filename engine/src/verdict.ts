// Categories instead of a score (spec §0.12 C1). One headline and three chips, Money · Rules · Site,
// checked in that order because that is the order it costs least to learn them (a money screen is
// free; a variance and site studies cost months and money). The order says nothing about which barrier
// blocks more often: that is unproven (H5).
import { usd } from './format';
import type { BlockFile, LotResult, MoneyResult, Evidence } from './types';

export type Headline = 'cant_tell' | 'only_with_subsidy' | 'doesnt_fit' | 'worth_a_look';

export const HEADLINE_WORDS: Record<Headline, string> = {
  cant_tell: "Can't tell yet",
  only_with_subsidy: 'Only with subsidy (screening estimate)',
  doesnt_fit: "Doesn't fit as of right",
  worth_a_look: 'Worth a closer look, if …',
};

export type ChipState = 'blocks' | 'open' | 'clear' | 'unknown';

export interface VerdictChip {
  id: 'money' | 'rules' | 'site';
  state: ChipState;
  words: string;
  evidence: Evidence | 'pencil' | 'unknown';
}

export interface Verdict {
  headline: Headline;
  words: string;
  detail: string;
  conditions: string[]; // for "worth a closer look, if …"
  chips: VerdictChip[];
  order_key: number; // internal sort key only; never displayed
}

/** C6: variance wording, everywhere. */
export function varianceWords(sideSetbacks: boolean): string {
  return sideSetbacks
    ? 'A side-setback variance is a plausible route (a practitioner at the hackathon called this a clear hardship case). It is not approval, and it adds time and cost we can’t estimate.'
    : 'A variance is a possible route. It is not approval, and it adds time and cost we can’t estimate.';
}

export function verdictFor(r: LotResult, m: MoneyResult | null, moneyGap: string | null, block: BlockFile): Verdict {
  const chips: VerdictChip[] = [];
  // Money.
  if (m) {
    chips.push(
      m.gap.positive
        ? { id: 'money', state: 'blocks', words: `vertical cost alone exceeds the highest value signal by at least ${usd(m.gap.lower_bound)} per home`, evidence: 'estimate' }
        : { id: 'money', state: 'clear', words: 'vertical cost is within the highest value signal (site work, land, soft costs and financing not included)', evidence: 'estimate' },
    );
  } else chips.push({ id: 'money', state: 'unknown', words: `not assessed: ${moneyGap ?? (r.state !== 'ok' ? 'the lot is not scored' : 'no money data')}`, evidence: 'unknown' });

  // Rules.
  const width = r.checks.find((c) => c.id === 'width');
  const dimFail = r.state === 'ok' && r.checks.some((c) => ['width', 'depth', 'area', 'height'].includes(c.id) && c.status === 'fail' && c.trust !== 'red');
  const dimOpen = r.state === 'ok' && r.checks.some((c) => ['width', 'depth', 'area', 'height'].includes(c.id) && (c.status === 'open' || c.status === 'needs_survey' || c.trust !== 'ink'));
  const otherOpen = r.state === 'ok' && r.checks.some((c) => ['use', 'parking', 'grading'].includes(c.id) && c.status === 'open');
  const sideRelief = r.relief.some((x) => x.check === 'width');
  if (r.state !== 'ok') chips.push({ id: 'rules', state: 'unknown', words: r.refusal?.code === 'missing_rule' ? 'rules not loaded for this district' : "can't tell: the records disagree", evidence: 'unknown' });
  else if (dimFail) chips.push({ id: 'rules', state: 'blocks', words: `doesn't fit as of right: ${r.relief.map((x) => x.text).join('; ')}`, evidence: 'ink' });
  else if (dimOpen) chips.push({ id: 'rules', state: 'open', words: width?.status === 'open' ? 'depends on an open question for the City' : 'fits on unreviewed rules (pencil)', evidence: 'pencil' });
  else chips.push({ id: 'rules', state: otherOpen ? 'open' : 'clear', words: `fits as of right on dimensions${otherOpen ? '; use, parking or grading still unconfirmed' : ''}`, evidence: otherOpen ? 'pencil' : 'ink' });

  // Site: never assessed; never "clean".
  chips.push({ id: 'site', state: 'unknown', words: 'not assessed: soil, environmental, water and sewer', evidence: 'unknown' });

  const others = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!).filter((p) => !p.city);
  let headline: Headline;
  let detail: string;
  const conditions: string[] = [];
  if (r.state !== 'ok') {
    headline = 'cant_tell';
    detail = r.refusal?.code === 'missing_rule' ? 'The rules for this district haven’t been loaded and checked.' : 'The County’s lot area and the City’s map disagree; settle the records first.';
  } else if (m && m.gap.positive) {
    headline = 'only_with_subsidy';
    detail = `Vertical construction alone (${usd(m.vertical.lo)}–${usd(m.vertical.hi)} per home) exceeds the highest value signal (${usd(signalValue(m))}) by at least ${usd(m.gap.lower_bound)} per home, before site work, land, soft costs and financing.`;
  } else if (dimFail) {
    headline = 'doesnt_fit';
    detail = `${r.relief.map((x) => x.text).join('; ')}. ${varianceWords(sideRelief)}`;
  } else {
    headline = 'worth_a_look';
    if (!m) conditions.push(`the money works (${moneyGap ?? 'not assessed'})`);
    if (width?.status === 'open') conditions.push('the City reads the narrow-lot rule to cover attached houses');
    if (dimOpen && width?.status !== 'open') conditions.push('a person checks the unreviewed rules');
    if (otherOpen) conditions.push('use, parking and grading are confirmed');
    if (others.length) conditions.push(`${others.map((p) => `lot ${p.lot}`).join(' and ')} can be bought`);
    conditions.push('the site investigations find nothing that changes the cost');
    detail = `Worth a closer look if ${conditions.join('; ')}.`;
  }
  const order_key = { cant_tell: 3, only_with_subsidy: 2, doesnt_fit: 1, worth_a_look: 0 }[headline];
  return { headline, words: HEADLINE_WORDS[headline], detail, conditions, chips, order_key };
}

function signalValue(m: MoneyResult): number {
  return m.signals.find((s) => s.id === m.gap.signal)!.value;
}

// ── Site unknowns (C5): free public signals, and what resolves each. No dollar amounts. ─────────

export interface SiteRow {
  id: 'soil' | 'environmental' | 'water';
  label: string;
  signals: string[];
  resolves: string;
  cost: string;
}

export function siteUnknowns(r: LotResult, block: BlockFile): SiteRow[] {
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!).sort((a, b) => (a.lot ?? 0) - (b.lot ?? 0));
  const slopes = ps.map((p) => `${ps.length > 1 ? `lot ${p.lot}${p.lot_suffix ?? ''}: ` : ''}${Math.round(p.slope25 * 100)}%`);
  const under = ps.some((p) => p.undermined > 0);
  const y1927 = block.hist_zoning?.['1927'];
  return [
    {
      id: 'soil',
      label: 'Soil and foundations',
      signals: [
        `Share of the lot at 25%+ slope (City slope layer): ${slopes.join(', ')}.`,
        under ? `Part of the lot is in a mapped undermined area.` : 'Undermining: none mapped. A blank map is not proof.',
      ],
      resolves: 'a geotechnical investigation',
      cost: 'ask a professional',
    },
    {
      id: 'environmental',
      label: 'Environmental',
      signals: [y1927 ? `Past use: the 1927 zoning map put this block in ${y1927}${/commercial|industr/i.test(y1927) ? ', a commercial district' : ''}.` : 'Past use: not in our data.', 'We hold no contamination records for the lot.'],
      resolves: 'a Phase I Environmental Site Assessment',
      cost: 'ask a professional',
    },
    {
      id: 'water',
      label: 'Water and sewer',
      signals: ['No parcel-level public water or sewer data is in our pipeline. Where a line is, what condition it is in, and how much it can carry are three different questions.'],
      resolves: 'a PWSA records or tap-in inquiry',
      cost: 'ask a professional',
    },
  ];
}
