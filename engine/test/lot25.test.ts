// Spec §5.3 and §8 expectations on Block 10‑K, run on the regenerated block file.
import { describe, expect, it } from 'vitest';
import { evaluate, labelEdges, openRing, type AuditEntry, type EvalContext, type LotResult } from '../src';
import { block10K, ctxFor, pinOf, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);

const width = (r: LotResult) => r.width!.deed;

export function assertLot25TwoUnit(c: EvalContext): void {
  const r = evaluate(c, scen(b, 'two', [25]));
  expect(r.state).toBe('ok');
  expect(width(r)).toBe(4);
  expect(r.width!.formula).toBe('24 − 10 − 10 = 4');
}

function audit(e: Partial<AuditEntry>): AuditEntry {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    rule_id: null,
    question_id: null,
    at: '2026-09-26T20:00:00Z',
    reviewer: 'Test Person',
    role: 'Housing lead',
    action: 'source_checked',
    quote: '',
    decision: 'test',
    reason: 'test',
    choice: null,
    reference: null,
    ...e,
  };
}

describe('lot 25 · 2241 Mahon St (deed 24 × 100)', () => {
  it('two-unit alone: 24 − 10 − 10 = 4 ft as of right; a 16 ft proposal needs side setbacks 10 → 4 ft (variance)', () => {
    assertLot25TwoUnit(ctx);
    const r = evaluate(ctx, scen(b, 'two', [25]));
    expect(r.checks.find((c) => c.id === 'width')!.status).toBe('fail');
    expect(r.relief.map((x) => x.text)).toContain('side setbacks 10 → 4 ft on each side');
    expect(r.approvals.ink.map((a) => a.kind)).toContain('variance');
    expect(r.width!.trust).toBe('ink');
  });

  it('detached house: the narrow-lot table gives 24 − 3 − 3 = 18 ft, but §925.06.C.1 keeps it open (11 ft on our reading of "no")', () => {
    const r = evaluate(ctx, scen(b, 'detached', [25]));
    expect(width(r)).toBe(18);
    const w = r.checks.find((c) => c.id === 'width')!;
    // Both neighbours are vacant: 3 ft on both sides is allowed only if they're set back 3 ft or less.
    expect(w.status).toBe('open');
    expect(w.trust).toBe('pencil');
    expect(w.alternative).toMatchObject({ available: 11, question_id: 'q.narrow_both_sides_3ft', choice: 'no', formula: '24 − 3 − 10 = 11' });
    expect(r.questions.map((q) => q.id)).toContain('q.narrow_both_sides_3ft');
    expect(r.sides.filter((s) => s.kind === 'side_interior').map((s) => s.setback_trust)).toEqual(['pencil', 'pencil']);
    expect(w.text).not.toMatch(/district setback stands/);
  });

  it('§925.06.C.1: a City "yes" inks 18 ft; an assumed "no" puts the district setback on one side (red, 11 ft)', () => {
    const at = (status: 'city_confirmed' | 'assumed', choice: 'yes' | 'no') =>
      evaluate(
        ctxFor(b, {
          audit: [
            {
              id: 't1',
              rule_id: null,
              question_id: 'q.narrow_both_sides_3ft',
              at: '2026-09-26T00:00:00Z',
              reviewer: 'Test fixture',
              role: 'test',
              action: status,
              quote: '',
              decision: '',
              reason: 'test fixture',
              choice,
              reference: status === 'city_confirmed' ? { who: 'ZA', text: 'Letter: test fixture', date: '2026-09-26' } : null,
            },
          ],
        }),
        scen(b, 'detached', [25]),
      );
    const yes = at('city_confirmed', 'yes');
    expect(width(yes)).toBe(18);
    expect(yes.checks.find((c) => c.id === 'width')!.status).toBe('pass');
    expect(yes.questions.map((q) => q.id)).not.toContain('q.narrow_both_sides_3ft');
    const no = at('assumed', 'no');
    expect(width(no)).toBe(11);
    expect(no.width!.trust).toBe('red');
  });

  it('rowhouse end units are not touched by §925.06.C.1 (a party wall on one side)', () => {
    const r = evaluate(ctx, scen(b, 'row', [25, 26, 27]));
    expect(r.questions.map((q) => q.id)).not.toContain('q.narrow_both_sides_3ft');
  });

  it('three-unit on lots 25–27: 72 − 10 − 10 = 52 ft, passes; lot 26 is not City-owned', () => {
    const r = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
    expect(width(r)).toBe(52);
    expect(r.width!.formula).toBe('72 − 10 − 10 = 52');
    expect(r.checks.find((c) => c.id === 'width')!.status).toBe('pass');
    expect(r.approvals.ink.map((a) => a.kind)).toEqual(expect.arrayContaining(['other_owner', 'city_public_sale']));
    const own = r.checks.find((c) => c.id === 'ownership')!.text;
    expect(own).toMatch(/Lot 26: not in the City's inventory; County owner type Corporation/);
    expect(own).toMatch(/Lot 25: City-owned, Available for Sale/);
    expect(own).toMatch(/Lot 27: City-owned, Available for Sale/);
  });

  it('rowhouses on 25–27: end units 14 ft while the question is open (pencil), the range stays open', () => {
    const r = evaluate(ctx, scen(b, 'row', [25, 26, 27]));
    const ends = r.units.filter((u) => u.end).map((u) => u.width.deed);
    expect(ends).toEqual([14, 14]);
    expect(r.units.find((u) => !u.end)!.width.deed).toBe(24);
    const w = r.checks.find((c) => c.id === 'width')!;
    expect(w.status).toBe('open');
    expect(w.trust).toBe('pencil');
    expect(w.text).toMatch(/or 21 ft/);
    expect(r.approvals.pencil.map((a) => a.kind)).toContain('variance');
    expect(r.approvals.ink.map((a) => a.kind)).not.toContain('variance');
  });

  it('rowhouses: an ASSUMED yes gives 21 ft in red, and the score keeps its range', () => {
    const c = ctxFor(b, { audit: [audit({ question_id: 'q.single_unit_includes_attached', action: 'assumed', choice: 'yes' })] });
    const r = evaluate(c, scen(b, 'row', [25, 26, 27]));
    expect(r.units.filter((u) => u.end).map((u) => u.width.deed)).toEqual([21, 21]);
    expect(r.units.filter((u) => u.end).every((u) => u.trust === 'red')).toBe(true);
    expect(r.trust).toBe('red');
    expect(r.approvals.pencil.map((a) => a.kind)).toContain('variance'); // range still open
    expect(r.questions.map((q) => q.id)).toContain('q.single_unit_includes_attached'); // still asked
  });

  it('rowhouses: only a City confirmation turns 21 ft into ink', () => {
    const c = ctxFor(b, {
      audit: [
        audit({
          question_id: 'q.single_unit_includes_attached',
          action: 'city_confirmed',
          choice: 'yes',
          reference: { text: 'email', date: '2026-09-27', who: 'Zoning Administrator' },
        }),
      ],
    });
    const r = evaluate(c, scen(b, 'row', [25, 26, 27]));
    expect(r.units.filter((u) => u.end).map((u) => u.width.deed)).toEqual([21, 21]);
    expect(r.units.every((u) => u.trust === 'ink')).toBe(true);
    expect(r.checks.find((c2) => c2.id === 'width')!.status).toBe('pass');
    expect(r.checks.find((c2) => c2.id === 'width')!.approvals).toEqual([]);
  });

  it('depth on every 24 × 100 lot is 100 − 25 − 25 = 50 ft', () => {
    const lots = b.parcels.filter((p) => p.deed?.depth === 100 && p.deed.front === 24 && p.zone === 'RM-M' && p.addr_street === 'Mahon Street');
    expect(lots.length).toBeGreaterThanOrEqual(10);
    for (const p of lots) {
      const r = evaluate(ctx, { ...scen(b, 'two', [25]), pins: [p.pin] });
      if (r.state !== 'ok') continue; // refused lots are covered below
      expect(r.depth!.deed).toBe(50);
      expect(r.depth!.formula).toBe('100 − 25 − 25 = 50');
    }
  });
});

describe('other lots on Block 10‑K', () => {
  it('lot 28 is 24 × 62: depth 62 − 25 − 25 = 12 ft fails a 30 ft minimum depth', () => {
    const r = evaluate(ctx, scen(b, 'detached', [28], { depth: 30 }));
    expect(r.depth!.deed).toBe(12);
    expect(r.checks.find((c) => c.id === 'depth')!.status).toBe('fail');
  });

  it('lot 22 · 2247 Humber Way: records disagree (1,200 sf assessed vs ≈2,500 sf mapped) → Can’t score', () => {
    const r = evaluate(ctx, scen(b, 'two', [22]));
    expect(r.state).toBe('refused');
    expect(r.refusal!.code).toBe('records_disagree');
    expect(r.refusal!.values!.assessed).toBe(1200);
    expect(Number(r.refusal!.values!.ratio)).toBeGreaterThan(2);
    expect(r.score).toBeNull();
  });

  it('edge labels on lots 21, 25 and 34: front on Mahon Street, rear on Humber Way', () => {
    for (const lot of [21, 25, 34]) {
      const p = b.parcels.find((x) => x.pin === pinOf(b, lot))!;
      const others = b.parcels.filter((x) => x.pin !== p.pin).map((x) => ({ pin: x.pin, ring: openRing(x.poly[0]), built: x.built, addr: x.addr, lot: x.lot }));
      const lab = labelEdges(p.poly[0], others, b.streets, p.addr_street);
      expect(lab.ok).toBe(true);
      const front = lab.sides.filter((s) => s.kind === 'front');
      const rear = lab.sides.filter((s) => s.kind === 'rear');
      expect(front).toHaveLength(1);
      expect(front[0].street).toBe('Mahon Street');
      expect(rear).toHaveLength(1);
      expect(rear[0].street ?? rear[0].neighbors.map((n) => n.addr).join()).toMatch(/Humber/);
    }
  });

  it("lot 21's neighbor lot 22 is built, so the contextual setback is pencil (scored at a 12% tolerance)", () => {
    const c = { ...ctx, settings: { ...ctx.settings, recon_tolerance: 0.12 } };
    const r = evaluate(c, scen(b, 'two', [21]));
    expect(r.state).toBe('ok');
    const cx = r.checks.find((x) => x.id === 'contextual')!;
    expect(cx.trust).toBe('pencil');
    expect(cx.text).toMatch(/2247 Humber Way/);
  });

  it("lot 25's neighbors (24, 26) are vacant, so the contextual setback is not available (ink)", () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const cx = r.checks.find((x) => x.id === 'contextual')!;
    expect(cx.trust).toBe('ink');
    expect(cx.text).toMatch(/Both neighbors are vacant/);
    const sides = r.sides.filter((s) => s.kind === 'side_interior');
    expect(sides.flatMap((s) => s.neighbors.map((n) => n.lot)).sort()).toEqual([24, 26]);
    expect(sides.every((s) => s.neighbors.every((n) => !n.built))).toBe(true);
  });

  it('lot 27 has no plan-lot number in its deed text (never inferred)', () => {
    const p = b.parcels.find((x) => x.pin === pinOf(b, 27))!;
    expect(p.deed!.plan_lot).toBeNull();
  });
});
