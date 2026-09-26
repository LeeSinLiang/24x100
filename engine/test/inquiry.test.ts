// The inquiry: facts from the engine only; every number traced; red never reads as ink.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInquiry, evaluate, moneyFor, numbersIn, type Assumption, type Comps, type Hud } from '../src';
import { block10K, ctxFor, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);
const raw = JSON.parse(readFileSync('data/money/comps_ward5.json', 'utf8'));
const comps: Comps = { ...raw, newest: raw.newest_built };
const h = JSON.parse(readFileSync('data/money/hud_fy2026.json', 'utf8'));
const hud: Hud = { area_name: h.hud_area_name, median: h.median_family_income, l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h[`l80_${i}`]), source_url: h.meta.url, pulled: h.meta.pulled };
const assumptions: Assumption[] = JSON.parse(readFileSync('data/assumptions.json', 'utf8'));

const cases = [
  ['two', [25]],
  ['detached', [25]],
  ['three', [25, 26, 27]],
  ['row', [25, 26, 27]],
  ['two', [22]],
  ['two', [28]],
] as const;

describe('inquiry', () => {
  for (const [t, lots] of cases) {
    it(`${t} on ${lots.join(',')}: every number traces to the engine output`, () => {
      const r = evaluate(ctx, scen(b, t, [...lots]));
      const m = r.state === 'ok' ? moneyFor(r, { comps, hud, assumptions }) : null;
      const inq = buildInquiry(r, b, ctx.rs, m, '2026-09-26');
      expect(inq.check.unknown).toEqual([]);
      expect(inq.check.ok).toBe(true);
      expect(inq.markdown).toContain('not legal, financial or zoning advice');
      expect(inq.markdown).toMatch(/not sent automatically/);
    });
  }

  it('blocks export when a number does not trace (mutation)', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const bad = { ...r, checks: r.checks.map((c) => (c.id === 'height' ? { ...c, text: `${c.text} Also 777 ft of something.` } : c)) };
    const inq = buildInquiry(bad, b, ctx.rs, null, '2026-09-26');
    expect(inq.check.ok).toBe(false);
    expect(inq.check.unknown.join()).toMatch(/777/);
  });

  it('pencil and red items never appear as plain facts', () => {
    const r = evaluate(ctx, scen(b, 'row', [25, 26, 27]));
    const inq = buildInquiry(r, b, ctx.rs, null, '2026-09-26');
    const facts = inq.sections.find((s) => s.id === 'facts')!;
    expect(facts.items.every((i) => i.trust === 'ink')).toBe(true);
    expect(facts.items.map((i) => i.text).join(' ')).not.toMatch(/21 ft/); // the open rowhouse reading stays out of the facts
    expect(inq.sections.find((s) => s.id === 'questions')!.items.map((i) => i.text).join(' ')).toMatch(/single-unit house/);
  });

  it('numbersIn ignores identifiers (addresses, sections, lots, dates)', () => {
    expect(numbersIn('2241 Mahon St (lot 25) §903.03.C on 2026-09-26: 4 ft')).toEqual([4]);
  });
});
