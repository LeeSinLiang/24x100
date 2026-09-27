// Citywide first-blocker classification (spec §0.6). The same deed arithmetic as evaluate(), on a
// compact per-lot input whose edge labels were computed by labelEdges() at build time.
import { labelEdges, type Neighbor } from './edges';
import { BOTH_SIDES_Q } from './evaluate';
import { getQuestion, pick, ruleTrust } from './rules';
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

/** The contextual side setback (§925.06.C) as the classifier sees it. `flank` records, per side that
 *  meets the front, whether the lot across it is built (pipeline built_state: a building footprint
 *  or an assessment year built with a non-vacant use). The code lets a side next to a built lot fall
 *  anywhere between the district setback and the neighbor's actual setback, but not below its
 *  minimum; it never requires more than the district setback. Nobody has surveyed the neighbors'
 *  actual setbacks, so where that could change the answer, the width is pencil. */
export interface CityContext {
  neighbors: 'built' | 'vacant' | 'none'; // the interior sides beside the front meet a built lot / only vacant lots / no lot
  minimum: number | null; // the contextual minimum (ft) when that rule is loaded and checked
  best: number | null; // width if every built-neighbor side took the minimum
  formula: string | null; // "30 − 3 − 3 = 24"
  matters: boolean; // the width answer could change with a built neighbor's actual setback
  rule: string | null;
  section: string | null;
}

export interface CityClass {
  blocker: Blocker;
  all: Blocker[]; // every blocker that applies, in order (for H1 counts)
  width: number | null;
  depth: number | null;
  area: number | null;
  trust: Trust; // weakest of widthTrust and areaTrust
  widthTrust: Trust; // pencil without deed dimensions, or when a built neighbor could change the answer
  areaTrust: Trust; // pencil without deed dimensions, or when the records fall on both sides of the minimum
  formula: string | null;
  front: number | null; // frontage used (deed, else mapped)
  setbacks: number[]; // the side setbacks subtracted, in flank order
  context: CityContext | null;
  note: string;
  widthNote: string | null;
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

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Same shape as the lot engine's width formula, never a negative number: "24 − 15 − 15 leaves no buildable width". */
const formulaOf = (front: number, setbacks: number[], width: number) => {
  const terms = [front, ...setbacks].map(r1).join(' − ');
  return width > 0 ? `${terms} = ${r1(width)}` : `${terms} leaves no buildable width`;
};

export function classifyCityLot(lot: CityLot, rs: RuleSet | null, type: TemplateId, settings: Settings, proposal: Proposal = TEMPLATES[type].proposal): CityClass {
  const none = (blocker: Blocker, note: string, trust: Trust = 'ink'): CityClass => ({
    blocker,
    all: [blocker],
    width: null,
    depth: null,
    area: null,
    trust,
    widthTrust: trust,
    areaTrust: trust,
    formula: null,
    front: null,
    setbacks: [],
    context: null,
    note,
    widthNote: null,
  });
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
  const recordTrust: Trust = lot.deed ? 'ink' : 'pencil';
  let areaTrust: Trust = recordTrust;
  const min = R.minArea!.value as number;
  // Same rule as the lot engine: the deed leads; if the assessment falls on the other side of the
  // minimum, the lot needs a survey (pencil), and area stays a blocker.
  const corroborate = lot.deed ? lot.assessed : lot.mapped;
  const flip = corroborate != null && corroborate >= min !== area >= min;
  if (area < min || flip) all.push('area');
  if (flip) areaTrust = 'pencil';
  const widthFails = width < proposal.width;
  if (widthFails) all.push('width');
  if (depth != null && depth < proposal.depth) all.push('depth');
  if (lot.status !== 'Available for Sale') all.push('ownership');
  if (!all.length) all.push('fits');

  // Contextual side setback (§925.06.C), the same situation the lot engine marks pencil: a side
  // next to a built lot may take less than the district setback, down to the rule's minimum.
  const ctxRule = pick(rs, 'contextual_side');
  const builtSides = lot.flank.filter((k) => k === 'interior_built').length;
  const neighbors: CityContext['neighbors'] = builtSides ? 'built' : lot.flank.includes('interior_vacant') ? 'vacant' : 'none';
  let context: CityContext = { neighbors, minimum: null, best: null, formula: null, matters: false, rule: ctxRule?.id ?? null, section: ctxRule?.section ?? null };
  if (builtSides) {
    // The minimum bounds the best case only when the rule is loaded and checked; otherwise any
    // width failure next to a built lot is open (never a guess either way).
    const minimum = ctxRule && typeof ctxRule.value === 'number' && ruleTrust(ctxRule) === 'ink' ? ctxRule.value : null;
    if (minimum != null) {
      const relaxed = setbacks.map((v, i) => (lot.flank[i] === 'interior_built' ? Math.min(v, minimum) : v));
      const best = front - relaxed.reduce((a, b) => a + b, 0);
      context = { ...context, minimum, best: Math.max(0, r1(best)), formula: formulaOf(front, relaxed, best), matters: widthFails && best >= proposal.width };
    } else context = { ...context, matters: widthFails };
  }
  // §925.06.C.1, the same open question the lot engine raises: the narrow-lot table's 3 ft on both interior
  // sides applies only if the neighbours' setbacks are 3 ft or less. Open → the width is pencil.
  const bothQ = getQuestion(rs, BOTH_SIDES_Q);
  const bothOpen =
    !!nrow && nrow.interior === 3 && lot.flank.filter((k) => k !== 'exterior').length >= 2 && !!bothQ && bothQ.status !== 'city_confirmed';
  const widthTrust: Trust = context.matters || bothOpen ? 'pencil' : recordTrust;
  const widthNote = context.matters
    ? 'a built neighbor may allow a contextual side setback; it depends on that building’s actual setback'
    : bothOpen
      ? '3 ft on both sides only if the neighbours are set back 3 ft or less (§925.06.C.1): open question'
      : lot.deed
        ? null
        : 'no deed dimensions: mapped frontage (pencil)';
  return {
    blocker: all[0],
    all,
    width: Math.max(0, r1(width)),
    depth: depth != null ? Math.max(0, depth) : null,
    area: Math.round(area),
    trust: widthTrust === 'pencil' || areaTrust === 'pencil' ? 'pencil' : 'ink',
    widthTrust,
    areaTrust,
    formula: formulaOf(front, setbacks, width),
    front: r1(front),
    setbacks: setbacks.map(r1),
    context,
    note: flip ? 'records fall on both sides of the minimum lot size: needs a survey' : lot.deed ? 'deed dimensions' : 'no deed dimensions: mapped frontage (pencil)',
    widthNote,
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
  // widthNotArea = widthNotAreaInk + widthNotAreaContext + widthNotAreaMapped.
  /** Width blocks by deed, whatever the neighbors' setbacks (vacant neighbors, or too narrow even at
   *  the contextual minimum next to a built one): ink. */
  widthNotAreaInk: number;
  /** A built neighbor's actual setback could change the answer (§925.06.C): pencil. */
  widthNotAreaContext: number;
  /** No deed dimensions: frontage measured from the City map: pencil. */
  widthNotAreaMapped: number;
  districts: { zone: string; lots: number; computed: boolean }[];
}

export function summarize(lots: CityLot[], classes: CityClass[], type: TemplateId): CitySummary {
  const byBlocker = Object.fromEntries(BLOCKER_ORDER.map((b) => [b, 0])) as Record<Blocker, number>;
  let widthAny = 0,
    areaAny = 0,
    widthNotArea = 0,
    widthNotAreaContext = 0,
    widthNotAreaMapped = 0;
  const dz = new Map<string, { lots: number; computed: boolean }>();
  classes.forEach((c, i) => {
    byBlocker[c.blocker]++;
    if (c.all.includes('width')) widthAny++;
    if (c.all.includes('area')) areaAny++;
    if (c.all.includes('width') && !c.all.includes('area')) {
      widthNotArea++;
      if (c.context?.matters) widthNotAreaContext++;
      else if (c.widthTrust !== 'ink') widthNotAreaMapped++;
    }
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
    widthNotAreaInk: widthNotArea - widthNotAreaContext - widthNotAreaMapped,
    widthNotAreaContext,
    widthNotAreaMapped,
    districts: [...dz.entries()].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.lots - a.lots),
  };
}

export interface CityRoute {
  kind: 'contextual' | 'group' | 'variance' | 'exception' | 'survey' | 'sale' | 'rules';
  text: string;
  trust: Trust;
}

const ftw = (v: number) => `${r1(v)} ft`;
const sf = (v: number) => `${Math.round(v).toLocaleString('en-US')} sf`;
const ZBA = 'from the Zoning Board of Adjustment is a plausible route, not approval';

/** What would move the first blocker, in words, where the classifier knows. These are routes to look
 *  into, not findings: a variance is a plausible route, never an approval, and a wider lot group
 *  depends on a neighbor nobody here has asked. */
export function cityRoutes(lot: CityLot, c: CityClass, rs: RuleSet | null, type: TemplateId, proposal: Proposal = TEMPLATES[type].proposal): CityRoute[] {
  const tname = TEMPLATES[type].name.toLowerCase();
  const vacantNext = lot.flank.includes('interior_vacant');
  const out: CityRoute[] = [];
  if (c.blocker === 'width') {
    const req = proposal.width;
    const cx = c.context;
    if (cx?.matters)
      out.push({
        kind: 'contextual',
        trust: 'pencil',
        text:
          cx.best != null
            ? `A contextual side setback next to the built neighbor (§${cx.section}): at its ${cx.minimum} ft minimum, ${cx.formula} ft, room for a ${ftw(req)} ${tname}. It depends on that building’s actual setback, which no one has measured.${vacantNext ? ' With a vacant lot on the other side, whether it applies at all is a question for the Zoning Administrator.' : ''}`
            : 'A built neighbor may allow a contextual side setback (§925.06.C). That rule isn’t checked, so how much it allows is unknown.',
      });
    else if (cx?.neighbors === 'built' && cx.best != null)
      out.push({ kind: 'contextual', trust: c.widthTrust, text: `A contextual side setback next to the built neighbor can’t close the gap: even at its ${cx.minimum} ft minimum, ${cx.formula}${cx.best > 0 ? ' ft' : ''}, under ${ftw(req)}.` });
    if (vacantNext) out.push({ kind: 'group', trust: 'pencil', text: `A wider lot group: the lot next door is vacant, and the combined frontage may fit a ${ftw(req)} ${tname}. Whether it can be bought is not known here.` });
    if (c.front != null && c.setbacks.length) {
      const cur = c.setbacks;
      const avail = c.front - cur.reduce((a, b) => a + b, 0);
      if (c.front < req) out.push({ kind: 'variance', trust: c.widthTrust, text: `At ${ftw(c.front)} of frontage the lot is narrower than ${ftw(req)} even with no side setbacks, so a variance can’t make room; only a wider lot group can.` });
      else if (cur.length === 2 && cur[0] === cur[1]) out.push({ kind: 'variance', trust: c.widthTrust, text: `A side-setback variance (${cur[0]} → ${r1((c.front - req) / 2)} ft on each side) ${ZBA}.` });
      else {
        const total = cur.reduce((a, b) => a + b, 0);
        const to = cur.map((v) => Math.max(0, v - (total > 0 ? ((req - avail) * v) / total : 0)));
        out.push({ kind: 'variance', trust: c.widthTrust, text: `A side-setback variance (${cur.map(r1).join(' and ')} → ${to.map(r1).join(' and ')} ft) ${ZBA}.` });
      }
    }
  } else if (c.blocker === 'area' && rs) {
    const min = pick(rs, 'min_lot_area');
    const m = typeof min?.value === 'number' ? min.value : null;
    if (c.note.startsWith('records fall on both sides')) out.push({ kind: 'survey', trust: 'pencil', text: `A survey would settle it: the records fall on both sides of the ${m != null ? sf(m) : 'minimum lot size'} minimum.` });
    else if (m != null && c.area != null) {
      if (vacantNext) out.push({ kind: 'group', trust: 'pencil', text: `A larger lot group: the lot next door is vacant, and together they may pass the ${sf(m)} minimum (this lot is ${sf(m - c.area)} short). Whether it can be bought is not known here.` });
      const lor = TEMPLATES[type].single_unit ? pick(rs, 'lot_of_record') : undefined;
      if (lor) out.push({ kind: 'exception', trust: ruleTrust(lor), text: `For a single-unit house, a lot-of-record exception may apply instead (§${lor.section}).` });
      out.push({ kind: 'variance', trust: c.areaTrust, text: `A lot-area variance ${ZBA}.` });
    }
  } else if (c.blocker === 'depth' && c.depth != null) {
    out.push({ kind: 'variance', trust: c.trust, text: `The front and rear setbacks leave ${ftw(c.depth)} of depth for a ${ftw(proposal.depth)} deep ${tname}. A front- or rear-setback variance ${ZBA}.` });
  } else if (c.blocker === 'ownership') {
    out.push({ kind: 'sale', trust: 'ink', text: `The City lists it as “${lot.status}”. Ask City Real Estate whether it could be offered for sale.` });
  } else if (c.blocker === 'records') {
    out.push({ kind: 'survey', trust: 'ink', text: `A survey would settle the lot area: the County assessment says ${sf(lot.assessed ?? 0)}; the City map measures ${sf(lot.mapped)}.` });
  } else if (c.blocker === 'rules' && lot.zone) {
    out.push({ kind: 'rules', trust: 'pencil', text: `It takes color when a teammate checks the ${lot.zone} rules against the code text.` });
  }
  return out;
}
