// Categories instead of a score (spec §0.12 C1). One headline and three chips, Money · Rules · Site,
// checked in that order because that is the order it costs least to learn them (a money screen is
// free; a variance and site studies cost months and money). The order says nothing about which barrier
// blocks more often: that is unproven (H5).
import { usd } from './format';
import { needsUseVariance } from './evaluate';
import type { BlockFile, LotResult, MoneyResult, Evidence } from './types';

export type Headline = 'cant_tell' | 'only_with_subsidy' | 'doesnt_fit' | 'depends_on_builder' | 'worth_pricing_site' | 'worth_a_look';

export const HEADLINE_WORDS: Record<Headline, string> = {
  cant_tell: "Can't tell yet",
  only_with_subsidy: 'Only with subsidy (screening estimate)',
  doesnt_fit: "Doesn't fit as of right",
  depends_on_builder: "Depends on the builder's price",
  worth_pricing_site: 'Worth pricing the site',
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
  // Money: what a new-build sale leaves after vertical construction, at the practitioner estimate (A).
  const A = m?.estimates.find((e) => e.default);
  if (m && A && m.money_verdict !== 'no_new_build') {
    const words =
      m.money_verdict === 'only_with_subsidy'
        ? A.left[0] < 0
          ? "nothing left: building alone costs more than the best new-build sale (practitioner's estimate)"
          : `at most ${usd(A.left[0], 100)} left per home for site work, soft costs and land (practitioner's estimate), under the $${Math.round(m.site_work.lo / 1000)}k typical site work`
        : m.money_verdict === 'worth_pricing_site'
          ? `${usd(A.left[1], 100)}–${usd(A.left[0], 100)} left per home for site work, soft costs and land (practitioner's estimate)`
          : `left per home depends on the builder: ${usd(A.left[0], 100)} at best, ${A.left[1] < 0 ? 'nothing' : usd(A.left[1], 100)} at worst (practitioner's estimate)`;
    chips.push({ id: 'money', state: m.money_verdict === 'only_with_subsidy' ? 'blocks' : m.money_verdict === 'worth_pricing_site' ? 'clear' : 'open', words, evidence: 'estimate' });
  } else chips.push({ id: 'money', state: 'unknown', words: `not assessed: ${m && m.money_verdict === 'no_new_build' ? 'no recent new-build sale in this ward' : moneyGap ?? (r.state !== 'ok' ? 'the lot is not scored' : 'no money data')}`, evidence: 'unknown' });

  // Rules.
  const width = r.checks.find((c) => c.id === 'width');
  const dimFail = r.state === 'ok' && r.checks.some((c) => ['width', 'depth', 'area', 'height'].includes(c.id) && c.status === 'fail' && c.trust !== 'red');
  const dimOpen = r.state === 'ok' && r.checks.some((c) => ['width', 'depth', 'area', 'height'].includes(c.id) && (c.status === 'open' || c.status === 'needs_survey' || c.trust !== 'ink'));
  const otherOpen = r.state === 'ok' && r.checks.some((c) => ['use', 'parking', 'grading'].includes(c.id) && c.status === 'open');
  const sideRelief = r.relief.some((x) => x.check === 'width');
  // The use table can block a building type even when it fits: a "not permitted" reading (ink or pencil)
  // means a use variance, and the Rules chip never says "fits".
  const useNo = needsUseVariance(r);
  const useInk = useNo && r.approvals.ink.some((a) => a.kind === 'use_variance');
  const useText = r.checks.find((c) => c.id === 'use')?.text ?? '';
  const refusedWords: Record<string, string> = {
    missing_rule: 'rules not loaded for this district',
    records_disagree: "can't tell: the records disagree",
    not_adjacent: "can't tell: these lots don't share lot lines",
    mixed_districts: "can't tell: these lots are in different districts",
  };
  if (r.state !== 'ok') chips.push({ id: 'rules', state: 'unknown', words: refusedWords[r.refusal?.code ?? ''] ?? `can't tell: ${r.refusal?.reason ?? 'not scored'}`, evidence: 'unknown' });
  else if (dimFail) chips.push({ id: 'rules', state: 'blocks', words: `doesn't fit as of right: ${r.relief.map((x) => x.text).join('; ')}${useNo ? `; ${useText}` : ''}`, evidence: 'ink' });
  else if (useNo) chips.push({ id: 'rules', state: 'blocks', words: `the use isn't permitted${useInk ? '' : ' (an unreviewed reading)'}: ${useText}`, evidence: useInk ? 'ink' : 'pencil' });
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
    const code = r.refusal?.code;
    detail =
      code === 'missing_rule'
        ? 'The rules for this district haven’t been loaded and checked.'
        : code === 'records_disagree'
          ? 'The County’s lot area and the City’s map disagree; settle the records first.'
          : (r.refusal?.reason ?? 'This scenario could not be scored.');
  } else if (m && m.money_verdict === 'only_with_subsidy') {
    headline = 'only_with_subsidy';
    detail = `At a practitioner's estimate (${usd(A!.psf[0], 1)}–${usd(A!.psf[1], 1)}/sq ft), building one home costs ${usd(A!.vertical[0], 100)}–${usd(A!.vertical[1], 100)}; the newest new build sold for ${usd(m.new_build!.value)}. That leaves ${A!.left[0] < 0 ? 'nothing' : `at most ${usd(A!.left[0], 100)}`} for site work, soft costs and land, before site work that typically runs ${usd(m.site_work.lo)}–${usd(m.site_work.hi)}.`;
  } else if (dimFail || useNo) {
    headline = 'doesnt_fit';
    const useLine = useNo ? `${useInk ? 'The use table says' : 'An unreviewed reading of the use table says'} this building type isn't permitted here; a use variance from the Zoning Board of Adjustment is a possible route, not approval.` : '';
    detail = dimFail ? `${r.relief.map((x) => x.text).join('; ')}. ${varianceWords(sideRelief)}${useLine ? ` ${useLine}` : ''}` : useLine;
  } else if (m && m.money_verdict === 'depends_on_builder') {
    headline = 'depends_on_builder';
    detail = `At the practitioner's estimate what's left per home runs from ${usd(A!.left[0], 100)} to ${A!.left[1] < 0 ? 'nothing' : usd(A!.left[1], 100)}: a builder's price decides it.`;
  } else if (m && m.money_verdict === 'worth_pricing_site') {
    headline = 'worth_pricing_site';
    detail = `At the practitioner's estimate, ${usd(A!.left[1], 100)}–${usd(A!.left[0], 100)} is left per home, which covers typical site work (${usd(m.site_work.lo)}–${usd(m.site_work.hi)}, not a cap). Price the site next.`;
  } else {
    headline = 'worth_a_look';
    if (!m || m.money_verdict === 'no_new_build') conditions.push(`the money works (${moneyGap ?? 'no recent new-build sale to compare'})`);
    if (width?.status === 'open') conditions.push('the City reads the narrow-lot rule to cover attached houses');
    if (dimOpen && width?.status !== 'open') conditions.push('a person checks the unreviewed rules');
    if (otherOpen) conditions.push('use, parking and grading are confirmed');
    if (others.length) conditions.push(`${others.map((p) => `lot ${p.lot}`).join(' and ')} can be bought`);
    conditions.push('the site investigations find nothing that changes the cost');
    detail = `Worth a closer look if ${conditions.join('; ')}.`;
  }
  const order_key = { cant_tell: 5, only_with_subsidy: 4, doesnt_fit: 3, depends_on_builder: 2, worth_pricing_site: 1, worth_a_look: 0 }[headline];
  return { headline, words: HEADLINE_WORDS[headline], detail, conditions, chips, order_key };
}


// ── Site unknowns (C5): free public signals, and what resolves each. No dollar amounts. ─────────

export interface SiteRow {
  id: 'undermining' | 'environmental' | 'fill' | 'soil' | 'water';
  label: string;
  deal_killer: boolean; // "can stop a deal early" (a practitioner at the hackathon)
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
      id: 'undermining',
      label: 'Undermining',
      deal_killer: true,
      signals: [under ? 'Part of the lot is in a mapped undermined area (City layer).' : 'None mapped on the City’s undermined-areas layer. A blank map is not proof.'],
      resolves: 'the state’s mine maps and a geotechnical investigation',
      cost: 'free to look first; then ask a professional',
    },
    {
      id: 'environmental',
      label: 'Environmental',
      deal_killer: true,
      signals: [y1927 ? `Past use: the 1927 zoning map put this block in ${y1927}${/commercial|industr/i.test(y1927) ? ', a commercial district' : ''}.` : 'Past use: not in our data.', 'We hold no contamination records for the lot.'],
      resolves: 'free state and federal environmental records first, then a Phase I Environmental Site Assessment',
      cost: 'free to look first; then ask a professional',
    },
    {
      id: 'fill',
      label: 'Former house demolished into its basement?',
      deal_killer: false,
      signals: ['A practitioner says this is common on City vacant lots: buried debris and fill that need over-excavation. Likely on many City lots; not checked for this lot.'],
      resolves: 'test pits or a geotechnical investigation',
      cost: 'ask a professional',
    },
    {
      id: 'soil',
      label: 'Soil and slope',
      deal_killer: false,
      signals: [`Share of the lot at 25%+ slope (City slope layer): ${slopes.join(', ')}.`],
      resolves: 'a geotechnical investigation',
      cost: 'ask a professional',
    },
    {
      id: 'water',
      label: 'Water and sewer',
      deal_killer: false,
      signals: ['How deep and where the lines are sets the tap cost. No parcel-level public water or sewer data is in our pipeline; location, condition and capacity are three different questions.'],
      resolves: 'a PWSA records or tap-in inquiry, and utility location',
      cost: 'ask a professional',
    },
  ];
}
