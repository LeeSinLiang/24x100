// The city map and the lot view must agree: same deed arithmetic, same edge labels.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyCityLot, cityLotFromGeometry, cityRoutes, evaluate, openRing, summarize, DEFAULT_SETTINGS, type CityLot } from '../src';
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
          if (r.refusal!.code === 'records_disagree') expect(c.blocker).toBe('records');
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

  it('a district without rules is grey even where records disagree, and is not counted as computed', () => {
    const bad = lots.find((l) => classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS).blocker === 'records')!;
    expect(classifyCityLot({ ...bad, zone: 'R2-L' }, null, 'two', DEFAULT_SETTINGS).blocker).toBe('rules');
    const s = summarize([{ ...bad, zone: 'R2-L' }], [classifyCityLot({ ...bad, zone: 'R2-L' }, null, 'two', DEFAULT_SETTINGS)], 'two');
    expect(s.districts[0].computed).toBe(false);
  });

  it('a district with only use rules (Hillside): the use table decides once a person has checked it, never from pencil', () => {
    const l = { ...lots.find((x) => x.edges_ok && x.pin.endsWith('25000000'))!, zone: 'H' };
    const shape = ctx.rs.rules.find((r) => r.district === '*')!; // any stored rule: the H rule takes its shape
    const hRule = (state: 'ink' | 'pencil', value: string) => ({ ...shape, id: 'h.x.use_two', district: 'H', field: 'use_two', unit: 'use', applies_to: ['two'], section: '911.02', value, state, ai_checked: false });
    const rsH = (state: 'ink' | 'pencil', value = 'N') => ({ district: 'H', rules: [...ctx.rs.rules.filter((r) => r.district === '*'), hRule(state, value)], questions: [] }) as unknown as typeof ctx.rs;
    // Pencil: the model's reading of the table, not checked by a person: grey, and said to be pencil.
    const pencil = classifyCityLot(l, rsH('pencil'), 'two', DEFAULT_SETTINGS);
    expect(pencil.blocker).toBe('rules');
    expect(pencil.note).toMatch(/still pencil/);
    // Checked: not permitted here, in ink, without any dimensional rule.
    const ink = classifyCityLot(l, rsH('ink'), 'two', DEFAULT_SETTINGS);
    expect(ink).toMatchObject({ blocker: 'use', trust: 'ink' });
    // Permitted (or needing an approval) with no dimensional rules: nothing to compute, grey.
    expect(classifyCityLot(l, rsH('ink', 'S'), 'two', DEFAULT_SETTINGS)).toMatchObject({ blocker: 'rules', note: 'Rules not loaded for H' });
    // A district with signed dimensional rules is unchanged: RM‑M permits a two-unit house.
    expect(classifyCityLot(lots.find((x) => x.edges_ok && x.pin.endsWith('25000000'))!, ctx.rs, 'two', DEFAULT_SETTINGS).blocker).toBe('width');
  });

  it('summary counts width-but-not-area separately (H1)', () => {
    const cls = lots.map((l) => classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS));
    const s = summarize(lots, cls, 'two');
    expect(s.total).toBe(lots.length);
    expect(s.widthNotArea).toBeGreaterThan(0);
    expect(s.widthNotArea).toBeLessThanOrEqual(s.widthAny);
  });
});

// §925.06.C: a side next to a built lot may take less than the district setback, down to 3 ft. The
// lot engine marks that situation pencil (its contextual check); the classifier must agree, and must
// keep the width in ink only where no neighbor's setback could change the answer.
describe('contextual side setback: the classifier agrees with the lot engine', () => {
  const MIN = 3; // pgh.contextual_side
  for (const type of ['two', 'detached', 'three'] as const) {
    it(`${type}: built neighbors and pencil width match the engine on every Block 10‑K lot with full detail`, () => {
      let built = 0;
      for (const l of lots) {
        const r = evaluate(ctx, { ...scen(b, type, [25]), pins: [l.pin] });
        if (r.state === 'refused') continue;
        const c = classifyCityLot(l, ctx.rs, type, DEFAULT_SETTINGS);
        const cx = r.checks.find((x) => x.id === 'contextual')!;
        // Same neighbors: the engine's contextual check is pencil exactly where the classifier sees a built one.
        expect(c.context!.neighbors === 'built').toBe(cx.trust === 'pencil');
        if (cx.trust === 'pencil') built++;
        // Same best case, from the engine's own sides: each side next to a built lot at the minimum.
        const flank = r.sides.filter((s) => s.kind === 'side_interior' || s.kind === 'side_exterior');
        const best = r.width!.terms[0].value - flank.reduce((a, s) => a + (s.kind === 'side_interior' && s.neighbors.some((n) => n.built) ? Math.min(s.setback!, MIN) : s.setback!), 0);
        const fails = r.checks.find((x) => x.id === 'width')!.status === 'fail';
        const couldChange = cx.trust === 'pencil' && fails && best >= r.scenario.proposal.width;
        expect(c.context!.matters).toBe(couldChange);
        expect(c.widthTrust).toBe(couldChange ? 'pencil' : r.width!.trust);
      }
      expect(built).toBeGreaterThanOrEqual(4);
    });
  }

  it('Block 10‑K has both cases: a built neighbor that could change the answer, and one that can’t', () => {
    const at = (pin: string, type: 'two' | 'three') => classifyCityLot(lots.find((l) => l.pin === pin)!, ctx.rs, type, DEFAULT_SETTINGS);
    // 2245 Mahon St, 24 ft, a built house on one side: even at 3 ft, 24 − 3 − 10 = 11 ft < 16 ft.
    const mahon = at('0010K00023000000', 'two');
    expect(mahon.context).toMatchObject({ neighbors: 'built', matters: false, formula: '24 − 3 − 10 = 11' });
    expect(mahon.widthTrust).toBe('ink');
    // 2240 Wylie Ave, 48 ft, three-unit house (30 ft): 48 − 10 − 3 = 35 ft could fit.
    const wylie = at('0010K00073000000', 'three');
    expect(wylie.context).toMatchObject({ neighbors: 'built', matters: true, best: 35 });
    expect(wylie.widthTrust).toBe('pencil');
    expect(wylie.trust).toBe('pencil');
    expect(wylie.areaTrust).toBe('ink'); // area comes from the deed; the neighbor doesn't touch it
  });
});

describe('contextual side setback on a lot without block detail', () => {
  const base = lots.find((l) => l.pin === '0010K00025000000')!; // 24 × 100, both neighbors vacant
  const lot = (front: number, flank: CityLot['flank'], depth = 100): CityLot => ({ ...base, deed: { front, depth }, assessed: front * depth, mapped: front * depth, flank });

  it('7406 Race St: 30 ft between two built houses is pencil, with the best case in words', () => {
    const c = classifyCityLot(lot(30, ['interior_built', 'interior_built']), ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c.blocker).toBe('width');
    expect(c.formula).toBe('30 − 10 − 10 = 10');
    expect(c.context).toMatchObject({ neighbors: 'built', minimum: 3, best: 24, formula: '30 − 3 − 3 = 24', matters: true, rule: 'pgh.contextual_side' });
    expect(c.widthTrust).toBe('pencil');
    expect(c.widthNote).toMatch(/built neighbor may allow a contextual side setback/);
    const routes = cityRoutes(lot(30, ['interior_built', 'interior_built']), c, ctx.rs, 'two');
    expect(routes[0]).toMatchObject({ kind: 'contextual', trust: 'pencil' });
    expect(routes[0].text).toContain('30 − 3 − 3 = 24 ft');
    expect(routes.find((x) => x.kind === 'variance')!.text).toBe('A side-setback variance (10 → 7 ft on each side) from the Zoning Board of Adjustment is a plausible route, not approval.');
  });

  it('the same lot between vacant lots stays ink: the district setback applies', () => {
    const c = classifyCityLot(lot(30, ['interior_vacant', 'interior_vacant']), ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c.context).toMatchObject({ neighbors: 'vacant', matters: false, best: null });
    expect(c.widthTrust).toBe('ink');
    const routes = cityRoutes(lot(30, ['interior_vacant', 'interior_vacant']), c, ctx.rs, 'two');
    expect(routes.map((x) => x.kind)).toEqual(['group', 'variance']);
  });

  it('a lot that fits stays ink next to a built house: the contextual setback only ever relaxes', () => {
    const c = classifyCityLot(lot(40, ['interior_built', 'interior_built']), ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c.all).not.toContain('width');
    expect(c.context!.matters).toBe(false);
    expect(c.widthTrust).toBe('ink');
  });

  it('without a checked contextual rule, a width failure next to a built lot is pencil, never bounded by a guess', () => {
    const rs = { ...ctx.rs, rules: ctx.rs.rules.map((r) => (r.field === 'contextual_side' ? { ...r, state: 'pencil' as const } : r)) };
    const narrow = lot(18, ['interior_built', 'interior_vacant']); // 18 − 3 − 10 = 5: can't fit even at 3 ft
    expect(classifyCityLot(narrow, ctx.rs, 'two', DEFAULT_SETTINGS).context).toMatchObject({ matters: false, best: 5 });
    const c = classifyCityLot(narrow, rs, 'two', DEFAULT_SETTINGS);
    expect(c.context).toMatchObject({ neighbors: 'built', minimum: null, best: null, matters: true });
    expect(c.widthTrust).toBe('pencil');
  });

  it('a lot narrower than the house says a variance can’t make room', () => {
    const l = lot(14, ['interior_vacant', 'interior_vacant'], 200); // 2,800 sf: big enough
    const c = classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c.blocker).toBe('width');
    expect(c.formula).toBe('14 − 10 − 10 leaves no buildable width');
    const v = cityRoutes(l, c, ctx.rs, 'two').find((x) => x.kind === 'variance')!;
    expect(v.text).toMatch(/narrower than 16 ft even with no side setbacks/);
  });

  it('the headline splits width-not-area into ink, a built neighbor’s setback, and mapped frontage', () => {
    const set = [
      lot(30, ['interior_built', 'interior_built']), // context
      lot(30, ['interior_vacant', 'interior_vacant']), // ink
      lot(26, ['interior_built', 'interior_vacant']), // 26 − 3 − 10 = 13 < 16: ink
      { ...lot(30, ['interior_vacant', 'interior_vacant']), deed: null, front_len: 30 }, // mapped
    ];
    const s = summarize(set, set.map((l) => classifyCityLot(l, ctx.rs, 'two', DEFAULT_SETTINGS)), 'two');
    expect(s.widthNotArea).toBe(4);
    expect([s.widthNotAreaInk, s.widthNotAreaContext, s.widthNotAreaMapped]).toEqual([2, 1, 1]);
  });

  it('the real record for 7406 Race St (data/city/lots.json) reads pencil', () => {
    const city = JSON.parse(readFileSync('data/city/lots.json', 'utf8')) as { lots: CityLot[] };
    const race = city.lots.find((l) => l.pin === '0174L00001000000')!;
    expect(race.flank).toEqual(['interior_built', 'interior_built']);
    const c = classifyCityLot(race, ctx.rs, 'two', DEFAULT_SETTINGS);
    expect(c).toMatchObject({ blocker: 'width', formula: '30 − 10 − 10 = 10', widthTrust: 'pencil' });
  });
});
