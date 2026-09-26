// Spec §0.12 C3: the money screen. Hand-calculated case, labels, and red/estimate never read as ink.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, moneyFor, siteUnknowns, verdictFor, type Assumption, type Comps, type Hud } from '../src';
import { block10K, ctxFor, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);
const raw = JSON.parse(readFileSync('data/money/comps_ward5.json', 'utf8'));
const comps: Comps = { ...raw, newest: raw.newest_built, meta: { ...raw.meta, ward: 5 } };
const h = JSON.parse(readFileSync('data/money/hud_fy2026.json', 'utf8'));
const hud: Hud = { area_name: h.hud_area_name, median: h.median_family_income, l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h[`l80_${i}`]), source_url: h.meta.url, pulled: h.meta.pulled };
const assumptions: Assumption[] = JSON.parse(readFileSync('data/assumptions.json', 'utf8'));

describe('money screen', () => {
  const three = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
  const m = moneyFor(three, { comps, hud, assumptions });

  it('hand-calculated: three-unit, 1,350 sf per home, $325–$375/sf', () => {
    expect(m.sqft).toBe(1350);
    expect(m.vertical.lo).toBe(325 * 1350); // 438,750
    expect(m.vertical.hi).toBe(375 * 1350); // 506,250
    // 80% AMI, 3 people: $79,500 × 30% ÷ 12 = $1,987.50; − $350 = $1,637.50 at 6.5% for 30 years; 3.5% down.
    const r = 0.065 / 12;
    const loan = (1637.5 * (1 - Math.pow(1 + r, -360))) / r;
    expect(m.affordable.price).toBeCloseTo(loan / 0.965, 6);
    expect(Math.round(m.affordable.price)).toBe(268467);
    // Highest signal is the affordable price; the gap is a lower bound against it.
    expect(m.gap.signal).toBe('affordable');
    expect(Math.round(m.gap.lower_bound)).toBe(438750 - 268467);
    expect(m.gap.positive).toBe(true);
  });

  it('labels: the median is not an appraisal; the gap is a lower bound; nothing shows "$0"', () => {
    expect(m.signals.find((s) => s.id === 'median')!.note).toMatch(/not an appraisal/);
    expect(m.signals.find((s) => s.id === 'newest')!.note).toMatch(/one sale; may be price-restricted/);
    expect(m.gap.formula).toMatch(/at least/);
    expect(m.not_in_number).toEqual(expect.arrayContaining(['site work', 'land', 'soft costs', 'financing']));
    const all = JSON.stringify(m);
    expect(all).not.toMatch(/\$0\b/);
    expect(all).not.toMatch(/sitework/i);
  });

  it('the cost range is a practitioner estimate, and value signals keep their own evidence', () => {
    expect(m.vertical.evidence).toBe('estimate');
    expect(m.vertical.supplied_by).toMatch(/practitioner at the hackathon/);
    expect(m.signals.find((s) => s.id === 'affordable')!.evidence).toBe('red');
    expect(m.signals.find((s) => s.id === 'median')!.evidence).toBe('ink');
  });

  it('soft costs and financing live only in the secondary line', () => {
    expect(m.with_assumptions.lo).toBeCloseTo(m.vertical.lo * 1.26, 6);
    expect(m.gap.lower_bound).toBe(m.vertical.lo - Math.max(...m.signals.map((s) => s.value)));
  });
});

describe('verdict (no score)', () => {
  const inputs = { comps, hud, assumptions };
  it('money is checked first: lot 25 two-unit reads "Only with subsidy" with Rules blocking as a chip', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const v = verdictFor(r, moneyFor(r, inputs), null, b);
    expect(v.headline).toBe('only_with_subsidy');
    expect(v.chips.map((c) => [c.id, c.state])).toEqual([
      ['money', 'blocks'],
      ['rules', 'blocks'],
      ['site', 'unknown'],
    ]);
    expect(JSON.stringify(v)).not.toMatch(/\/ ?100|score/i);
  });

  it('records disagree → "Can\'t tell yet"', () => {
    const r = evaluate(ctx, scen(b, 'two', [22]));
    expect(verdictFor(r, null, null, b).headline).toBe('cant_tell');
  });

  it('without money data, a lot that fails the rules "Doesn\'t fit as of right" with the variance wording', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const v = verdictFor(r, null, 'not loaded', b);
    expect(v.headline).toBe('doesnt_fit');
    expect(v.detail).toMatch(/plausible route/);
    expect(v.detail).toMatch(/not approval/);
  });

  it('without money data, a lot that fits is "Worth a closer look, if …" with its conditions', () => {
    const r = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
    const v = verdictFor(r, null, 'not loaded', b);
    expect(v.headline).toBe('worth_a_look');
    expect(v.conditions.join(' ')).toMatch(/lot 26 can be bought/);
    expect(v.conditions.join(' ')).toMatch(/site investigations/);
  });

  it('site is never "clean": every row says what resolves it, with no dollar amounts', () => {
    const rows = siteUnknowns(evaluate(ctx, scen(b, 'three', [25, 26, 27])), b);
    expect(rows.map((r) => r.id)).toEqual(['soil', 'environmental', 'water']);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\bclean\b|no risk/i);
    expect(rows[0].signals.join(' ')).toMatch(/lot 25: 53%, lot 26: 56%, lot 27: 42%/);
    expect(rows[0].signals.join(' ')).toMatch(/A blank map is not proof/);
    expect(rows[1].signals.join(' ')).toMatch(/Commercial U3/);
  });
});
