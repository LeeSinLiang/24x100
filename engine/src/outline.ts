// An outline plan for a City lot without block detail (team review, round 3: "an inset for every lot").
// The static API carries each City lot's parcel polygon, its immediate neighbours and the nearby streets in
// local feet (scripts/build-api.ts, from the pipeline's citywide work file). This module labels the lot's
// edges with the same code the lot engine and the city build use (labelEdges), gives each side the lot's own
// setback from the rule set, as the citywide classifier does (classifyCityLot), and cuts the buildable area
// with the lot engine's envelope(). Then it turns the drawing so the front runs along the bottom, as on the
// plate. Nothing here is estimated: a side without a loaded rule gets no envelope, and a lot the classifier
// couldn't check (rules not loaded, records disagree, edges not computed) gets its outline only.
import type { CityClass, CityLot } from './city';
import { labelEdges, type Neighbor } from './edges';
import { centroid, envelope, extent, openRing, orientLeft, sub, unit } from './geom';
import { pick } from './rules';
import { TEMPLATES } from './templates';
import type { EdgeKind, NarrowRow, Pt, Ring, RuleSet, Street, TemplateId } from './types';

/** One City lot's outline as the static API writes it (api/lots/<pin>.json → outline). */
export interface LotOutline {
  frame?: string;
  origin: [number, number] | null; // lon, lat of the frame's (0, 0)
  addr_street: string | null;
  ring: Pt[]; // feet east (x) and north (y) of the origin
  neighbors: { pin: string; lot: number | null; addr: string; built: boolean; ring: Pt[] }[];
  streets: Street[];
}

export interface PlanSide {
  kind: EdgeKind;
  a: Pt;
  b: Pt;
  length: number; // ft, measured on the City map
  setback: number | null; // ft; null when the lot isn't checked or the rule isn't loaded
  street: string | null;
}

/** The lot, drawn: every point in drawing feet (x right, y down, the front along the bottom). */
export interface OutlinePlan {
  ok: boolean; // edges labelled (front, sides, rear told apart)
  note: string | null;
  ring: Ring;
  neighbors: { pin: string; lot: number | null; addr: string; built: boolean; ring: Ring }[];
  streets: { name: string; line: Pt[] }[];
  sides: PlanSide[];
  front: { a: Pt; b: Pt; street: string | null } | null;
  /** The buildable area after the setbacks (the lot engine's envelope); null when not computed or empty. */
  envelope: Ring | null;
  /** Why there is no envelope, in words, when there is none. */
  envelopeNote: string | null;
  /** Mapped frontage and depth (ft, one decimal), measured along and across the front. */
  mapped: { front: number; depth: number } | null;
  /** Degrees to turn an up-pointing north arrow so it points north on the drawing. */
  north: number;
}

/** The narrow-lot side-yard row for a lot this wide (the same lookup as classifyCityLot and evaluate). */
function narrowRow(v: unknown, width: number): NarrowRow | null {
  if (!Array.isArray(v) || width >= 60) return null;
  const w = Math.floor(width);
  return [...(v as NarrowRow[])].sort((a, b) => a.max_width - b.max_width).find((r) => r.max_width >= w) ?? null;
}

/** The setback on each labelled side, from the rule set, as the citywide classifier applies them: front and rear
 *  setbacks; interior and street sides from the district, or the narrow-lot table for a single-unit house on a
 *  lot under 60 ft (by deed, else the mapped frontage). null where the rule isn't a number. */
export function sideSetbacks(kinds: EdgeKind[], rs: RuleSet, type: TemplateId, frontage: number): (number | null)[] {
  const num = (f: Parameters<typeof pick>[1]) => {
    const r = pick(rs, f);
    return r && typeof r.value === 'number' ? r.value : null;
  };
  const nrow = TEMPLATES[type].single_unit ? narrowRow(pick(rs, 'narrow_lot_side_table')?.value, frontage) : null;
  return kinds.map((k) =>
    k === 'front' ? num('front_setback') : k === 'rear' ? num('rear_setback') : k === 'side_exterior' ? (nrow ? nrow.streetside : num('side_setback_exterior')) : nrow ? nrow.interior : num('side_setback_interior'),
  );
}

const GREY = new Set(['rules', 'records', 'edges']);

/** Label, cut and turn one City lot's outline for drawing. `cls` is the classifier's answer for the chosen
 *  building type: the envelope is cut only where it computed one (not rules / records / edges). */
export function outlinePlan(o: LotOutline, lot: Pick<CityLot, 'deed'>, cls: Pick<CityClass, 'blocker'> | null, rs: RuleSet | null, type: TemplateId): OutlinePlan {
  const ring = orientLeft(openRing(o.ring));
  const nbs: Neighbor[] = o.neighbors.map((n) => ({ pin: n.pin, ring: openRing(n.ring), built: n.built, addr: n.addr, lot: n.lot }));
  const lab = labelEdges(ring, nbs, o.streets, o.addr_street);

  // The turn: the front's inward normal points up on the drawing (and north goes where it goes).
  let theta = 0;
  let front: OutlinePlan['front'] = null;
  if (lab.ok) {
    const f = lab.sides.find((s) => s.kind === 'front')!;
    const d = unit(sub(f.b, f.a));
    const n: Pt = [-d[1], d[0]]; // left of the front, into the lot (the ring is oriented left)
    theta = Math.PI / 2 - Math.atan2(n[1], n[0]);
  } else {
    // No front: keep north up.
    theta = 0;
  }
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const turn = (p: Pt): Pt => [Math.round((p[0] * c - p[1] * s) * 100) / 100, -Math.round((p[0] * s + p[1] * c) * 100) / 100];
  const turnRing = (r: Ring): Ring => r.map(turn);
  const northUp: Pt = [-s, c]; // R · (0, 1), in y-up
  const north = (Math.atan2(northUp[0], northUp[1]) * 180) / Math.PI;

  const sides: PlanSide[] = lab.ok ? lab.sides.map((sd) => ({ kind: sd.kind, a: turn(sd.a), b: turn(sd.b), length: Math.round(sd.length * 10) / 10, setback: null, street: sd.street })) : [];
  if (lab.ok) {
    const f = lab.sides.find((x) => x.kind === 'front')!;
    front = { a: turn(f.a), b: turn(f.b), street: f.street };
  }

  let env: Ring | null = null;
  let envelopeNote: string | null = null;
  let mapped: OutlinePlan['mapped'] = null;
  if (lab.ok) {
    const f = lab.sides.find((x) => x.kind === 'front')!;
    const d = unit(sub(f.b, f.a));
    mapped = { front: Math.round(f.length * 10) / 10, depth: Math.round(extent(lab.ring, [-d[1], d[0]]) * 10) / 10 };
  }
  if (!lab.ok) envelopeNote = lab.note ?? 'Edges not computed: the front can’t be told from the sides.';
  else if (!rs || !cls || GREY.has(cls.blocker)) envelopeNote = cls?.blocker === 'records' ? 'Records disagree: not checked, so no buildable area is drawn.' : 'Rules not loaded and checked for this district: no buildable area is drawn.';
  else {
    const frontage = lot.deed?.front ?? lab.sides.find((x) => x.kind === 'front')!.length;
    const sb = sideSetbacks(
      lab.sides.map((x) => x.kind),
      rs,
      type,
      frontage,
    );
    sides.forEach((x, i) => (x.setback = sb[i]));
    if (sb.some((v) => v == null)) envelopeNote = 'A setback rule for one side isn’t loaded: no buildable area is drawn.';
    else {
      const per: number[] = new Array(lab.ring.length).fill(0);
      lab.sides.forEach((x, i) => {
        for (const e of x.edge_idx) per[e] = sb[i]!;
      });
      const e = envelope(lab.ring, per).poly;
      if (e.length >= 3) env = turnRing(e);
      else envelopeNote = 'The setbacks leave no buildable area on the City map outline.';
    }
  }

  return {
    ok: lab.ok,
    note: lab.note,
    ring: turnRing(lab.ok ? lab.ring : ring),
    neighbors: nbs.map((n) => ({ pin: n.pin, lot: n.lot, addr: n.addr, built: n.built, ring: turnRing(n.ring) })),
    streets: o.streets.map((st) => ({ name: st.name, line: st.line.map(turn) })),
    sides,
    front,
    envelope: env,
    envelopeNote,
    mapped,
    north,
  };
}

/** The centre of a ring (for labels), in its own coordinates. */
export function ringCentre(r: Ring): Pt {
  return r.length >= 3 ? centroid(r) : r[0] ?? [0, 0];
}
