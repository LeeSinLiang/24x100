// The money screen (spec §0.12 C3, overriding §0.7). A developer checks whether a project pencils before
// pursuing a variance, so money is checked first. This is a screening estimate:
//   - vertical construction cost per home = a practitioner's $/sf range × the home's size (red);
//   - three labelled value signals, none of them an appraisal;
//   - the gap is a LOWER BOUND: vertical cost (low end) minus the highest value signal. Site work, land,
//     soft costs and financing are not in that number.
// Soft costs and financing are the user's assumptions and appear only in a secondary line.
import { MINUS, int, usd } from './format';
import type { Assumption, Comps, Hud, LotResult, MoneyResult, ValueSignal } from './types';

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

export const NOT_IN_NUMBER = ['site work', 'land', 'soft costs', 'financing'];

export function moneyFor(result: LotResult, m: MoneyInputs): MoneyResult {
  const a = assumptionMap(m.assumptions);
  const homes = result.scenario.type === 'row' ? Math.max(1, result.units.length) : result.scenario.proposal.units;
  const sqft = result.scenario.proposal.home_sqft;
  const hc = a.hard_cost_psf;
  const [pLo, pHi] = range(a, 'hard_cost_psf');
  const vLo = pLo * sqft;
  const vHi = pHi * sqft;
  const household = val(a, 'household_size');
  const income = m.hud.l80[household - 1];
  const aff = affordablePrice(income, a);
  const newest = m.comps.newest[0] ?? null;

  const signals: ValueSignal[] = [
    {
      id: 'median',
      value: m.comps.median,
      label: `Ward ${m.comps.meta.ward ?? ''} median of ${m.comps.counts.valid_1_2_unit} valid 1–2 unit sales since 2023`.replace('Ward  ', 'Ward '),
      note: 'mostly older homes; not an appraisal, and not what a new build would appraise at',
      evidence: 'ink',
    },
    ...(newest
      ? [
          {
            id: 'newest' as const,
            value: newest.price,
            label: `Newest new build: ${newest.addr} (${newest.yearbuilt}, ${int(newest.sqft ?? 0)} sf)`,
            note: 'one sale; may be price-restricted; unverified',
            evidence: 'ink' as const,
          },
        ]
      : []),
    {
      id: 'affordable',
      value: Math.round(aff.price),
      label: `What an 80% AMI household of ${household} could afford`,
      note: 'HUD income limit with your mortgage assumptions; not a market value',
      evidence: 'red',
    },
  ];
  const top = signals.reduce((x, y) => (y.value > x.value ? y : x));
  const gapLb = vLo - top.value;
  const soft = val(a, 'soft_cost_pct');
  const fin = val(a, 'financing_pct');
  const wLo = vLo * (1 + soft + fin);
  const wHi = vHi * (1 + soft + fin);
  const be = top.value / sqft;
  return {
    homes,
    sqft,
    vertical: {
      lo: vLo,
      hi: vHi,
      psf: [pLo, pHi],
      formula: `${usd(pLo, 1)}–${usd(pHi, 1)}/sf × ${int(sqft)} sf = ${usd(vLo, 1)}–${usd(vHi, 1)} per home, vertical construction only`,
      supplied_by: hc?.supplied_by ?? '',
      evidence: hc?.role === 'practitioner_estimate' ? 'estimate' : 'red',
    },
    signals,
    gap: {
      lower_bound: gapLb,
      signal: top.id,
      formula: `${usd(vLo, 1)} ${MINUS} ${usd(top.value, 1)} = ${usd(gapLb, 1)} per home, at least`,
      positive: gapLb > 0,
    },
    break_even_psf: { value: be, signal: top.id, formula: `${usd(top.value, 1)} ÷ ${int(sqft)} sf = ${usd(be, 1)}/sf` },
    with_assumptions: {
      lo: wLo,
      hi: wHi,
      soft,
      financing: fin,
      formula: `${usd(vLo, 1)}–${usd(vHi, 1)} × (1 + ${Math.round(soft * 100)}% soft + ${Math.round(fin * 100)}% financing) = ${usd(wLo, 1)}–${usd(wHi, 1)} per home, still without site work or land`,
    },
    comps: { median: m.comps.median, q1: m.comps.q1, q3: m.comps.q3, count: m.comps.counts.valid_1_2_unit, thin: m.comps.counts.valid_1_2_unit < val(a, 'thin_market_threshold'), ward: m.comps.meta.ward ?? null },
    affordable: { price: aff.price, income, household, formula: aff.formula },
    not_in_number: NOT_IN_NUMBER,
    record_ids: ['record:comps', 'record:hud:fy2026'],
  };
}
