// The city map and the lot view must agree: same deed arithmetic, same edge labels.
import { describe, expect, it } from 'vitest';
import { classifyCityLot, cityLotFromGeometry, evaluate, openRing, summarize, DEFAULT_SETTINGS, type CityLot } from '../src';
import { block10K, ctxFor, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);
const lots: CityLot[] = b.parcels
  .filter((p) => p.zone === 'RM-M' && !p.built)
  .map((p) =>
    cityLotFromGeometry(
      { pin: p.pin, addr: p.addr, hood: 'Middle Hill', ward: 5, zone: p.zone, status: p.city?.status ?? 'not City-owned', status_updated: null, ll: [0, 0], deed: p.deed, assessed: p.assess?.lotarea ?? null, mapped: p.mapped_area, slope25: p.slope25 },
      p.poly[0],
      b.parcels.filter((q) => q.pin !== p.pin).map((q) => ({ pin: q.pin, ring: openRing(q.poly[0]), built: q.built, addr: q.addr, lot: q.lot })),
      b.streets,
      p.addr_street,
    ),
  );

describe('city classifier agrees with the lot engine', () => {
  for (const type of ['two', 'detached'] as const) {
    it(`${type}: width and refusal match on every RM‑M vacant lot of Block 10‑K`, () => {
      let compared = 0;
      for (const l of lots) {
        const c = classifyCityLot(l, ctx.rs, type, DEFAULT_SETTINGS);
        const r = evaluate(ctx, { ...scen(b, type, [25]), pins: [l.pin] });
        if (r.state === 'refused') {
          expect(['records', 'edges', 'rules']).toContain(c.blocker);
          continue;
        }
        expect(Math.abs((c.width ?? 0) - (r.width!.deed ?? r.width!.mapped))).toBeLessThan(0.051);
        expect(c.all.includes('width')).toBe(r.checks.find((x) => x.id === 'width')!.status === 'fail');
        expect(c.all.includes('area')).toBe(['fail', 'needs_survey'].includes(r.checks.find((x) => x.id === 'area')!.status));
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(10);
    });
  }

  it('grey means rules not loaded: never a guess', () => {
    const l = { ...lots.find((x) => x.edges_ok && x.pin.endsWith('25000000'))!, zone: 'R2-L' };
    expect(classifyCityLot(l, null, 'two', DEFAULT_SETTINGS).blocker).toBe('rules');
  });

  it('pencil rules do not colour the map', () => {
    const pencil = { ...ctx.rs, rules: ctx.rs.rules.map((r) => ({ ...r, state: 'pencil' as const })) };
    expect(classifyCityLot(lots.find((l) => l.edges_ok && l.pin.endsWith('25000000'))!, pencil, 'two', DEFAULT_SETTINGS).blocker).toBe('rules');
  });

  it('summary counts width-but-not-area separately (H1)', () => {
    const cls = lots.map((l) => classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS));
    const s = summarize(lots, cls, 'two');
    expect(s.total).toBe(lots.length);
    expect(s.widthNotArea).toBeGreaterThan(0);
    expect(s.widthNotArea).toBeLessThanOrEqual(s.widthAny);
  });
});
