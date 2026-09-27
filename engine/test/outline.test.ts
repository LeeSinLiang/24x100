// The map's outline inset for a City lot without block detail (engine/src/outline.ts) must draw what the lot
// engine would: the same edge labels, the same setbacks as the citywide classifier, the same envelope as
// evaluate(). Checked on every RM‑M vacant lot of Block 10‑K, built as the static API builds an outline.
import { describe, expect, it } from 'vitest';
import { area, classifyCityLot, cityLotFromGeometry, evaluate, openRing, DEFAULT_SETTINGS, type CityLot } from '../src';
import { outlinePlan, type LotOutline } from '../src/outline';
import { block10K, ctxFor, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);
const parcels = b.parcels.filter((p) => p.zone === 'RM-M' && !p.built);
const outlineOf = (pin: string): LotOutline => {
  const p = b.parcels.find((x) => x.pin === pin)!;
  return {
    origin: null,
    addr_street: p.addr_street ?? b.meta.main_street,
    ring: p.poly[0],
    neighbors: b.parcels.filter((q) => q.pin !== pin).map((q) => ({ pin: q.pin, lot: q.lot, addr: q.addr, built: q.built, ring: q.poly[0] })),
    streets: b.streets,
  };
};
const cityLot = (pin: string): CityLot => {
  const p = b.parcels.find((x) => x.pin === pin)!;
  const o = outlineOf(pin);
  return cityLotFromGeometry(
    { pin: p.pin, addr: p.addr, hood: 'Middle Hill', ward: 5, zone: p.zone, status: p.city?.status ?? 'not City-owned', status_updated: null, ll: [0, 0], deed: p.deed, assessed: p.assess?.lotarea ?? null, mapped: p.mapped_area, slope25: p.slope25 },
    o.ring,
    o.neighbors.map((n) => ({ pin: n.pin, ring: openRing(n.ring), built: n.built, addr: n.addr, lot: n.lot })),
    o.streets,
    o.addr_street,
  );
};
const xs = (r: [number, number][]) => r.map((q) => q[0]);
const ys = (r: [number, number][]) => r.map((q) => q[1]);

describe('outline plan: the same envelope as the lot engine', () => {
  for (const type of ['two', 'detached'] as const) {
    it(`${type}: setbacks match the classifier and the envelope matches evaluate() on every RM‑M vacant lot of 10‑K`, () => {
      let compared = 0;
      for (const p of parcels) {
        const l = cityLot(p.pin);
        const c = classifyCityLot(l, ctx.rs, type, DEFAULT_SETTINGS);
        const plan = outlinePlan(outlineOf(p.pin), l, c, ctx.rs, type);
        if (['rules', 'records', 'edges'].includes(c.blocker)) {
          expect(plan.envelope).toBeNull();
          expect(plan.envelopeNote).toBeTruthy();
          continue;
        }
        expect(plan.ok).toBe(true);
        // The sides that meet the front carry the classifier's setbacks.
        const fi = plan.sides.findIndex((s) => s.kind === 'front');
        const n = plan.sides.length;
        const flank = [plan.sides[(fi - 1 + n) % n], plan.sides[(fi + 1) % n]].filter((s) => s.kind !== 'rear' && s.kind !== 'front');
        expect(flank.map((s) => s.setback).sort()).toEqual([...c.setbacks].sort());
        // The envelope is evaluate()'s, turned.
        const r = evaluate(ctx, { ...scen(b, type, [25]), pins: [p.pin] });
        if (r.state !== 'ok') continue;
        if (r.envelope.poly.length < 3) expect(plan.envelope).toBeNull();
        else {
          expect(plan.envelope).not.toBeNull();
          expect(Math.abs(area(plan.envelope!) - r.envelope.area)).toBeLessThan(1);
          const w = Math.max(...xs(plan.envelope!)) - Math.min(...xs(plan.envelope!));
          expect(Math.abs(w - r.width!.mapped)).toBeLessThan(0.3);
        }
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(8);
    });
  }

  it('turns the drawing so the front runs along the bottom, the lot above it', () => {
    for (const p of parcels) {
      const l = cityLot(p.pin);
      const plan = outlinePlan(outlineOf(p.pin), l, classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS), ctx.rs, 'two');
      if (!plan.ok) continue;
      const f = plan.front!;
      expect(Math.abs(f.a[1] - f.b[1])).toBeLessThan(0.05);
      expect(Math.max(...ys(plan.ring)) - f.a[1]).toBeLessThan(0.6);
      expect(Math.min(...ys(plan.ring))).toBeLessThan(f.a[1] - 20);
    }
  });

  it('draws no buildable area where the rules are not loaded', () => {
    const p = parcels[0];
    const l = { ...cityLot(p.pin), zone: 'R1D-XX' };
    const plan = outlinePlan(outlineOf(p.pin), l, classifyCityLot(l, null, 'two', DEFAULT_SETTINGS), null, 'two');
    expect(plan.envelope).toBeNull();
    expect(plan.ring.length).toBeGreaterThanOrEqual(4);
    expect(plan.envelopeNote).toMatch(/Rules not loaded/);
  });

  it('Mahon lot 25, two-unit: a 3.4 ft sliver on the City map (4 ft by deed)', () => {
    const pin = parcels.find((p) => p.lot === 25)!.pin;
    const l = cityLot(pin);
    const c = classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c.width).toBe(4);
    const plan = outlinePlan(outlineOf(pin), l, c, ctx.rs, 'two');
    const w = Math.max(...xs(plan.envelope!)) - Math.min(...xs(plan.envelope!));
    expect(w).toBeGreaterThan(3.2);
    expect(w).toBeLessThan(3.6);
  });
});
