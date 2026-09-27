// The money screen, checked first (spec §0.12 as refined by §0.13). A developer compares vertical
// construction cost with what a new home sells for; what is left says how much site work, soft costs and
// land the deal can carry, and whether to spend on checking those or move on.
//   - One practitioner's estimate for city single-family infill ($200–$250/sf; the team's decision, spec §0.13:
//     a higher estimate was superseded when its author deferred to this practitioner for local cost), and the
//     same practitioner's speculative production-builder case, shown beside it and never averaged;
//   - "left for site work, soft costs and land" = the newest new-build sale − vertical cost, per home;
//   - the ward median is context only; what an 80% AMI buyer could pay is a ceiling, never a value here;
//   - a typical single-unit site-work range, which is not a cap.
import { MINUS, int, usd } from './format';
import type { Assumption, Comps, CostEstimate, Hud, LotResult, MoneyResult, ValueSignal } from './types';

export interface MoneyInputs {
  comps: Comps;
  hud: Hud;
  assumptions: Assumption[];
}

export function assumptionMap(list: Assumption[]): Record<string, Assumption> {
  return Object.fromEntries(list.map((a) => [a.key, a]));
}

function val(a: Record<string, Assumption>, key: string): number {
  const v = a[key]?.value;
  if (v == null) throw new Error(`missing assumption ${key}`);
  return Array.isArray(v) ? v[0] : v;
}
function range(a: Record<string, Assumption>, key: string): [number, number] {
  const v = a[key]?.value;
  if (v == null) throw new Error(`missing assumption ${key}`);
  return Array.isArray(v) ? v : [v, v];
}

/** Monthly payment → loan principal (standard amortization). */
export function principalFromPayment(payment: number, annualRate: number, years: number): number {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return payment * n;
  return (payment * (1 - Math.pow(1 + r, -n))) / r;
}

export function affordablePrice(income: number, a: Record<string, Assumption>): { price: number; formula: string } {
  const share = val(a, 'housing_cost_share');
  const ti = val(a, 'taxes_insurance_monthly');
  const rate = val(a, 'mortgage_rate');
  const years = val(a, 'term_years');
  const down = val(a, 'down_payment_pct');
  const monthly = (income * share) / 12;
  const pi = Math.max(0, monthly - ti);
  const loan = principalFromPayment(pi, rate, years);
  const price = loan / (1 - down);
  const formula = `${usd(income, 1)} × ${Math.round(share * 100)}% ÷ 12 = ${usd(monthly, 1)}/mo; ${MINUS} ${usd(ti, 1)} taxes and insurance = ${usd(pi, 1)} for the loan at ${(rate * 100).toFixed(2)}% over ${years} years = ${usd(loan, 1)} loan; with ${(down * 100).toFixed(1)}% down = ${usd(price, 1)}`;
  return { price, formula };
}

export const SOURCE_LEADS = ['County and City building-permit valuations', 'NAHB construction-cost surveys', 'RSMeans'];
/** A sale counts as a new build for "left after building" when built this recently. */
export const NEW_BUILD_SINCE = 2015;

/** "Nothing left: building alone costs more than the best new-build sale", or "$X to $Y". */
export function leftWords(left: [number, number]): string {
  if (left[0] < 0) return 'nothing left: building alone costs more than the best new-build sale';
  if (left[1] < 0) return `${usd(left[0], 100)} at best, nothing at the high end`;
  return `${usd(left[1], 100)}–${usd(left[0], 100)}`;
}

/** A builder's quote the app accepts, in $ per sq ft: anything outside is a typo, not a quote. */
export const QUOTE_RANGE: [number, number] = [20, 2000];
export const validQuote = (q: number | null | undefined): q is number => typeof q === 'number' && Number.isFinite(q) && q >= QUOTE_RANGE[0] && q <= QUOTE_RANGE[1];

/** The money screen for a scenario. `quote` ($/sq ft) is the user's own builder's quote: when given, it decides the
 *  verdict, the gap and "left after building" (red, theirs); the practitioner estimates are computed as always. */
export function moneyFor(result: LotResult, m: MoneyInputs, quote: number | null = null): MoneyResult {
  const a = assumptionMap(m.assumptions);
  const homes = result.scenario.type === 'row' ? Math.max(1, result.units.length) : result.scenario.proposal.units;
  const sqft = result.scenario.proposal.home_sqft;
  const household = val(a, 'household_size');
  const income = m.hud.l80[household - 1];
  const aff = affordablePrice(income, a);
  const nb = m.comps.newest.find((x) => x.yearbuilt >= NEW_BUILD_SINCE) ?? null;
  const newBuild: ValueSignal | null = nb
    ? { id: 'newest', value: nb.price, label: `Newest new build: ${nb.addr} (${nb.yearbuilt}, ${int(nb.sqft ?? 0)} sf)`, note: 'one sale; may be price-restricted; unverified', evidence: 'ink' }
    : null;
  const V = newBuild?.value ?? 0;

  const est = (id: CostEstimate['id'], key: string, dflt: boolean, spec: boolean): CostEstimate => {
    const e = a[key];
    const psf = range(a, key);
    const vertical: [number, number] = [psf[0] * sqft, psf[1] * sqft];
    const left: [number, number] = [V - vertical[0], V - vertical[1]];
    const psfWords = psf[0] === psf[1] ? `${usd(psf[0], 1)}/sf` : `${usd(psf[0], 1)}–${usd(psf[1], 1)}/sf`;
    const vWords = vertical[0] === vertical[1] ? usd(vertical[0], 1) : `${usd(vertical[0], 1)}–${usd(vertical[1], 1)}`;
    const lWords = left[0] === left[1] ? usd(left[0], 1) : `${usd(left[0], 1)} to ${usd(left[1], 1)}`;
    return {
      id,
      label: e?.label ?? id,
      psf,
      vertical,
      left,
      note: e?.note ?? '',
      supplied_by: e?.supplied_by ?? '',
      default: dflt,
      speculative: spec,
      formula: `${psfWords} × ${int(sqft)} sf = ${vWords} per home; ${usd(V, 1)} ${MINUS} that = ${lWords} left`,
    };
  };
  const estimates = [est('A', 'cost_estimate_A', true, false), ...(a.cost_estimate_B ? [est('B', 'cost_estimate_B', false, false)] : []), est('prod', 'cost_estimate_prod', false, true)];
  const A = estimates[0];
  const [swLo, swHi] = range(a, 'site_work_single_unit');
  // C11 verdict on an estimate: even its low end must leave the low site-work figure.
  const verdictOf = (e: CostEstimate): MoneyResult['money_verdict'] => (!newBuild ? 'no_new_build' : e.left[0] < swLo ? 'only_with_subsidy' : e.left[1] >= swLo ? 'worth_pricing_site' : 'depends_on_builder');
  // The user's builder's quote: one figure, so it settles "depends on the builder" one way or the other.
  const q: CostEstimate | null = validQuote(quote)
    ? (() => {
        const v = quote * sqft;
        return {
          id: 'quote',
          label: 'Your builder’s quote',
          psf: [quote, quote],
          vertical: [v, v],
          left: [V - v, V - v],
          note: 'yours, not checked',
          supplied_by: 'you (not checked)',
          default: false,
          speculative: false,
          formula: `${usd(quote, 1)}/sf × ${int(sqft)} sf = ${usd(v, 1)} per home; ${usd(V, 1)} ${MINUS} that = ${usd(V - v, 1)} left`,
        } satisfies CostEstimate;
      })()
    : null;
  const D = q ?? A; // the estimate that decides
  const money_verdict = verdictOf(D);
  const soft = val(a, 'soft_cost_pct');
  const fin = val(a, 'financing_pct');
  const wLo = D.vertical[0] * (1 + soft + fin);
  const wHi = D.vertical[1] * (1 + soft + fin);
  const median: ValueSignal = {
    id: 'median',
    value: m.comps.median,
    label: `Ward ${m.comps.meta.ward ?? ''} median of ${m.comps.counts.valid_1_2_unit} valid 1–2 unit sales since 2023`,
    note: 'context only: mostly older homes; not an appraisal',
    evidence: 'ink',
  };
  const ceiling: ValueSignal = {
    id: 'affordable',
    value: Math.round(aff.price),
    label: `What an 80% AMI buyer (household of ${household}) could pay`,
    note: 'a ceiling for an affordable sale, not a value used for what’s left; uses your mortgage assumptions',
    evidence: 'red',
  };
  const gap = newBuild
    ? {
        lo: Math.max(0, Math.round(wLo + swLo - V)),
        hi: Math.max(0, Math.round(wHi + swHi - V)),
        formula: `${wLo === wHi ? usd(wLo, 100) : `${usd(wLo, 100)}–${usd(wHi, 100)}`} building with soft costs and financing${q ? ' (your builder’s quote)' : ''} + ${usd(swLo, 1)}–${usd(swHi, 1)} site work ${MINUS} ${usd(V, 1)} sale = ${usd(Math.max(0, wLo + swLo - V), 100)}–${usd(Math.max(0, wHi + swHi - V), 100)} per home, before land`,
      }
    : null;
  return {
    homes,
    sqft,
    estimates,
    gap,
    new_build: newBuild,
    context: [median, ceiling],
    site_work: { lo: swLo, hi: swHi, note: a.site_work_single_unit?.note ?? '', supplied_by: a.site_work_single_unit?.supplied_by ?? '' },
    money_verdict,
    quote: q,
    money_verdict_estimate: verdictOf(A),
    swing: A.vertical[1] - A.vertical[0], // how much the estimate's own range moves what's left, per home
    with_assumptions: {
      lo: wLo,
      hi: wHi,
      soft,
      financing: fin,
      formula: `${D.vertical[0] === D.vertical[1] ? usd(D.vertical[0], 1) : `${usd(D.vertical[0], 1)}–${usd(D.vertical[1], 1)}`} × (1 + ${Math.round(soft * 100)}% soft + ${Math.round(fin * 100)}% financing) = ${wLo === wHi ? usd(wLo, 1) : `${usd(wLo, 1)}–${usd(wHi, 1)}`} per home, still without site work or land${q ? ' (your builder’s quote)' : ''}`,
    },
    comps: { median: m.comps.median, q1: m.comps.q1, q3: m.comps.q3, count: m.comps.counts.valid_1_2_unit, thin: m.comps.counts.valid_1_2_unit < val(a, 'thin_market_threshold'), ward: m.comps.meta.ward ?? null },
    affordable: { price: aff.price, income, household, formula: aff.formula },
    source_leads: SOURCE_LEADS,
    record_ids: ['record:comps', 'record:hud:fy2026'],
  };
}
