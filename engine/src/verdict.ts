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
  depends_on_builder: "Depends on the builder's price (screening estimate)",
  worth_pricing_site: 'Worth pricing the site (screening estimate)',
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

/** What the variance line can honestly add: how many lots on this street fail the same way (from the block's own
 *  results), and how many City-owned lots citywide are too narrow while big enough (build-time summary), with the
 *  districts that count covers. */
export interface VarianceContext {
  street?: { same: number; of: number; unscored?: number }; // lots on the row failing width the same way, of those scored
  stuck?: { n: number; districts: string[] };
}

/** Variance wording, everywhere (team decision, 27 Sep, replacing spec §0.12 C6's "clear hardship case" line). */
export function varianceWords(sideSetbacks: boolean, ctx: VarianceContext = {}, district: string | null = null): string {
  if (!sideSetbacks) return 'A variance from the Zoning Board is a possible route. That’s not guaranteed, and it adds time and cost we can’t estimate.';
  const st = ctx.street;
  const street =
    st && st.of > 1 && st.same >= 2
      ? st.same === st.of
        ? `, and every lot ${st.unscored ? 'we could check ' : ''}on this street has the same problem`
        : `, and ${st.same} of the ${st.of} lots we could check on this street have the same problem`
      : '';
  const k = ctx.stuck;
  const inDistrict = k && k.n > 0 && (!district || k.districts.includes(district));
  const fix = inDistrict ? ` The bigger fix is changing the rule: ${k!.n.toLocaleString('en-US')} City lots${k!.districts.length === 1 ? ` in ${k!.districts[0]}` : ''} are stuck the same way.` : ' The bigger fix is changing the rule.';
  return `Needs a variance from the Zoning Board. That’s not guaranteed${street}.${fix}`;
}

export function verdictFor(r: LotResult, m: MoneyResult | null, moneyGap: string | null, block: BlockFile, vctx: VarianceContext = {}): Verdict {
  const chips: VerdictChip[] = [];
  // Money: what a new-build sale leaves after vertical construction, at the practitioner estimate (A), or at the
  // user's own builder's quote when they gave one (red: theirs, not checked).
  const A = m?.quote ?? m?.estimates.find((e) => e.default);
  const by = m?.quote ? 'your builder’s quote, not checked' : "practitioner's estimate";
  if (m && A && m.money_verdict !== 'no_new_build') {
    // The full-cost gap per home, before land: building with soft costs and financing, plus site work, minus the sale.
    const g = m.gap;
    const gapRange = g ? (g.lo === g.hi ? usd(g.lo, 100) : `${usd(g.lo, 100)}–${usd(g.hi, 100)}`) : '';
    const words =
      m.money_verdict === 'only_with_subsidy'
        ? `a home needs ${gapRange} of subsidy before land, at full cost (${by})`
        : m.money_verdict === 'worth_pricing_site'
          ? `the sale covers full cost, site work included, even at the high end (${by})`
          : `the gap runs from nothing to ${usd(g?.hi ?? 0, 100)} a home before land: a builder's price decides it (${by})`;
    chips.push({ id: 'money', state: m.money_verdict === 'only_with_subsidy' ? 'blocks' : m.money_verdict === 'worth_pricing_site' ? 'clear' : 'open', words, evidence: m.quote ? 'red' : 'estimate' });
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
    const gap = m.gap ? `${usd(m.gap.lo, 100)}–${usd(m.gap.hi, 100)}` : '';
    const left = A!.left[0] < 0 ? 'nothing' : A!.left[0] === A!.left[1] ? usd(A!.left[0], 100) : `at most ${usd(A!.left[0], 100)}`;
    detail = m.quote
      ? `At your builder's quote (${usd(A!.psf[0], 1)}/sq ft, yours, not checked), building one home costs ${usd(A!.vertical[0], 100)} and leaves ${left} of the ${usd(m.new_build!.value)} sale; with soft costs, financing and ${usd(m.site_work.lo)}–${usd(m.site_work.hi)} site work, a home needs ${gap} of subsidy before land.`
      : `At a practitioner's estimate (${usd(A!.psf[0], 1)}–${usd(A!.psf[1], 1)}/sq ft), building one home costs ${usd(A!.vertical[0], 100)}–${usd(A!.vertical[1], 100)} and leaves ${left} of the ${usd(m.new_build!.value)} sale; with soft costs, financing and ${usd(m.site_work.lo)}–${usd(m.site_work.hi)} site work, a home needs ${gap} of subsidy before land.`;
  } else if (dimFail || useNo) {
    headline = 'doesnt_fit';
    const useLine = useNo ? `${useInk ? 'The use table says' : 'An unreviewed reading of the use table says'} this building type isn't permitted here; a use variance from the Zoning Board of Adjustment is a possible route, not approval.` : '';
    detail = dimFail ? `${r.relief.map((x) => x.text).join('; ')}. ${varianceWords(sideRelief, vctx, r.district)}${useLine ? ` ${useLine}` : ''}` : useLine;
  } else if (m && m.money_verdict === 'depends_on_builder') {
    headline = 'depends_on_builder';
    detail = `At ${m.quote ? 'your builder’s quote' : "the practitioner's estimate"}, full cost (building, soft costs, financing, site work) runs from within the sale to ${usd(m.gap?.hi ?? 0, 100)} a home over it, before land: a builder's price decides it.`;
  } else if (m && m.money_verdict === 'worth_pricing_site') {
    headline = 'worth_pricing_site';
    detail = `At ${m.quote ? `your builder's quote (${usd(A!.psf[0], 1)}/sq ft, yours, not checked)` : "the practitioner's estimate"}, the sale covers building, soft costs, financing and site work (${usd(m.site_work.lo)}–${usd(m.site_work.hi)}, not a cap), before land. Price the site next.`;
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
      signals: [y1927 ? `Historic zoning: the 1927 zoning map put this block in ${y1927}${/commercial|industr/i.test(y1927) ? ', a commercial district' : ''} (a zoning map, not a record of past land use).` : 'Historic zoning: not in our data.', 'We hold no contamination records for the lot.'],
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
