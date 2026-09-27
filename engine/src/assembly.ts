// Citywide assembly finder (spec §0.14, C15): which City-owned vacant lots become buildable as of right
// when combined with the lots beside them on the same block face, and what kind of owner holds each
// missing piece. It runs the citywide classifier (classifyCityLot, the arithmetic the city map already
// uses and that agrees with the lot engine on Block 10‑K) on a combined lot: the deeds' frontages summed,
// the shallowest depth, the areas summed, and the two outer sides of the run.
//
// Decisions (spec §0.14, accepted by the team): built neighbours are not partners (buying or demolishing a
// home is a different decision; reported as an open question); a run whose width depends on a built
// neighbour's contextual setback is pencil; corner lots are handled (an outer side on a street takes the
// exterior side setback, as the classifier already does). Owner names are never read or shown.
import { classifyCityLot, type CityClass, type CityLot, type FlankKind } from './city';
import { labelEdges, sameStreet, type Neighbor } from './edges';
import type { Ring, RuleSet, Settings, Street, TemplateId } from './types';

export interface AsmParcel {
  pin: string;
  addr: string | null;
  zone: string | null;
  built: boolean;
  multipolygon: string | null;
  deed: { front: number; depth: number } | null;
  assessed: number | null;
  mapped: number;
  ring: Ring; // local feet, in the candidate's frame
  nbrs: string[];
  city: { status: string; status_updated: string | null } | null;
  assess: { class: string | null; ownercat: string | null; use: string | null } | null;
  lot: number | null;
  lot_suffix: string | null;
}

export type OwnerType = 'city_for_sale' | 'city_held' | 'public_body' | 'corporation' | 'individual' | 'unknown';

/** Owner TYPE only: the City's inventory status, else the County's class and owner category. Never a name. */
export function ownerType(p: Pick<AsmParcel, 'city' | 'assess'>): { type: OwnerType; words: string } {
  if (p.city) return p.city.status === 'Available for Sale' ? { type: 'city_for_sale', words: 'City-owned, available for sale' } : { type: 'city_held', words: `City-owned, ${p.city.status.toLowerCase()}` };
  const cls = (p.assess?.class ?? '').toUpperCase();
  const cat = (p.assess?.ownercat ?? '').toUpperCase();
  if (cls === 'GOVERNMENT') return { type: 'public_body', words: `a public body (County use: ${(p.assess?.use ?? 'not recorded').toLowerCase()})` };
  if (cat.startsWith('CORPORATION')) return { type: 'corporation', words: 'a corporation (County owner type)' };
  if (cat.startsWith('REGULAR')) return { type: 'individual', words: 'a private individual (County owner type)' };
  return { type: 'unknown', words: 'owner type not recorded' };
}

/** "2241 Mahon St" → "Mahon St"; "Mahon St (no number)" → "Mahon St". */
export function streetOf(addr: string | null): string | null {
  if (!addr) return null;
  return addr.replace(/\s*\(no number\)\s*$/i, '').replace(/^\s*[\d-]+[A-Z]?\s+/, '').trim() || null;
}

interface Faces {
  front: string | null;
  front_len: number; // mapped length of the front side (ft)
  // The two sides that meet the front, in ring order, with the neighbours across each.
  flank: { kind: 'side_interior' | 'side_exterior'; pins: string[]; built: boolean }[];
}

/** Front street and flank sides of a parcel, from the same edge labelling the lot engine uses. */
export function facesOf(p: AsmParcel, all: Map<string, AsmParcel>, streets: Street[], addrStreet: string | null): Faces | null {
  const nbs: Neighbor[] = p.nbrs
    .map((n) => all.get(n))
    .filter((q): q is AsmParcel => !!q && q.ring.length >= 3)
    .map((q) => ({ pin: q.pin, ring: q.ring, built: q.built, addr: q.addr ?? '', lot: q.lot }));
  const lab = labelEdges(p.ring, nbs, streets, addrStreet);
  if (!lab.ok) return null;
  const fi = lab.sides.findIndex((s) => s.kind === 'front');
  if (fi < 0) return null;
  const n = lab.sides.length;
  const flank = [lab.sides[(fi - 1 + n) % n], lab.sides[(fi + 1) % n]]
    .filter((s) => s.kind === 'side_interior' || s.kind === 'side_exterior')
    .map((s) => ({ kind: s.kind as 'side_interior' | 'side_exterior', pins: s.neighbors.map((x) => x.pin), built: s.neighbors.some((x) => x.built) }));
  return { front: lab.sides[fi].street ?? addrStreet, front_len: Math.round(lab.sides[fi].length * 10) / 10, flank };
}

export interface RunLot {
  pin: string;
  addr: string | null;
  lot: string | null;
  owner_type: OwnerType;
  owner_type_words: string;
  city: boolean;
}

export interface AssemblyRun {
  pins: string[]; // along the street
  lots: RunLot[];
  type: TemplateId;
  width: number;
  formula: string;
  trust: 'ink' | 'pencil';
  trust_note: string | null;
  non_city: number;
  candidate_alone: string; // why the candidate doesn't fit alone
  still_to_check: string[];
}

export type PartnerSkip = 'built' | 'other_zone' | 'other_street' | 'multipolygon' | 'records_disagree' | 'no_geometry';

/** Is `q` a possible partner for a lot on `front` in `zone`? (Vacant, same zone, same block face, one polygon.) */
function partnerProblem(q: AsmParcel | undefined, zone: string, front: string | null, all: Map<string, AsmParcel>, streets: Street[], settings: Settings): PartnerSkip | null {
  if (!q || q.ring.length < 3) return 'no_geometry';
  if (q.built) return 'built';
  if (q.zone !== zone) return 'other_zone';
  if (q.multipolygon) return 'multipolygon';
  if (q.assessed && q.assessed > 0 && Math.abs(q.mapped / q.assessed - 1) > settings.recon_tolerance) return 'records_disagree';
  const f = facesOf(q, all, streets, front);
  if (!f || !sameStreet(f.front, front)) return 'other_street';
  return null;
}

/** The outer flank of an end lot: its flank side that doesn't touch another lot of the run. */
function outerFlank(p: AsmParcel, run: Set<string>, all: Map<string, AsmParcel>, streets: Street[], front: string | null): FlankKind | null {
  const f = facesOf(p, all, streets, front);
  if (!f) return null;
  const outer = f.flank.filter((s) => !s.pins.some((x) => run.has(x)));
  if (outer.length !== 1) return null;
  const s = outer[0];
  return s.kind === 'side_exterior' ? 'exterior' : s.built ? 'interior_built' : 'interior_vacant';
}

/** The combined lot, as the citywide classifier sees one lot. */
export function unionLot(base: CityLot, members: AsmParcel[], flank: FlankKind[], mappedFront: number | null = null): CityLot {
  // Deeds lead; without a deed for every member, the mapped frontage is used and the classifier marks it pencil.
  const deed = members.every((m) => m.deed) ? { front: members.reduce((s, m) => s + m.deed!.front, 0), depth: Math.min(...members.map((m) => m.deed!.depth)) } : null;
  return {
    ...base,
    status: 'Available for Sale', // ownership is reported per lot, not tested here
    deed,
    assessed: members.every((m) => m.assessed) ? members.reduce((s, m) => s + m.assessed!, 0) : null,
    mapped: members.reduce((s, m) => s + m.mapped, 0),
    front_len: deed ? deed.front : mappedFront,
    flank,
    edges_ok: true,
    edge_note: null,
  };
}

const DIMS = ['area', 'width', 'depth'] as const;
const dimBlocked = (c: CityClass) => c.all.some((b) => (DIMS as readonly string[]).includes(b));

/**
 * Runs of 2–3 contiguous lots on the candidate's block face that fit the dimensional rules as of right
 * when the candidate alone doesn't. A run that contains a smaller qualifying run is dropped.
 */
export function runsFor(
  candidate: CityLot,
  all: Map<string, AsmParcel>,
  streets: Street[],
  rs: RuleSet,
  type: TemplateId,
  settings: Settings,
  skips: Map<string, PartnerSkip> = new Map(), // partner pin → why it was ruled out (each lot counted once)
): AssemblyRun[] {
  const alone = classifyCityLot(candidate, rs, type, settings);
  if (!dimBlocked(alone)) return [];
  const C = all.get(candidate.pin);
  if (!C || !candidate.zone) return [];
  const front = streetOf(candidate.addr) ?? streetOf(C.addr);
  const fC = facesOf(C, all, streets, front);
  if (!fC) return [];
  const zone = candidate.zone;
  const ok = (pin: string): boolean => {
    const why = partnerProblem(all.get(pin), zone, fC.front, all, streets, settings);
    if (why) skips.set(pin, why);
    return !why;
  };
  // Partners across each interior flank side, and one more lot beyond each.
  const sides = fC.flank.filter((s) => s.kind === 'side_interior').map((s) => s.pins.filter((p) => p !== C.pin));
  const beside = sides.map((pins) => (pins.length === 1 && ok(pins[0]) ? pins[0] : null));
  const beyond = (a: string): string | null => {
    const A = all.get(a)!;
    const fA = facesOf(A, all, streets, fC.front);
    if (!fA) return null;
    const far = fA.flank.filter((s) => s.kind === 'side_interior' && !s.pins.includes(C.pin)).map((s) => s.pins.filter((p) => p !== a));
    return far.length === 1 && far[0].length === 1 && far[0][0] !== C.pin && ok(far[0][0]) ? far[0][0] : null;
  };
  const groups: string[][] = [];
  for (const a of beside) if (a) groups.push([C.pin, a]);
  if (beside[0] && beside[1]) groups.push([beside[0], C.pin, beside[1]]);
  for (const a of beside) {
    if (!a) continue;
    const b = beyond(a);
    if (b) groups.push([C.pin, a, b]);
  }

  const out: AssemblyRun[] = [];
  for (const g of groups.sort((x, y) => x.length - y.length)) {
    const set = new Set(g);
    if (out.some((r) => r.pins.every((p) => set.has(p)))) continue; // a smaller run already qualifies
    // Order along the street: the two ends are the lots with an outer flank.
    const members = g.map((p) => all.get(p)!);
    const outers = members.map((m) => ({ m, f: outerFlank(m, set, all, streets, fC.front) }));
    const ends = outers.filter((o) => o.f);
    if (ends.length !== 2) continue;
    const mid = members.filter((m) => !ends.some((e) => e.m.pin === m.pin));
    const ordered = [ends[0].m, ...mid, ends[1].m];
    const fronts = ordered.map((m) => (m.pin === C.pin ? fC.front_len : facesOf(m, all, streets, fC.front)?.front_len ?? 0));
    const u = unionLot(candidate, ordered, [ends[0].f!, ends[1].f!], Math.round(fronts.reduce((a, b) => a + b, 0) * 10) / 10);
    const c = classifyCityLot(u, rs, type, settings);
    if (dimBlocked(c) || c.blocker === 'records' || c.blocker === 'rules' || c.blocker === 'edges') continue;
    const lots: RunLot[] = ordered.map((m) => {
      const o = ownerType(m);
      return { pin: m.pin, addr: m.addr, lot: m.lot != null ? `${m.lot}${m.lot_suffix ?? ''}` : null, owner_type: o.type, owner_type_words: o.words, city: !!m.city };
    });
    out.push({
      pins: ordered.map((m) => m.pin),
      lots,
      type,
      width: c.width ?? 0,
      formula: c.formula ?? '',
      trust: c.trust === 'ink' ? 'ink' : 'pencil',
      trust_note: c.widthNote,
      non_city: lots.filter((l) => !l.city).length,
      candidate_alone: `${alone.all.filter((b) => (DIMS as readonly string[]).includes(b)).join(', ')}: ${alone.formula}`,
      still_to_check: ['use', 'parking', 'grading', 'a lot consolidation', "the owners' agreement"],
    });
  }
  return out;
}

/** The most lot groups that share no lot (the groups that overlap are alternatives): exact, by trying every subset of
 *  each cluster of overlapping groups. Refuses (null) rather than guess if a cluster is too big to try exhaustively. */
export function maxDisjoint(runs: { pins: string[] }[]): number | null {
  const n = runs.length;
  const adj = runs.map((a, i) => new Set(runs.map((b, j) => (i !== j && b.pins.some((p) => a.pins.includes(p)) ? j : -1)).filter((j) => j >= 0)));
  const seen = new Set<number>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    const comp: number[] = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const y of adj[x]) if (!seen.has(y)) (seen.add(y), stack.push(y));
    }
    if (comp.length > 20) return null;
    let best = 0;
    for (let mask = 1; mask < 1 << comp.length; mask++) {
      const pick = comp.filter((_, k) => mask & (1 << k));
      if (pick.length > best && pick.every((a, x) => pick.every((b, y) => x === y || !adj[a].has(b)))) best = pick.length;
    }
    total += best;
  }
  return total;
}
