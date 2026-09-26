// The money wall: a reverse pro forma (spec §0.7). It does not claim a construction cost. It solves
// for the hard cost per square foot at which a home would break even at today's sale prices, and
// shows the user's red cost assumptions beside that. Framed as hypothesis H5, never as a finding.
import { MINUS, int, usd } from './format';
import type { Assumption, Comps, Hud, LotResult, MoneyResult } from './types';

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

export function moneyFor(result: LotResult, lotsInScenario: number, slopeFlag: boolean, m: MoneyInputs): MoneyResult {
  const a = assumptionMap(m.assumptions);
  const homes = result.scenario.type === 'row' ? Math.max(1, result.units.length) : result.scenario.proposal.units;
  const sqft = result.scenario.proposal.home_sqft;
  const soft = val(a, 'soft_cost_pct');
  const fin = val(a, 'financing_pct');
  const lotPrice = val(a, 'lot_price_per_lot');
  const lotPerHome = (lotPrice * lotsInScenario) / homes;
  const site = slopeFlag ? val(a, 'slope_sitework_per_home') : 0;
  const [hLo, hHi] = range(a, 'hard_cost_psf');
  const mult = 1 + soft + fin;
  const V = m.comps.median;

  const beRaw = (V - lotPerHome - site) / (mult * sqft);
  const beFormula = `(${usd(V, 1)} ${MINUS} ${usd(lotPerHome, 1)} lot ${MINUS} ${usd(site, 1)} sitework) ÷ (${mult.toFixed(2)} × ${int(sqft)} sf) = ${usd(beRaw, 1)}/sf`;
  const costLo = hLo * sqft * mult + lotPerHome + site;
  const costHi = hHi * sqft * mult + lotPerHome + site;
  const costFormula = `${usd(hLo, 1)}–${usd(hHi, 1)}/sf × ${int(sqft)} sf × ${mult.toFixed(2)} + ${usd(lotPerHome, 1)} lot + ${usd(site, 1)} sitework = ${usd(costLo, 1)}–${usd(costHi, 1)}`;
  const gapLo = costLo - V;
  const gapHi = costHi - V;
  const household = val(a, 'household_size');
  const income = m.hud.l80[household - 1];
  const aff = affordablePrice(income, a);
  const thin = m.comps.counts.valid_1_2_unit < val(a, 'thin_market_threshold');
  const used = ['hard_cost_psf', 'soft_cost_pct', 'financing_pct', 'lot_price_per_lot', ...(slopeFlag ? ['slope_sitework_per_home'] : []), 'household_size', 'housing_cost_share', 'mortgage_rate', 'term_years', 'taxes_insurance_monthly', 'down_payment_pct', 'thin_market_threshold'];
  return {
    homes,
    sqft,
    value: { median: V, q1: m.comps.q1, q3: m.comps.q3, newest: m.comps.newest[0]?.price ?? null, count: m.comps.counts.valid_1_2_unit, thin },
    cost: { lo: costLo, hi: costHi, formula: costFormula, hard_psf: [hLo, hHi] },
    break_even_psf: { value: Math.max(0, beRaw), formula: beFormula, none: beRaw <= 0 },
    gap: { lo: gapLo, hi: gapHi, formula: `${usd(costLo, 1)}–${usd(costHi, 1)} ${MINUS} ${usd(V, 1)} = ${usd(gapLo, 1)}–${usd(gapHi, 1)} per home` },
    affordable: { price: aff.price, income, household, formula: aff.formula },
    affordability_gap: V - aff.price,
    trust: 'red',
    assumptions_used: used,
    record_ids: ['record:comps:ward5', 'record:hud:fy2026'],
  };
}
