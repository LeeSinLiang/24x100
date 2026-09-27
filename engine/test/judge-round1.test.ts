// Fixes for judge round 1 (docs/judge-panel.md): use permission drives suggestions, only contiguous lots
// combine, one row per option, a lot consolidation for combined lots, and refusals that say why.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRuleSet, DEFAULT_SETTINGS, evaluate, proposalFor, unlockSearch, verdictFor, type BlockFile, type EvalContext, type TemplateId } from '../src';
import { nextStep } from '../src/sentence';
import { block10K, ctxFor, scen } from './load';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const b = block10K();
const ctx = ctxFor(b);

// Larimer (block 0124P, R1D‑H) runs on the model's extracted rules (pencil until a person signs them).
const bL: BlockFile = J('data/blocks/0124P.json');
const ext = J('data/rules/extracted/r1d-h.json');
const ctxL: EvalContext = { block: bL, rs: buildRuleSet('R1D-H', [...ext.rules, ...J('data/rules/base/pgh.json')], J('data/rules/questions.json'), []), settings: DEFAULT_SETTINGS };
const pinL = (lot: string) => bL.parcels.find((p) => `${p.lot}${p.lot_suffix ?? ''}` === lot)!.pin;
const scL = (t: TemplateId, lots: string[]) => ({ type: t, pins: lots.map(pinL), proposal: proposalFor(t) });

describe('use permission drives suggestions (Larimer, R1D‑H)', () => {
  it('a three-unit house on lots 203–204: the Rules chip says the use isn’t permitted, never "fits"', () => {
    const r = evaluate(ctxL, scL('three', ['203', '204']));
    expect(r.approvals.pencil.map((a) => a.kind)).toContain('use_variance');
    const v = verdictFor(r, null, 'n/a', bL);
    const rules = v.chips.find((c) => c.id === 'rules')!;
    expect(rules.state).toBe('blocks');
    expect(rules.evidence).toBe('pencil');
    expect(rules.words).toMatch(/isn't permitted \(an unreviewed reading\)/);
    expect(rules.words).not.toMatch(/fits/);
    expect(v.headline).toBe('doesnt_fit');
  });

  it('options that need a use variance rank last, say so, and are never the recommendation', () => {
    const u = unlockSearch(ctxL, scL('two', ['203']));
    const needs = u.options.filter((o) => o.needs_use);
    expect(needs.length).toBeGreaterThan(0);
    for (const o of needs) expect(o.label).toMatch(/use variance/);
    const firstNeeds = u.options.findIndex((o) => o.needs_use);
    expect(u.options.slice(firstNeeds).every((o) => o.needs_use)).toBe(true);
    expect(u.recommended?.needs_use ?? false).toBe(false);
    expect(nextStep(u, bL).text).not.toMatch(/Three-unit/);
    // Lot 208 is built and fronts Winslow St: not a partner on this frontage.
    expect(u.options.some((o) => o.scenario.pins.includes(pinL('208')))).toBe(false);
  });
});

describe('only contiguous lots combine', () => {
  it('lots 25 and 30 don’t touch: refused, and the verdict says why', () => {
    const r = evaluate(ctx, scen(b, 'three', [25, 30]));
    expect(r.state).toBe('refused');
    expect(r.refusal?.code).toBe('not_adjacent');
    expect(r.refusal?.reason).toMatch(/Lot 30 doesn't touch lot 25/);
    const v = verdictFor(r, null, 'n/a', b);
    expect(v.headline).toBe('cant_tell');
    expect(v.detail).toMatch(/don't share a lot line/);
    expect(v.detail).not.toMatch(/records/);
  });

  it('lots 25, 26 and 27 do touch: evaluated as one', () => {
    expect(evaluate(ctx, scen(b, 'three', [25, 26, 27])).state).toBe('ok');
  });

  it('a lot that isn’t on the block is named, not silently dropped', () => {
    const r = evaluate(ctx, { ...scen(b, 'three', [25, 26]), unknown_lots: ['99'] });
    expect(r.state).toBe('refused');
    expect(r.refusal?.reason).toMatch(/Lot 99 isn't on Block 10K/);
  });
});

describe('ways forward', () => {
  for (const lot of [25, 27]) {
    it(`lot ${lot}: one row per building type, lot set and hypothesis`, () => {
      const u = unlockSearch(ctx, scen(b, 'two', [lot]));
      const labels = u.options.map((o) => o.label);
      expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
    });
  }

  it('partners front the same street: lot 28A (behind 28, on Humber Way) never pairs with lot 27; lot 28 does', () => {
    const u = unlockSearch(ctx, scen(b, 'two', [27]));
    const has = (lot: number, suffix: string | null) => u.options.some((o) => o.scenario.pins.some((pin) => { const p = b.parcels.find((x) => x.pin === pin)!; return p.lot === lot && (p.lot_suffix ?? null) === suffix; }));
    expect(b.parcels.some((p) => p.lot === 28 && p.lot_suffix === 'A')).toBe(true);
    expect(has(28, 'A')).toBe(false);
    expect(has(28, null)).toBe(true);
  });
});

describe('lot consolidation', () => {
  it('combined lots list a lot consolidation (pencil); rowhouses, each on its own lot, don’t', () => {
    const three = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
    expect(three.approvals.pencil.map((a) => a.kind)).toContain('lot_consolidation');
    const row = evaluate(ctx, scen(b, 'row', [25, 26, 27]));
    expect([...row.approvals.ink, ...row.approvals.pencil].map((a) => a.kind)).not.toContain('lot_consolidation');
    const one = evaluate(ctx, scen(b, 'two', [25]));
    expect([...one.approvals.ink, ...one.approvals.pencil].map((a) => a.kind)).not.toContain('lot_consolidation');
  });
});

describe('refusal wording', () => {
  it('the default tolerance says it is the default and how to change it', () => {
    const r = evaluate(ctx, scen(b, 'two', [22]));
    expect(r.refusal?.reason).toMatch(/the default; change it with &tol= in the link/);
    expect(r.refusal?.reason).not.toMatch(/your setting/);
  });
});
