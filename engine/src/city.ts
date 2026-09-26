// Citywide first-blocker classification (spec §0.6). The same deed arithmetic as evaluate(), on a
// compact per-lot input whose edge labels were computed by labelEdges() at build time.
import { labelEdges, type Neighbor } from './edges';
import { pick, ruleTrust } from './rules';
import { TEMPLATES } from './templates';
import type { NarrowRow, Proposal, Ring, RuleSet, Settings, Street, TemplateId, Trust } from './types';

export type Blocker = 'records' | 'rules' | 'edges' | 'area' | 'width' | 'depth' | 'ownership' | 'fits';
export type FlankKind = 'interior_vacant' | 'interior_built' | 'exterior';

export interface CityLot {
  pin: string;
  addr: string;
  hood: string;
  ward: number | null;
  zone: string | null;
  status: string;
  status_updated: string | null;
  ll: [number, number]; // lon, lat of a representative point
  deed: { front: number; depth: number } | null;
  assessed: number | null;
  mapped: number;
  front_len: number | null; // mapped length of the front side (ft)
  flank: FlankKind[]; // the sides that meet the front
  edges_ok: boolean;
  edge_note: string | null;
  slope25: number;
}

export interface CityClass {
  blocker: Blocker;
  all: Blocker[]; // every blocker that applies, in order (for H1 counts)
  width: number | null;
  depth: number | null;
  area: number | null;
  trust: Trust;
  formula: string | null;
  note: string;
}

export const BLOCKER_ORDER: Blocker[] = ['rules', 'records', 'edges', 'area', 'width', 'depth', 'ownership', 'fits'];

export const BLOCKER_WORDS: Record<Blocker, string> = {
  records: 'records disagree',
  rules: 'rules not loaded',
  edges: 'edges not computed',
  area: 'lot area',
  width: 'width',
  depth: 'depth',
  ownership: 'not listed for sale',
  fits: 'fits as of right',
};

function narrowRow(v: unknown, width: number): NarrowRow | null {
  if (!Array.isArray(v) || width >= 60) return null;
  const w = Math.floor(width);
  return [...(v as NarrowRow[])].sort((a, b) => a.max_width - b.max_width).find((r) => r.max_width >= w) ?? null;
}

/** Build the compact input from real geometry (used by scripts/build-city.ts and the tests). */
export function cityLotFromGeometry(
  base: Omit<CityLot, 'front_len' | 'flank' | 'edges_ok' | 'edge_note'>,
  ring: Ring,
  neighbors: Neighbor[],
  streets: Street[],
  addrStreet: string | null,
): CityLot {
  const lab = labelEdges(ring, neighbors, streets, addrStreet);
  if (!lab.ok) return { ...base, front_len: null, flank: [], edges_ok: false, edge_note: lab.note };
  const fi = lab.sides.findIndex((s) => s.kind === 'front');
  const n = lab.sides.length;
  const flankSides = [lab.sides[(fi - 1 + n) % n], lab.sides[(fi + 1) % n]].filter((s) => s.kind !== 'rear' && s.kind !== 'front');
  const flank: FlankKind[] = flankSides.map((s) => (s.kind === 'side_exterior' ? 'exterior' : s.neighbors.some((x) => x.built) ? 'interior_built' : 'interior_vacant'));
  return { ...base, front_len: Math.round(lab.sides[fi].length * 10) / 10, flank, edges_ok: true, edge_note: lab.note };
}

export function classifyCityLot(lot: CityLot, rs: RuleSet | null, type: TemplateId, settings: Settings, proposal: Proposal = TEMPLATES[type].proposal): CityClass {
  const none = (blocker: Blocker, note: string, trust: Trust = 'ink'): CityClass => ({ blocker, all: [blocker], width: null, depth: null, area: null, trust, formula: null, note });
  const all: Blocker[] = [];
  // Grey first: nothing is computed in a district whose rules haven't been loaded and checked.
  if (!rs || !lot.zone || rs.district !== lot.zone) return none('rules', `Rules not loaded for ${lot.zone ?? 'this district'}`, 'pencil');
  const R = {
    minArea: pick(rs, 'min_lot_area'),
    front: pick(rs, 'front_setback'),
    rear: pick(rs, 'rear_setback'),
    sideInt: pick(rs, 'side_setback_interior'),
    sideExt: pick(rs, 'side_setback_exterior'),
    narrow: pick(rs, 'narrow_lot_side_table'),
  };
  const needed = [R.minArea, R.front, R.rear, R.sideInt, ...(lot.flank.includes('exterior') ? [R.sideExt] : [])];
  if (needed.some((r) => !r || typeof r.value !== 'number')) return none('rules', `Rules not loaded for ${lot.zone}`, 'pencil');
  if (needed.some((r) => ruleTrust(r) !== 'ink')) return none('rules', `${lot.zone} rules are still pencil: not checked by a person`, 'pencil');
  if (lot.assessed != null && lot.assessed > 0 && Math.abs(lot.mapped / lot.assessed - 1) > settings.recon_tolerance) {
    return none('records', `County ${Math.round(lot.assessed)} sf vs City map ${Math.round(lot.mapped)} sf (${(lot.mapped / lot.assessed).toFixed(2)}×)`);
  }
  if (!lot.edges_ok) return none('edges', lot.edge_note ?? 'Edges not computed');

  const front = lot.deed?.front ?? lot.front_len ?? 0;
  const single = TEMPLATES[type].single_unit;
  const nrow = single ? narrowRow(R.narrow?.value, front) : null;
  const setbacks = lot.flank.map((k) => (k === 'exterior' ? (nrow ? nrow.streetside : (R.sideExt!.value as number)) : nrow ? nrow.interior : (R.sideInt!.value as number)));
  const width = front - setbacks.reduce((a, b) => a + b, 0);
  const depth = lot.deed ? lot.deed.depth - (R.front!.value as number) - (R.rear!.value as number) : null;
  const area = lot.deed ? lot.deed.front * lot.deed.depth : lot.assessed ?? lot.mapped;
  let trust: Trust = lot.deed ? 'ink' : 'pencil';
  const min = R.minArea!.value as number;
  // Same rule as the lot engine: the deed leads; if the assessment falls on the other side of the
  // minimum, the lot needs a survey (pencil), and area stays a blocker.
  const corroborate = lot.deed ? lot.assessed : lot.mapped;
  const flip = corroborate != null && corroborate >= min !== area >= min;
  if (area < min || flip) all.push('area');
  if (flip) trust = 'pencil';
  if (width < proposal.width) all.push('width');
  if (depth != null && depth < proposal.depth) all.push('depth');
  if (lot.status !== 'Available for Sale') all.push('ownership');
  if (!all.length) all.push('fits');
  const formula = `${[front, ...setbacks].map((v) => Math.round(v * 10) / 10).join(' − ')} = ${Math.round(width * 10) / 10}`;
  return {
    blocker: all[0],
    all,
    width: Math.max(0, Math.round(width * 10) / 10),
    depth: depth != null ? Math.max(0, depth) : null,
    area: Math.round(area),
    trust,
    formula,
    note: flip ? 'records fall on both sides of the minimum lot size: needs a survey' : lot.deed ? 'deed dimensions' : 'no deed dimensions: mapped frontage (pencil)',
  };
}

export interface CitySummary {
  type: TemplateId;
  total: number;
  computed: number; // lots with a real blocker (not rules / edges / records)
  byBlocker: Record<Blocker, number>;
  widthAny: number; // width is one of the blockers
  areaAny: number;
  widthNotArea: number; // big enough, too narrow: the 2025 reform's leftover barrier
  districts: { zone: string; lots: number; computed: boolean }[];
}

export function summarize(lots: CityLot[], classes: CityClass[], type: TemplateId): CitySummary {
  const byBlocker = Object.fromEntries(BLOCKER_ORDER.map((b) => [b, 0])) as Record<Blocker, number>;
  let widthAny = 0,
    areaAny = 0,
    widthNotArea = 0;
  const dz = new Map<string, { lots: number; computed: boolean }>();
  classes.forEach((c, i) => {
    byBlocker[c.blocker]++;
    if (c.all.includes('width')) widthAny++;
    if (c.all.includes('area')) areaAny++;
    if (c.all.includes('width') && !c.all.includes('area')) widthNotArea++;
    const z = lots[i].zone ?? '—';
    const cur = dz.get(z) ?? { lots: 0, computed: false };
    cur.lots++;
    cur.computed = cur.computed || c.blocker !== 'rules'; // rules are checked first, so any other blocker means computed
    dz.set(z, cur);
  });
  const computed = classes.filter((c) => !['rules', 'records', 'edges'].includes(c.blocker)).length;
  return {
    type,
    total: lots.length,
    computed,
    byBlocker,
    widthAny,
    areaAny,
    widthNotArea,
    districts: [...dz.entries()].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.lots - a.lots),
  };
}
