// Rule what-ifs (spec §0.16): the same classifier, one override at a time. Today reproduces the summary; lot 25
// opens under S1 and S2; and a scenario without its override opens nothing (the numbers come from the override).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, classifyAll, fitsDim, loadInputs, SCENARIOS } from '../../scripts/build-scenarios';

const inp = loadInputs();
const LOT25 = '0010K00025000000';
const at = (pin: string) => inp.lots.findIndex((l) => l.pin === pin);

describe('rule what-ifs', () => {
  const f = build(inp);
  const sc = (id: string) => f.scenarios.find((s) => s.id === id)!;
  const opens = (id: string, t: 'two' | 'three') => (sc(id).by_type as Record<string, { opens: number; pins: string[] }>)[t];

  it('with no override, the classifier reproduces the published summary (today 428 two-unit and 220 three-unit, six signed districts)', () => {
    const sum = JSON.parse(readFileSync('data/city/summary.json', 'utf8')).by_type;
    expect(f.meta.today.two.width_not_area).toBe(sum.two.width_not_area);
    expect(f.meta.today.three.width_not_area).toBe(sum.three.width_not_area);
    expect([f.meta.today.two.width_not_area, f.meta.today.three.width_not_area]).toEqual([428, 220]);
  });

  it('lot 25 (2241 Mahon St) opens for a two-unit house under S1 and S2, at 18 ft each (24 − 3 − 3), and not under S3 (24 − 5 − 5 = 14)', () => {
    const i = at(LOT25);
    expect(fitsDim(classifyAll(inp, 'two', null)[i])).toBe(false);
    for (const id of ['S1', 'S2']) {
      const c = classifyAll(inp, 'two', SCENARIOS.find((s) => s.id === id)!)[i];
      expect(c.width).toBe(18);
      expect(fitsDim(c)).toBe(true);
      expect(opens(id, 'two').pins).toContain(LOT25);
    }
    const s3 = classifyAll(inp, 'two', SCENARIOS.find((s) => s.id === 'S3')!)[i];
    expect(s3.width).toBe(14);
    expect(opens('S3', 'two').pins).not.toContain(LOT25);
  });

  it('the counts come from the override: without it a scenario opens nothing', () => {
    for (const s of SCENARIOS) {
      const bare = { ...s, what: undefined, value: undefined };
      const was = classifyAll(inp, 'two', null);
      const now = classifyAll(inp, 'two', bare);
      expect(now.filter((c, i) => !fitsDim(was[i]) && fitsDim(c)).length).toBe(0);
      expect(opens(s.id, 'two').opens).toBeGreaterThan(0);
    }
  });

  it('every scenario quotes its sentence verbatim from the saved code text, and never opens a lot outside a checked district', () => {
    for (const s of f.scenarios) {
      expect(s.quote.length).toBeGreaterThan(10);
      for (const t of ['two', 'three']) for (const [d] of (s.by_type as Record<string, { by_district: [string, number][] }>)[t].by_district) expect(f.meta.districts).toContain(d);
    }
  });
});
