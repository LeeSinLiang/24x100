// C15 assembly finder (spec §0.14): adjacency on synthetic geometry, owner types, and the committed
// output cross-checked against the lot engine on Block 10‑K.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ownerType, runsFor, streetOf, type AsmParcel } from '../src/assembly';
import { cityLotFromGeometry } from '../src/city';
import { DEFAULT_SETTINGS, evaluate, type Ring, type Street } from '../src';
import { block10K, ctxFor, scen } from './load';

const rs = ctxFor(block10K()).rs;
const street: Street = { name: 'Test St', line: [[-200, -15], [400, -15]] };
const back: Street = { name: 'Other Way', line: [[-200, 215], [400, 215]] };
const box = (x0: number, y0: number, w: number, d: number): Ring => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];

function parcels(opts: { builtA?: boolean; zoneD?: string } = {}) {
  const P = (pin: string, ring: Ring, extra: Partial<AsmParcel> = {}): AsmParcel => ({
    pin, addr: `${pin} Test St`, zone: 'RM-M', built: false, multipolygon: null, deed: { front: 24, depth: 100 }, assessed: 2400, mapped: 2400,
    ring, nbrs: [], city: null, assess: { class: 'RESIDENTIAL', ownercat: 'CORPORATION', use: 'VACANT LAND' }, lot: null, lot_suffix: null, ...extra,
  });
  const all = [
    P('Z0', box(-24, 0, 24, 100), { built: true }), // houses at both ends of the row, as on a real block
    P('A', box(0, 0, 24, 100), { built: !!opts.builtA }),
    P('B', box(24, 0, 24, 100), { city: { status: 'Available for Sale', status_updated: null } }),
    P('C', box(48, 0, 24, 100)),
    P('D', box(72, 0, 24, 100), { zone: opts.zoneD ?? 'RM-M', city: { status: 'Available for Sale', status_updated: null } }),
    P('Z5', box(96, 0, 24, 100), { built: true }),
    P('E', box(24, 100, 24, 100), { addr: 'E Other Way' }), // behind B: touches only its rear
  ];
  const touch: Record<string, string[]> = { Z0: ['A'], A: ['Z0', 'B'], B: ['A', 'C', 'E'], C: ['B', 'D'], D: ['C', 'Z5'], Z5: ['D'], E: ['B'] };
  for (const p of all) p.nbrs = touch[p.pin];
  return new Map(all.map((p) => [p.pin, p]));
}

function candidate(all: Map<string, AsmParcel>, pin = 'B') {
  const p = all.get(pin)!;
  return cityLotFromGeometry(
    { pin, addr: p.addr!, hood: 'Test', ward: 5, zone: 'RM-M', status: 'Available for Sale', status_updated: null, ll: [0, 0], deed: p.deed, assessed: p.assessed, mapped: p.mapped, slope25: 0 },
    p.ring,
    p.nbrs.map((n) => ({ pin: n, ring: all.get(n)!.ring, built: all.get(n)!.built, addr: all.get(n)!.addr!, lot: null })),
    [street, back],
    'Test St',
  );
}

describe('assembly finder: adjacency', () => {
  it('finds runs of three on the block face (72 − 10 − 10 = 52), never the lot behind', () => {
    const all = parcels();
    const runs = runsFor(candidate(all), all, [street, back], rs, 'three', DEFAULT_SETTINGS);
    expect(runs.map((r) => [...r.pins].sort().join('+')).sort()).toEqual(['A+B+C', 'B+C+D']);
    for (const r of runs) {
      expect(r.formula).toBe('72 − 10 − 10 = 52');
      expect(r.pins).not.toContain('E');
    }
  });

  it('two lots are enough for a two-unit house (48 − 10 − 10 = 28), and a run of three that contains one is dropped', () => {
    const all = parcels();
    const runs = runsFor(candidate(all), all, [street, back], rs, 'two', DEFAULT_SETTINGS);
    expect(runs.every((r) => r.pins.length === 2)).toBe(true);
    expect(runs.map((r) => r.formula)).toEqual(['48 − 10 − 10 = 28', '48 − 10 − 10 = 28']);
  });

  it('a built neighbour is not a partner; a lot in another district is not a partner', () => {
    const skips = new Map();
    const all = parcels({ builtA: true, zoneD: 'R1D-H' });
    const runs = runsFor(candidate(all), all, [street, back], rs, 'three', DEFAULT_SETTINGS, skips);
    expect(runs).toEqual([]);
    expect(skips.get('A')).toBe('built');
    expect(skips.get('D')).toBe('other_zone');
  });

  it('counts owners who aren’t the City; never a name', () => {
    const all = parcels();
    const [r] = runsFor(candidate(all), all, [street, back], rs, 'three', DEFAULT_SETTINGS).filter((x) => x.pins.includes('D'));
    expect(r.non_city).toBe(1); // C
    expect(r.lots.map((l) => l.owner_type)).toEqual(['city_for_sale', 'corporation', 'city_for_sale']);
    expect(JSON.stringify(r)).not.toMatch(/owner_name|PROPERTYOWNER|mailing/i);
  });
});

describe('owner type', () => {
  it('reads the City inventory first, then the County class and owner category', () => {
    expect(ownerType({ city: { status: 'Available for Sale', status_updated: null }, assess: null }).type).toBe('city_for_sale');
    expect(ownerType({ city: { status: 'Hold for Study', status_updated: null }, assess: null }).type).toBe('city_held');
    expect(ownerType({ city: null, assess: { class: 'GOVERNMENT', ownercat: 'CORPORATION', use: 'MUNICIPAL GOVERNMENT' } }).type).toBe('public_body');
    expect(ownerType({ city: null, assess: { class: 'RESIDENTIAL', ownercat: 'CORPORATION', use: 'VACANT LAND' } }).type).toBe('corporation');
    expect(ownerType({ city: null, assess: { class: 'RESIDENTIAL', ownercat: 'REGULAR-ETUX OR ET VIR', use: 'VACANT LAND' } }).type).toBe('individual');
    expect(ownerType({ city: null, assess: null }).type).toBe('unknown');
  });
  it('street names come from addresses', () => {
    expect(streetOf('2241 Mahon St')).toBe('Mahon St');
    expect(streetOf('Mahon St (no number)')).toBe('Mahon St');
    expect(streetOf('713-715 Hale St')).toBe('Hale St');
  });
});

describe('assembly finder: the committed output', () => {
  const f = JSON.parse(readFileSync('data/city/assemblies.json', 'utf8'));
  it('finds Mahon lots 25–27 as a three-unit run: 52 ft, 1 lot not City-owned (lot 26, a corporation)', () => {
    const r = f.runs.find((x: { type: string; pins: string[] }) => x.type === 'three' && [...x.pins].sort().join('+') === '0010K00025000000+0010K00026000000+0010K00027000000');
    expect(r).toBeTruthy();
    expect(r.width).toBe(52);
    expect(r.non_city).toBe(1);
    expect(r.lots.find((l: { pin: string }) => l.pin === '0010K00026000000').owner_type).toBe('corporation');
    expect(r.lots_param).toBe('25,26,27');
  });

  it('every run inside Block 10‑K has the lot engine’s width for the same lots', () => {
    const b = block10K();
    const ctx = ctxFor(b);
    const inK = f.runs.filter((x: { block: string | null }) => x.block === '10K');
    expect(inK.length).toBeGreaterThan(0);
    for (const r of inK) {
      const lots = (r.lots_param as string).split(',').map(Number);
      const res = evaluate(ctx, scen(b, r.type, lots));
      expect(res.state).toBe('ok');
      expect(res.width!.deed ?? res.width!.mapped).toBeCloseTo(r.width, 1);
      expect(res.checks.find((c) => c.id === 'width')!.status).not.toBe('fail');
    }
  });

  it('records what it skipped and why, and never names an owner', () => {
    expect(f.meta.skipped.records).toBeGreaterThan(0);
    expect(f.meta.built_neighbours).toMatch(/not partners/);
    expect(JSON.stringify(f)).not.toMatch(/PROPERTYOWNER|CHANGENOTICE|TAXBILL|owner_name/i);
  });
});

describe('assembly finder: groups that share no lot', () => {
  it('counts the most groups that share no lot, exactly', async () => {
    const { maxDisjoint } = await import('../../scripts/build-assemblies');
    // A block face 1–2–3–4–5: groups 1·2, 2·3, 3·4, 4·5 and 1·2·3. At most two share no lot (1·2 with 3·4, …).
    const g = (...p: string[]) => ({ pins: p });
    expect(maxDisjoint([g('1', '2'), g('2', '3'), g('3', '4'), g('4', '5'), g('1', '2', '3')])).toBe(2);
    expect(maxDisjoint([g('1', '2'), g('3', '4'), g('5', '6')])).toBe(3); // none overlap
    expect(maxDisjoint([g('1', '2'), g('1', '3'), g('1', '4')])).toBe(1); // all share lot 1
    // The committed file: 111 three-unit groups; the best set that shares no lot is 80.
    const f = JSON.parse(readFileSync('data/city/assemblies.json', 'utf8'));
    expect(maxDisjoint(f.runs.filter((r: { type: string }) => r.type === 'three'))).toBe(80);
  });
});
