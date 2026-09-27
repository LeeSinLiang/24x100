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

describe('money screen (spec §0.13): what a new-build sale leaves after vertical construction', () => {
  const three = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
  const m = moneyFor(three, { comps, hud, assumptions });
  const est = (id: string) => m.estimates.find((e) => e.id === id)!;

  it('hand-calculated: three-unit, 1,350 sf per home, against 2125 Rose St at $240,000', () => {
    expect(m.sqft).toBe(1350);
    expect(m.new_build!.value).toBe(240000);
    expect(est('A').vertical).toEqual([200 * 1350, 250 * 1350]); // 270,000–337,500
    expect(est('A').left).toEqual([240000 - 270000, 240000 - 337500]); // −30,000 to −97,500
    expect(m.estimates.find((e) => e.id === 'B')).toBeUndefined(); // superseded (team decision, spec §0.13)
    expect(est('prod').vertical).toEqual([202500, 202500]);
    expect(est('prod').left).toEqual([37500, 37500]);
    expect(m.swing).toBe(337500 - 270000); // the $200–$250 range alone moves what's left by $67,500
    // Secondary: the subsidy a home would need before land (judge round 2), with our 20% soft + 6% financing (red).
    // 270,000 × 1.26 + 25,000 − 240,000 = 125,200; 337,500 × 1.26 + 50,000 − 240,000 = 235,250.
    expect(m.gap).toMatchObject({ lo: 125200, hi: 235250 });
    expect(m.gap!.formula).toMatch(/before land$/);
    expect(m.money_verdict).toBe('only_with_subsidy'); // even A's low end leaves less than $25,000
  });

  it('one estimate plus the speculative production-builder case, never averaged', () => {
    expect(m.estimates.map((e) => e.id)).toEqual(['A', 'prod']);
    expect(m.estimates.filter((e) => e.default).map((e) => e.id)).toEqual(['A']);
    expect(est('prod').speculative).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/\baverag|\bmean\b/i);
  });

  it('the 80% AMI price is a ceiling in context, never the value for what is left; the median is context only', () => {
    const aff = m.context.find((c) => c.id === 'affordable')!;
    expect(aff.note).toMatch(/ceiling/);
    expect(aff.note).toMatch(/not a value used/);
    expect(m.context.find((c) => c.id === 'median')!.note).toMatch(/context only/);
    expect(m.context.find((c) => c.id === 'median')!.note).toMatch(/not an appraisal/);
    for (const e of m.estimates) expect(e.left[0]).toBe(m.new_build!.value - e.vertical[0]);
  });

  it('site work carries "not a cap"; nothing shows "$0"; the 80% AMI price is hand-checked', () => {
    expect(m.site_work).toMatchObject({ lo: 25000, hi: 50000 });
    expect(m.site_work.note).toMatch(/Not a cap/);
    expect(JSON.stringify(m)).not.toMatch(/\$0\b/);
    const r = 0.065 / 12;
    const loan = (1637.5 * (1 - Math.pow(1 + r, -360))) / r;
    expect(Math.round(m.affordable.price)).toBe(Math.round(loan / 0.965));
  });

  it('the money verdict moves with the new-build price: depends on the builder, then worth pricing the site', () => {
    const at = (price: number) => moneyFor(three, { comps: { ...comps, newest: [{ ...comps.newest[0], price }] }, hud, assumptions }).money_verdict;
    expect(at(240000)).toBe('only_with_subsidy');
    expect(at(300000)).toBe('depends_on_builder'); // A leaves 30,000 at best, −37,500 at worst
    expect(at(400000)).toBe('worth_pricing_site'); // A leaves 62,500–130,000
  });

  it('no recent new build means no money verdict', () => {
    const old = moneyFor(three, { comps: { ...comps, newest: [{ ...comps.newest[0], yearbuilt: 1973 }] }, hud, assumptions });
    expect(old.new_build).toBeNull();
    expect(old.money_verdict).toBe('no_new_build');
  });
});

describe("the user's builder's quote: red, decides the verdict, never replaces the estimates", () => {
  const three = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
  const inp = { comps, hud, assumptions };
  const today = moneyFor(three, inp);

  it('no quote: exactly today (the same object, field for field), and the estimate verdict is the verdict', () => {
    expect(moneyFor(three, inp, null)).toEqual(today);
    expect(today.quote).toBeNull();
    expect(today.money_verdict_estimate).toBe(today.money_verdict);
  });

  it('$150/sf on lots 25–27: 240,000 − 1,350 × 150 = $37,500 left, which covers $25,000 site work: worth pricing the site', () => {
    const m = moneyFor(three, inp, 150);
    expect(m.quote).toMatchObject({ id: 'quote', psf: [150, 150], vertical: [202500, 202500], left: [37500, 37500], supplied_by: 'you (not checked)' });
    expect(m.money_verdict).toBe('worth_pricing_site');
    expect(m.money_verdict_estimate).toBe('only_with_subsidy'); // the practitioner's estimate still says so
    expect(m.estimates).toEqual(today.estimates); // never replaced
    // The gap from the quote: 202,500 × 1.26 + 25,000 − 240,000 = 40,150; + 50,000 = 65,150.
    expect(m.gap).toMatchObject({ lo: 40150, hi: 65150 });
    const v = verdictFor(three, m, null, b);
    expect(v.headline).toBe('worth_pricing_site');
    expect(v.chips.find((c) => c.id === 'money')).toMatchObject({ state: 'clear', evidence: 'red' });
    expect(v.detail).toMatch(/your builder's quote \(\$150\/sq ft, yours, not checked\)/);
  });

  it('$140/sf: $51,000 left; $200/sf: 240,000 − 270,000, nothing left, only with subsidy', () => {
    expect(moneyFor(three, inp, 140).quote!.left).toEqual([51000, 51000]);
    const m = moneyFor(three, inp, 200);
    expect(m.quote!.left).toEqual([-30000, -30000]);
    expect(m.money_verdict).toBe('only_with_subsidy');
    expect(verdictFor(three, m, null, b).chips.find((c) => c.id === 'money')!.words).toMatch(/^nothing left: .*\(your builder’s quote, not checked\)$/);
  });

  it('a quote outside $20–$2,000/sf is a typo, not a quote: ignored', () => {
    for (const q of [0, 5, 5000, Number.NaN, -150]) expect(moneyFor(three, inp, q)).toEqual(today);
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
    // Amounts in the words are the engine's, not rounded away: $200–$250/sq ft, $216,000–$270,000, $24,000 left.
    expect(v.detail).toContain('$200–$250/sq ft');
    expect(v.detail).toContain('$216,000–$270,000');
    expect(v.detail).toContain('at most $24,000');
    expect(v.detail).not.toMatch(/\$0\b/);
  });

  it('records disagree → "Can\'t tell yet"', () => {
    const r = evaluate(ctx, scen(b, 'two', [22]));
    expect(verdictFor(r, null, null, b).headline).toBe('cant_tell');
  });

  it('without money data, a lot that fails the rules "Doesn\'t fit as of right" with the variance wording', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const v = verdictFor(r, null, 'not loaded', b);
    expect(v.headline).toBe('doesnt_fit');
    expect(v.detail).toMatch(/Needs a variance from the Zoning Board/);
    expect(v.detail).toMatch(/not guaranteed/);
    expect(v.detail).not.toMatch(/hardship/);
  });

  it('without money data, a lot that fits is "Worth a closer look, if …" with its conditions', () => {
    const r = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
    const v = verdictFor(r, null, 'not loaded', b);
    expect(v.headline).toBe('worth_a_look');
    expect(v.conditions.join(' ')).toMatch(/lot 26 can be bought/);
    expect(v.conditions.join(' ')).toMatch(/site investigations/);
  });

  it('site: the deal-killers first, then fill, soil and utilities; never "clean"; no dollar amounts', () => {
    const rows = siteUnknowns(evaluate(ctx, scen(b, 'three', [25, 26, 27])), b);
    expect(rows.map((r) => r.id)).toEqual(['undermining', 'environmental', 'fill', 'soil', 'water']);
    expect(rows.filter((r) => r.deal_killer).map((r) => r.id)).toEqual(['undermining', 'environmental']);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\bclean\b|no risk/i);
    expect(rows[0].signals.join(' ')).toMatch(/A blank map is not proof/);
    expect(rows[1].signals.join(' ')).toMatch(/Commercial U3/);
    expect(rows[2].signals.join(' ')).toMatch(/not checked for this lot/);
    expect(rows[3].signals.join(' ')).toMatch(/lot 25: 53%, lot 26: 56%, lot 27: 42%/);
    expect(rows[4].signals.join(' ')).toMatch(/How deep and where the lines are/);
  });
});
