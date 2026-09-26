// The evaluator. One call → one LotResult; every number the app shows for a scenario comes from it.
// Four kinds of thing stay separate (spec §0.5.3): geometry (the envelope allowed as of right), the
// proposal (red), regulation (does the proposal fit; what specific relief if not) and procedure
// (the approvals that relief implies).
import { labelEdges, type Neighbor } from './edges';
import { MINUS, ft1, ftInt, int, minusFormula, pct } from './format';
import { area, centroid, dropCollinear, envelope, extent, openRing, sub, unionRings, unit } from './geom';
import { getQuestion, pick, ruleTrust, weakest } from './rules';
import { APPROVAL_LABEL, TEMPLATES } from './templates';
import type {
  Approval,
  ApprovalKind,
  BlockFile,
  Check,
  EffectiveRule,
  LotResult,
  Measure,
  NarrowRow,
  OpenQuestion,
  Parcel,
  Pt,
  Relief,
  Ring,
  RuleSet,
  Scenario,
  Settings,
  Side,
  Trust,
  Unit,
} from './types';

export const NARROW_Q = 'q.single_unit_includes_attached';

export const NOT_ASSESSED = [
  'Water and sewer capacity (no public parcel-level data)',
  'Soils and old fill',
  'Title, liens and back taxes',
  'Community priorities: 24×100 does not score them; take the scenario to the RCO',
];

export interface EvalContext {
  block: BlockFile;
  rs: RuleSet;
  settings: Settings;
}

export function recordId(pin: string, field: string): string {
  return `record:${pin}:${field}`;
}

export function scenarioKey(s: Scenario): string {
  const p = s.proposal;
  return [s.type, s.pins.join('+'), p.width, p.depth, p.stories, p.height, s.pending_parking_repeal ? 'repeal' : ''].join('|');
}

export function parcelByPin(block: BlockFile, pin: string): Parcel | undefined {
  return block.parcels.find((p) => p.pin === pin);
}

function repPoint(p: Parcel): Pt {
  return p.rep_point ?? centroid(openRing(p.poly[0]));
}

/** Order pins along the main street (x in the local frame). */
export function orderAlongStreet(block: BlockFile, pins: string[]): string[] {
  return [...pins].sort((a, b) => repPoint(parcelByPin(block, a)!)[0] - repPoint(parcelByPin(block, b)!)[0]);
}

function bboxOf(r: Ring): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of r) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function neighborsOf(block: BlockFile, ring: Ring, exclude: Set<string>): Neighbor[] {
  const [x0, y0, x1, y1] = bboxOf(ring);
  const m = 5;
  return block.parcels
    .filter((p) => !exclude.has(p.pin))
    .filter((p) => {
      const [a, b, c, d] = bboxOf(p.poly[0]);
      return a <= x1 + m && c >= x0 - m && b <= y1 + m && d >= y0 - m;
    })
    .map((p) => ({ pin: p.pin, ring: openRing(p.poly[0]), built: p.built, addr: p.addr, lot: p.lot }));
}

function num(r: EffectiveRule | undefined): number | null {
  return r && typeof r.value === 'number' ? r.value : null;
}

function narrowRow(r: EffectiveRule | undefined, width: number): NarrowRow | null {
  if (!r || !Array.isArray(r.value)) return null;
  if (width >= 60) return null;
  const w = Math.floor(width);
  const rows = [...(r.value as NarrowRow[])].sort((a, b) => a.max_width - b.max_width);
  return rows.find((row) => row.max_width >= w) ?? null;
}

function fmtFt(n: number): string {
  return Number.isInteger(Math.round(n * 10) / 10) ? ftInt(n) : ft1(n);
}

function reconState(p: Parcel, tol: number): 'ok' | 'records_disagree' | 'no_assessment' {
  const assessed = p.recon.assessed ?? p.assess?.lotarea ?? null;
  if (assessed == null || assessed <= 0) return 'no_assessment';
  const ratio = p.mapped_area / assessed;
  return Math.abs(ratio - 1) > tol ? 'records_disagree' : 'ok';
}

type SideOut = Side;

interface Built {
  ring: Ring;
  sides: SideOut[];
  env: { poly: Ring; area: number; method: LotResult['envelope']['method'] };
  width: Measure;
  depth: Measure;
  frontDir: Pt;
}

// ─────────────────────────────────────────────────────────────────────────────

export function evaluate(ctx: EvalContext, scenario: Scenario): LotResult {
  const { block, rs, settings } = ctx;
  const tpl = TEMPLATES[scenario.type];
  const pins = orderAlongStreet(block, scenario.pins);
  const parcels = pins.map((pin) => parcelByPin(block, pin));
  const base: LotResult = {
    key: scenarioKey(scenario),
    block_id: block.meta.id,
    scenario,
    pins,
    district: parcels[0]?.zone ?? null,
    state: 'ok',
    refusal: null,
    sides: [],
    lot_poly: parcels[0] ? openRing(parcels[0].poly[0]) : [],
    envelope: { poly: [], area: 0, method: 'none' },
    width: null,
    depth: null,
    units: [],
    checks: [],
    relief: [],
    approvals: { ink: [], pencil: [] },
    score: null,
    questions: [],
    not_assessed: NOT_ASSESSED,
    trust: 'ink',
    notes: [],
  };
  const refuse = (code: NonNullable<LotResult['refusal']>['code'], reason: string, values?: Record<string, number | string>): LotResult => ({
    ...base,
    state: 'refused',
    refusal: { code, reason, values },
    trust: 'ink',
  });

  if (parcels.some((p) => !p)) return refuse('missing_input', 'A lot in this scenario is not in the block file.');
  const ps = parcels as Parcel[];
  const zones = [...new Set(ps.map((p) => p.zone))];
  if (zones.length > 1) return refuse('missing_input', `These lots are in different districts (${zones.join(', ')}).`);
  if (!ps[0].zone) return refuse('missing_input', 'No zoning district is recorded for this lot.');
  if (ps[0].zone !== rs.district) return refuse('missing_rule', `Rules not loaded for ${ps[0].zone}.`);

  // Records disagree → refuse (spec §5.3). Tolerance is the user's setting (red).
  for (const p of ps) {
    const st = reconState(p, settings.recon_tolerance);
    if (st === 'records_disagree') {
      const assessed = p.recon.assessed ?? p.assess?.lotarea ?? 0;
      const ratio = p.mapped_area / assessed;
      return refuse(
        'records_disagree',
        `Records disagree. County assessment says ${int(assessed)} sf; the City map measures ${int(p.mapped_area)} sf (${ratio.toFixed(2)}×). Tolerance is ±${pct(settings.recon_tolerance)} (your setting).`,
        { pin: p.pin, addr: p.addr, assessed, mapped: Math.round(p.mapped_area), ratio: Math.round(ratio * 100) / 100 },
      );
    }
    if (st === 'no_assessment' && !p.deed)
      return refuse('missing_input', `No assessed lot area and no deed dimensions for ${p.addr}.`, { pin: p.pin });
  }

  const need: [string, EffectiveRule | undefined][] = [
    ['min_lot_area', pick(rs, 'min_lot_area')],
    ['front_setback', pick(rs, 'front_setback')],
    ['rear_setback', pick(rs, 'rear_setback')],
    ['side_setback_interior', pick(rs, 'side_setback_interior')],
  ];
  const missing = need.filter(([, r]) => num(r) == null).map(([f]) => f);
  if (missing.length) return refuse('missing_rule', `Rules not loaded for ${rs.district}: ${missing.join(', ').replaceAll('_', ' ')}.`);

  const R = {
    minArea: pick(rs, 'min_lot_area')!,
    front: pick(rs, 'front_setback')!,
    rear: pick(rs, 'rear_setback')!,
    sideInt: pick(rs, 'side_setback_interior')!,
    sideExt: pick(rs, 'side_setback_exterior'),
    party: pick(rs, 'party_wall_side'),
    ctxSide: pick(rs, 'contextual_side'),
    ctxRear: pick(rs, 'contextual_rear'),
    narrow: pick(rs, 'narrow_lot_side_table'),
    height: pick(rs, 'max_height_ft'),
    stories: pick(rs, 'max_stories'),
    use: pick(rs, `use_${scenario.type}` as never),
    parking: pick(rs, `parking_${scenario.type}` as never),
    grading: pick(rs, 'grading_review'),
    lotOfRecord: pick(rs, 'lot_of_record'),
  };
  const narrowQ = getQuestion(rs, NARROW_Q);
  const notes: string[] = [];
  const questions: OpenQuestion[] = [];

  // ── Geometry ──────────────────────────────────────────────────────────────
  const groupSet = new Set(pins);
  const deedFront = ps.every((p) => p.deed) ? ps.reduce((s, p) => s + p.deed!.front, 0) : null;

  const build = (ringIn: Ring, lotPs: Parcel[], role: 'single' | 'union' | 'row_unit', rowIndex = 0): Built | { error: string } => {
    const exclude = role === 'union' ? groupSet : new Set(lotPs.map((p) => p.pin));
    const nbs = neighborsOf(block, ringIn, exclude);
    const addrStreet = lotPs.map((p) => p.addr_street).find(Boolean) ?? block.meta.main_street;
    const lab = labelEdges(ringIn, nbs, block.streets, addrStreet);
    if (!lab.ok) return { error: lab.note ?? 'Edges not computed.' };
    if (lab.note) notes.push(lab.note);
    const lotWidthForNarrow = role === 'union' ? deedFront ?? 0 : lotPs[0].deed?.front ?? lab.sides.find((s) => s.kind === 'front')!.length;
    const sides: SideOut[] = lab.sides.map((s) => {
      let kind = s.kind;
      let setback: number | null = null;
      let ids: string[] = [];
      let trust: Trust = 'ink';
      let note: string | null = null;
      const useRule = (r: EffectiveRule | undefined, v?: number | null) => {
        setback = v ?? num(r);
        ids = r ? [r.id] : [];
        trust = ruleTrust(r);
      };
      if (kind === 'front') useRule(R.front);
      else if (kind === 'rear') {
        useRule(R.rear);
        if (s.through_lot) note = `The rear faces ${s.street ?? 'a street'}; the code may treat a through lot differently (pencil).`;
      } else if (kind === 'side_interior') {
        const party = role === 'row_unit' && s.neighbors.some((n) => groupSet.has(n.pin));
        if (party) {
          kind = 'party_wall';
          useRule(R.party, num(R.party) ?? 0);
          if (!R.party) trust = 'pencil';
          note = 'Party wall inside the rowhouse run: zero setback on the party-wall side (§903.03.C.2(c)).';
        } else if (tpl.single_unit && narrowRow(R.narrow, lotWidthForNarrow)) {
          const row = narrowRow(R.narrow, lotWidthForNarrow)!;
          useRule(R.narrow, row.interior);
          note = `Narrow-lot side yard for a single-unit house on a lot under 60 ft (§925.06): ${row.interior} ft.`;
        } else if (role === 'row_unit' && narrowRow(R.narrow, lotWidthForNarrow)) {
          const row = narrowRow(R.narrow, lotWidthForNarrow)!;
          const st = narrowQ?.status ?? 'open';
          const yes = narrowQ?.choice === 'yes';
          if (st === 'city_confirmed' && yes) {
            useRule(R.narrow, row.interior);
            note = `City-confirmed: the narrow-lot table covers attached houses → ${row.interior} ft.`;
          } else if (st === 'assumed' && yes) {
            useRule(R.narrow, row.interior);
            trust = 'red';
            note = `Your assumption: the narrow-lot table covers attached houses → ${row.interior} ft. Not confirmed by the City.`;
          } else {
            useRule(R.sideInt);
            if (!(st === 'city_confirmed' && narrowQ?.choice === 'no'))
              note = `District side setback ${num(R.sideInt)} ft; ${row.interior} ft if the narrow-lot table covers attached houses (open question).`;
          }
        } else useRule(R.sideInt);
        // Contextual side setback (§925.06): only when the lot across is built; pencil (unsurveyed).
        if (kind === 'side_interior' && R.ctxSide) {
          const built = s.neighbors.filter((n) => n.built && !groupSet.has(n.pin));
          const vacant = s.neighbors.filter((n) => !n.built && !groupSet.has(n.pin));
          if (built.length) {
            note = [note, `Contextual setback may apply: ${built.map((n) => n.addr).join(', ')} is built, but its actual setback hasn't been surveyed (§925.06, pencil).`]
              .filter(Boolean)
              .join(' ');
          } else if (vacant.length) {
            note = [note, `${vacant.map((n) => (n.lot != null ? `Lot ${n.lot}` : n.addr)).join(', ')} vacant: the district setback applies (§925.06).`]
              .filter(Boolean)
              .join(' ');
          }
        }
      } else if (kind === 'side_exterior') {
        if (tpl.single_unit && narrowRow(R.narrow, lotWidthForNarrow)) {
          const row = narrowRow(R.narrow, lotWidthForNarrow)!;
          useRule(R.narrow, row.streetside);
        } else useRule(R.sideExt);
        if (setback == null) note = 'Exterior side setback rule not loaded.';
      }
      return { ...s, kind, setback, setback_rule_ids: ids, setback_trust: trust, setback_note: note };
    });
    if (sides.some((s) => s.setback == null)) return { error: `Rules not loaded for ${rs.district}: exterior side setback.` };

    const per: number[] = new Array(lab.ring.length).fill(0);
    for (const s of sides) for (const i of s.edge_idx) per[i] = s.setback ?? 0;
    const env = envelope(lab.ring, per);
    const fi = sides.findIndex((s) => s.kind === 'front');
    const front = sides[fi];
    const frontDir = unit(sub(front.b, front.a));
    const inward: Pt = [-frontDir[1], frontDir[0]];
    const n = sides.length;
    const prev = sides[(fi - 1 + n) % n];
    const next = sides[(fi + 1) % n];
    // Flanking sides, largest setback first so formulas read "24 − 10 − 0 = 14".
    const flank = [prev, next].filter((s) => s.kind !== 'rear' && s.kind !== 'front').sort((x, y) => (y.setback ?? 0) - (x.setback ?? 0));
    const rear = sides.find((s) => s.kind === 'rear');

    // Deed arithmetic (primary for rule checks). Mapped values are secondary.
    const lotDeedFront = role === 'union' ? deedFront : lotPs[0].deed?.front ?? null;
    const lotDeedDepth = lotPs.every((p) => p.deed) ? Math.min(...lotPs.map((p) => p.deed!.depth)) : null;
    const frontLen = front.length;
    const mappedW = env.poly.length >= 3 ? extent(env.poly, frontDir) : 0;
    const mappedD = env.poly.length >= 3 ? extent(env.poly, inward) : 0;

    const wTerms = [
      { value: lotDeedFront ?? Math.round(frontLen * 10) / 10, label: lotDeedFront != null ? (role === 'union' ? 'combined frontage (deeds)' : 'frontage (deed)') : 'frontage (City map)' },
      ...flank.map((s) => ({
        value: s.setback ?? 0,
        label: s.kind === 'party_wall' ? 'party wall' : s.kind === 'side_exterior' ? `street side (${s.street ?? 'street'})` : `side setback${s.neighbors[0]?.lot != null ? ` (lot ${s.neighbors[0].lot} side)` : ''}`,
      })),
    ];
    const wRaw = wTerms[0].value - wTerms.slice(1).reduce((a, t) => a + t.value, 0);
    const wTrust = weakest(lotDeedFront != null ? 'ink' : 'pencil', ...flank.map((s) => s.setback_trust));
    const width: Measure = {
      deed: lotDeedFront != null ? Math.max(0, wRaw) : null,
      mapped: Math.max(0, Math.round(mappedW * 10) / 10),
      none: wRaw <= 0 || env.poly.length < 3,
      formula: wRaw > 0 ? minusFormula(wTerms.map((t) => t.value), wRaw, fmtFt) : noneFormula(wTerms.map((t) => t.value), 'width'),
      terms: wTerms,
      trust: wTrust,
      rule_ids: flank.flatMap((s) => s.setback_rule_ids),
      record_ids: lotPs.map((p) => recordId(p.pin, lotDeedFront != null ? 'deed' : 'poly')),
    };
    const dTerms = [
      { value: lotDeedDepth ?? Math.round(extent(lab.ring, inward) * 10) / 10, label: lotDeedDepth != null ? 'depth (deed)' : 'depth (City map)' },
      { value: front.setback ?? 0, label: 'front setback' },
      { value: rear?.setback ?? 0, label: 'rear setback' },
    ];
    const dRaw = dTerms[0].value - dTerms[1].value - dTerms[2].value;
    const depth: Measure = {
      deed: lotDeedDepth != null ? Math.max(0, dRaw) : null,
      mapped: Math.max(0, Math.round(mappedD * 10) / 10),
      none: dRaw <= 0 || env.poly.length < 3,
      formula: dRaw > 0 ? minusFormula(dTerms.map((t) => t.value), dRaw, fmtFt) : noneFormula(dTerms.map((t) => t.value), 'depth'),
      terms: dTerms,
      trust: weakest(lotDeedDepth != null ? 'ink' : 'pencil', front.setback_trust, rear?.setback_trust ?? 'ink'),
      rule_ids: [...front.setback_rule_ids, ...(rear?.setback_rule_ids ?? [])],
      record_ids: lotPs.map((p) => recordId(p.pin, lotDeedDepth != null ? 'deed' : 'poly')),
    };
    void rowIndex;
    return { ring: lab.ring, sides, env: { poly: env.poly, area: area(env.poly), method: env.method }, width, depth, frontDir };
  };

  let lotRing: Ring;
  let main: Built;
  const units: Unit[] = [];
  const unitBuilds: Built[] = [];
  if (scenario.type === 'row') {
    for (let i = 0; i < ps.length; i++) {
      const b = build(openRing(ps[i].poly[0]), [ps[i]], 'row_unit', i);
      if ('error' in b) return refuse('edges_unclear', b.error);
      unitBuilds.push(b);
      const end = b.sides.some((s) => s.kind === 'side_interior' || s.kind === 'side_exterior');
      units.push({ pin: ps[i].pin, width: b.width, end, trust: b.width.trust, envelope: b.env.poly, front: frontOf(b) });
    }
    // The binding unit is the narrowest.
    let k = 0;
    unitBuilds.forEach((b, i) => {
      if ((b.width.deed ?? b.width.mapped) < (unitBuilds[k].width.deed ?? unitBuilds[k].width.mapped)) k = i;
    });
    main = unitBuilds[k];
    lotRing = ps.length > 1 ? dropCollinear(unionRings(ps.map((p) => p.poly[0]))) : openRing(ps[0].poly[0]);
  } else {
    const union = ps.length > 1;
    lotRing = union ? dropCollinear(unionRings(ps.map((p) => p.poly[0]))) : openRing(ps[0].poly[0]);
    const b = build(lotRing, ps, union ? 'union' : 'single');
    if ('error' in b) return refuse('edges_unclear', b.error);
    main = b;
    lotRing = b.ring;
    units.push({ pin: ps[0].pin, width: b.width, end: true, trust: b.width.trust, envelope: b.env.poly, front: frontOf(b) });
  }

  const envPoly = scenario.type === 'row' ? unionEnvelopes(unitBuilds) : main.env.poly;
  const envArea = scenario.type === 'row' ? unitBuilds.reduce((s, b) => s + b.env.area, 0) : main.env.area;
  const lotArea = ps.reduce((s, p) => s + p.mapped_area, 0);
  if (envArea > lotArea + 1) return refuse('sanity', 'Envelope area exceeds lot area; the geometry is not usable.', { envArea: Math.round(envArea), lotArea: Math.round(lotArea) });

  // ── Checks ────────────────────────────────────────────────────────────────
  const P = scenario.proposal;
  const checks: Check[] = [];
  const relief: Relief[] = [];
  const W = main.width;
  const D = main.depth;

  // Width.
  {
    const avail = W.deed ?? W.mapped;
    const req = P.width;
    const ok = !W.none && avail >= req;
    const rowOpen = scenario.type === 'row' && units.some((u) => u.end) && narrowQ && narrowQ.status !== 'city_confirmed' && !!narrowRow(R.narrow, ps[0].deed?.front ?? 24);
    let status: Check['status'] = ok ? 'pass' : 'fail';
    let trust: Trust = W.trust;
    let text: string;
    let alternative: Check['alternative'] = null;
    const approvals: Check['approvals'] = [];
    const flank = main.sides.filter((s) => s.kind === 'side_interior' || s.kind === 'side_exterior');
    if (scenario.type === 'row') {
      const endW = W.deed ?? W.mapped;
      if (rowOpen && narrowQ!.status === 'open') {
        const alt = altEndWidth(ps, R.narrow);
        alternative = { available: alt.value, formula: alt.formula, question_id: NARROW_Q, choice: 'yes', trust: 'pencil' };
        status = 'open';
        trust = 'pencil';
        text = `End units get ${fmtFt(endW)} ft, or ${fmtFt(alt.value)} ft if the narrow-lot table covers attached houses. Your units are ${fmtFt(req)} ft.`;
        if (!ok) approvals.push({ kind: 'variance', trust: 'pencil', why: `end units ${fmtFt(endW)} ft under the district reading` });
      } else if (rowOpen && narrowQ!.status === 'assumed') {
        const altNo = altEndWidthNo(ps, R.sideInt);
        alternative = { available: altNo.value, formula: altNo.formula, question_id: NARROW_Q, choice: narrowQ!.choice === 'yes' ? 'no' : 'yes', trust: 'pencil' };
        text = `End units get ${fmtFt(endW)} ft under your assumption (${fmtFt(altNo.value)} ft if the City reads it the other way). Your units are ${fmtFt(req)} ft.`;
        trust = 'red';
        if (!ok || altNo.value < req) approvals.push({ kind: 'variance', trust: 'pencil', why: `end units ${fmtFt(altNo.value)} ft if the City reads it the other way` });
      } else {
        text = ok ? `Every unit gets at least ${fmtFt(endW)} ft; your units are ${fmtFt(req)} ft.` : `End units get ${fmtFt(endW)} ft; your units are ${fmtFt(req)} ft.`;
        if (!ok) approvals.push({ kind: 'variance', trust: W.trust === 'ink' ? 'ink' : 'pencil', why: 'end-unit width' });
      }
      if (!ok) {
        const s = flank[0];
        if (s?.setback != null) {
          const lotFront = W.terms[0].value;
          const to = Math.max(0, lotFront - req);
          relief.push({ check: 'width', text: `end-unit side setback ${fmtFt(s.setback)} → ${fmtFt(to)} ft`, from: s.setback, to, section: sectionOf(rs, s.setback_rule_ids), approval: 'variance' });
        }
      }
    } else if (ok) {
      text = `As of right, the widest ${tpl.name.toLowerCase()} here is ${fmtFt(avail)} ft; your ${fmtFt(req)} ft proposal fits.`;
    } else {
      text = W.none
        ? `No buildable width: ${W.formula}. Your ${fmtFt(req)} ft proposal can't fit as of right.`
        : `As of right, the widest ${tpl.name.toLowerCase()} here is ${fmtFt(avail)} ft. Your ${fmtFt(req)} ft proposal doesn't fit.`;
      approvals.push({ kind: 'variance', trust: W.trust === 'ink' ? 'ink' : 'pencil', why: 'width' });
      const front = W.terms[0].value;
      const cur = flank.map((s) => s.setback ?? 0);
      if (flank.length === 2 && cur[0] === cur[1]) {
        const to = (front - req) / 2;
        if (to >= 0)
          relief.push({ check: 'width', text: `side setbacks ${fmtFt(cur[0])} → ${fmtFt(to)} ft on each side`, from: cur[0], to, section: sectionOf(rs, W.rule_ids), approval: 'variance' });
        else relief.push({ check: 'width', text: `the lot is narrower than ${fmtFt(req)} ft even with no side setbacks`, from: cur[0], to: 0, section: sectionOf(rs, W.rule_ids), approval: 'variance' });
      } else if (flank.length) {
        const cut = req - avail;
        const total = cur.reduce((a, b) => a + b, 0);
        const to = cur.map((c) => Math.max(0, c - (total > 0 ? (cut * c) / total : 0)));
        relief.push({ check: 'width', text: `side setbacks ${cur.map(fmtFt).join(' and ')} → ${to.map(fmtFt).join(' and ')} ft`, from: total, to: to.reduce((a, b) => a + b, 0), section: sectionOf(rs, W.rule_ids), approval: 'variance' });
      }
    }
    checks.push({ id: 'width', label: 'Width', required: req, available: W.none ? 0 : avail, shortfall: ok ? 0 : Math.max(0, req - (W.none ? 0 : avail)), unit: 'ft', status, trust, text, rule_ids: W.rule_ids, record_ids: W.record_ids, approvals, alternative });
  }

  // Depth.
  {
    const avail = D.deed ?? D.mapped;
    const req = P.depth;
    const ok = !D.none && avail >= req;
    const approvals: Check['approvals'] = [];
    let text = ok ? `${fmtFt(avail)} ft of depth after the front and rear setbacks (${D.formula}); your proposal is ${fmtFt(req)} ft deep.` : `Only ${fmtFt(Math.max(0, avail))} ft of depth after the front and rear setbacks (${D.formula}); your proposal is ${fmtFt(req)} ft deep.`;
    if (D.none) text = `No buildable depth: ${D.formula}.`;
    if (!ok) {
      approvals.push({ kind: 'variance', trust: D.trust === 'ink' ? 'ink' : 'pencil', why: 'depth' });
      const f = D.terms[1].value;
      const r = D.terms[2].value;
      const to = Math.max(0, (D.terms[0].value - req) / 2);
      relief.push(
        f === r
          ? { check: 'depth', text: `front and rear setbacks ${fmtFt(f)} → ${fmtFt(to)} ft each`, from: f, to, section: sectionOf(rs, D.rule_ids), approval: 'variance' }
          : { check: 'depth', text: `front and rear setbacks ${fmtFt(f)} + ${fmtFt(r)} → ${fmtFt(to * 2)} ft in total`, from: f + r, to: to * 2, section: sectionOf(rs, D.rule_ids), approval: 'variance' },
      );
    }
    checks.push({ id: 'depth', label: 'Depth', required: req, available: D.none ? 0 : avail, shortfall: ok ? 0 : req - Math.max(0, avail), unit: 'ft', status: ok ? 'pass' : 'fail', trust: D.trust, text, rule_ids: D.rule_ids, record_ids: D.record_ids, approvals });
  }

  // Lot area. Deed is primary; the assessment corroborates; the mapped area is a note.
  {
    const min = num(R.minArea)!;
    const lots = scenario.type === 'row' ? ps.map((p) => [p]) : [ps];
    let status: Check['status'] = 'pass';
    let trust: Trust = ruleTrust(R.minArea);
    const parts: string[] = [];
    let primaryTotal = 0;
    for (const grp of lots) {
      const deedA = grp.every((p) => p.deed) ? grp.reduce((s, p) => s + p.deed!.front * p.deed!.depth, 0) : null;
      const assessed = grp.every((p) => p.assess?.lotarea != null) ? grp.reduce((s, p) => s + (p.assess!.lotarea as number), 0) : null;
      const mapped = grp.reduce((s, p) => s + p.mapped_area, 0);
      const primary = deedA ?? assessed ?? mapped;
      primaryTotal += primary;
      const pass = primary >= min;
      const corroborate = deedA != null ? assessed : mapped;
      const flip = corroborate != null && corroborate >= min !== pass;
      if (!pass && status !== 'needs_survey') status = 'fail';
      if (flip) {
        status = 'needs_survey';
        trust = 'pencil';
      }
      const who = grp.length > 1 ? 'Combined' : grp[0].addr;
      const srcs = [deedA != null ? `${int(deedA)} sf by deed` : null, assessed != null ? `${int(assessed)} sf assessed` : null, `${int(mapped)} sf on the City map`].filter(Boolean);
      parts.push(`${who}: ${srcs.join(', ')}.`);
    }
    const approvals: Check['approvals'] = [];
    let text: string;
    if (status === 'pass') text = `${lots.length > 1 ? 'Each lot meets' : 'Meets'} the ${int(min)} sf minimum. ${parts.join(' ')}`;
    else if (status === 'needs_survey') text = `Needs a survey: the records fall on both sides of the ${int(min)} sf minimum. ${parts.join(' ')}`;
    else {
      text = `Under the ${int(min)} sf minimum. ${parts.join(' ')}`;
      approvals.push({ kind: 'variance', trust: trust === 'ink' ? 'ink' : 'pencil', why: 'lot area' });
      if (tpl.single_unit && R.lotOfRecord) text += ` A lot-of-record exception may apply instead (§${R.lotOfRecord.section}, ${R.lotOfRecord.state === 'ink' ? 'checked' : 'pencil'}).`;
    }
    if (status === 'needs_survey') approvals.push({ kind: 'variance', trust: 'pencil', why: 'lot area, if a survey finds it under the minimum' });
    checks.push({ id: 'area', label: 'Lot area', required: min, available: Math.round(primaryTotal), shortfall: status === 'fail' ? Math.max(0, min - primaryTotal) : 0, unit: 'sf', status, trust, text, rule_ids: [R.minArea.id], record_ids: ps.flatMap((p) => [recordId(p.pin, 'deed'), recordId(p.pin, 'lotarea'), recordId(p.pin, 'poly')]), approvals });
  }

  // Height and stories: checked only because the proposal declares them.
  {
    const hMax = num(R.height);
    const sMax = num(R.stories);
    if (hMax == null) {
      checks.push({ id: 'height', label: 'Height', required: null, available: null, shortfall: null, unit: 'ft', status: 'open', trust: 'pencil', text: 'Height rule not loaded.', rule_ids: [], record_ids: [], approvals: [] });
    } else {
      const ok = P.height <= hMax && (sMax == null || P.stories <= sMax);
      const t = weakest(ruleTrust(R.height), sMax != null ? ruleTrust(R.stories) : 'ink');
      checks.push({
        id: 'height',
        label: 'Height',
        required: P.height,
        available: hMax,
        shortfall: ok ? 0 : P.height - hMax,
        unit: 'ft',
        status: ok ? 'pass' : 'fail',
        trust: t,
        text: `Your ${P.stories}-story, ${fmtFt(P.height)} ft proposal ${ok ? 'is within' : 'exceeds'} the ${fmtFt(hMax)} ft${sMax != null ? `, ${sMax}-story` : ''} limit.`,
        rule_ids: [R.height?.id, R.stories?.id].filter(Boolean) as string[],
        record_ids: [],
        approvals: ok ? [] : [{ kind: 'variance', trust: t === 'ink' ? 'ink' : 'pencil', why: 'height' }],
      });
    }
  }

  // Use permission (§911.02; † until a person signs it).
  {
    const r = R.use;
    const v = r?.value as string | undefined;
    const t = ruleTrust(r);
    let status: Check['status'];
    let text: string;
    const approvals: Check['approvals'] = [];
    if (!r) {
      status = 'open';
      text = `${tpl.name}: use rule not loaded (§911.02). If it isn't permitted by right, it would need a variance or special exception.`;
      approvals.push({ kind: 'variance', trust: 'pencil', why: 'use not confirmed' });
    } else if (t !== 'ink') {
      status = 'open';
      text = `${tpl.name}: ${useWords(v)} in ${rs.district}, per an unreviewed reading of §${r.section}.`;
      approvals.push({ kind: 'variance', trust: 'pencil', why: 'use not confirmed' });
    } else {
      status = v === 'P' ? 'pass' : 'fail';
      text = `${tpl.name}: ${useWords(v)} in ${rs.district} (§${r.section}).`;
      if (v !== 'P') approvals.push({ kind: 'variance', trust: 'ink', why: `use is ${useWords(v)}` });
    }
    checks.push({ id: 'use', label: 'Use', required: null, available: null, shortfall: null, unit: '', status, trust: status === 'open' ? 'pencil' : t, text, rule_ids: r ? [r.id] : [], record_ids: [], approvals });
  }

  // Parking (§914.02.A; † until signed). Whether spaces fit on the lot is not assessed.
  {
    const r = R.parking;
    const homes = scenario.type === 'row' ? units.length : P.units;
    const per = typeof r?.value === 'number' ? r.value : null;
    const approvals: Check['approvals'] = [];
    let status: Check['status'];
    let text: string;
    let required: number | null = per != null ? per * homes : null;
    if (scenario.pending_parking_repeal) {
      required = 0;
      status = 'open';
      text = 'Pending policy applied: Bill 2025-1545 would remove parking minimums. It is held in Council (unverified). Pencil until it passes.';
    } else if (!r) {
      status = 'open';
      text = 'Parking minimum not loaded (§914.02.A). Whether spaces fit hasn\'t been checked.';
      approvals.push({ kind: 'parking_relief', trust: 'pencil', why: 'parking not confirmed' });
    } else if (required === 0) {
      status = ruleTrust(r) === 'ink' ? 'pass' : 'open';
      text = `No parking required for ${tpl.name.toLowerCase()}s (§${r.section}${ruleTrust(r) === 'ink' ? '' : ', unreviewed'}).`;
    } else {
      status = 'open';
      text = `${required} space${required === 1 ? '' : 's'} required (§${r.section}${ruleTrust(r) === 'ink' ? '' : ', unreviewed'}). Whether they fit on this lot hasn't been checked.`;
      approvals.push({ kind: 'parking_relief', trust: 'pencil', why: 'parking may not fit' });
    }
    checks.push({ id: 'parking', label: 'Parking', required, available: null, shortfall: null, unit: 'spaces', status, trust: 'pencil', text, rule_ids: r ? [r.id] : [], record_ids: [], approvals });
  }

  // Slope and grading (§915.02.A; † until signed).
  {
    const slope = Math.max(...ps.map((p) => p.slope25));
    const flag = slope >= settings.slope_flag_threshold;
    const r = R.grading;
    const approvals: Check['approvals'] = [];
    let text: string;
    if (flag) {
      text = `${pct(slope)} of the lot is 25% slope or steeper (City slope layer). Cut or fill on that grade may need a geotechnical report and grading review${r ? ` (§${r.section}${ruleTrust(r) === 'ink' ? '' : ', unreviewed'})` : ' (rule not loaded)'}.`;
      approvals.push({ kind: 'grading_review', trust: 'pencil', why: `${pct(slope)} of the lot at 25%+ slope` });
    } else text = `${slope > 0 ? `Only ${pct(slope)}` : 'None'} of the lot is 25% slope or steeper (City slope layer).`;
    checks.push({ id: 'grading', label: 'Slope', required: null, available: Math.round(slope * 1000) / 1000, shortfall: null, unit: 'share', status: flag ? 'open' : 'pass', trust: flag ? 'pencil' : 'ink', text, rule_ids: r ? [r.id] : [], record_ids: ps.map((p) => recordId(p.pin, 'slope25')), approvals });
  }

  // Undermining (record).
  {
    const u = Math.max(...ps.map((p) => p.undermined));
    checks.push({ id: 'undermined', label: 'Undermining', required: null, available: u, shortfall: null, unit: 'share', status: u > 0 ? 'open' : 'pass', trust: u > 0 ? 'pencil' : 'ink', text: u > 0 ? `${pct(u)} of the lot is in a mapped undermined area. Ask about mine subsidence.` : 'Outside mapped undermined areas.', rule_ids: [], record_ids: ps.map((p) => recordId(p.pin, 'undermined')), approvals: [] });
  }

  // Ownership (records).
  {
    const approvals: Check['approvals'] = [];
    const parts: string[] = [];
    for (const p of ps) {
      const label = p.lot != null ? `Lot ${p.lot}` : p.addr;
      if (p.city) {
        const forSale = p.city.status === 'Available for Sale';
        approvals.push({ kind: 'city_public_sale', trust: 'ink', why: `${label}: City-owned, ${p.city.status}` });
        parts.push(`${label}: City-owned, ${p.city.status}${p.city.status_updated ? ` (status last updated ${p.city.status_updated})` : ''}.`);
        if (!forSale) questions.push({ id: `q.city_status.${p.pin}`, text: `${p.addr} is City-owned but listed as "${p.city.status}". Could it be offered for sale?`, ask: 'City Real Estate', section: null, trust: 'pencil' });
      } else {
        approvals.push({ kind: 'other_owner', trust: 'ink', why: `${label}: not in the City's inventory` });
        parts.push(`${label}: not in the City's inventory; County owner type ${titleCase(p.assess?.ownercat ?? 'unknown')}.`);
      }
    }
    const stale = ps.filter((p) => p.city?.status_updated && p.city.status_updated < '2024-01-01');
    if (stale.length)
      questions.push({ id: 'q.city_status_current', text: `The City's inventory last updated the sale status of ${stale.map((p) => p.addr).join(', ')} on ${stale[0].city!.status_updated}. Is it still current?`, ask: 'City Real Estate', section: null, trust: 'pencil' });
    checks.push({ id: 'ownership', label: 'Ownership', required: null, available: null, shortfall: null, unit: '', status: 'info', trust: 'ink', text: parts.join(' '), rule_ids: [], record_ids: ps.map((p) => recordId(p.pin, 'city')), approvals });
  }

  // Contextual side setback (information).
  {
    const flank = main.sides.filter((s) => s.kind === 'side_interior');
    const built = flank.flatMap((s) => s.neighbors.filter((n) => n.built && !groupSet.has(n.pin)));
    const vacant = flank.flatMap((s) => s.neighbors.filter((n) => !n.built && !groupSet.has(n.pin)));
    if (R.ctxSide && flank.length) {
      const text = built.length
        ? `Contextual side setback may apply next to ${built.map((n) => n.addr).join(', ')} (built). Its actual setback hasn't been surveyed, so this stays pencil (§${R.ctxSide.section}).`
        : `${vacant.length > 1 ? 'Both neighbors are' : 'The neighbor is'} vacant, so the contextual setback can't apply; the district setback stands (§${R.ctxSide.section}).`;
      checks.push({ id: 'contextual', label: 'Contextual setback', required: null, available: null, shortfall: null, unit: '', status: 'info', trust: built.length ? 'pencil' : ruleTrust(R.ctxSide), text, rule_ids: [R.ctxSide.id], record_ids: [...built, ...vacant].map((n) => recordId(n.pin, 'built')), approvals: [] });
    }
  }

  // Questions from open rules.
  if (scenario.type === 'row' && narrowQ && narrowQ.status !== 'city_confirmed') {
    questions.push({ id: NARROW_Q, text: narrowQ.question.question, ask: narrowQ.question.ask, section: narrowQ.question.section, trust: narrowQ.status === 'assumed' ? 'red' : 'pencil' });
  }
  for (const r of [R.use, R.parking, R.grading]) {
    if (r && r.state !== 'ink' && r.question_for_city) questions.push({ id: `q.rule.${r.id}`, text: r.question_for_city, ask: 'Zoning Administrator', section: r.section, trust: 'pencil' });
  }

  // ── Approvals and score ───────────────────────────────────────────────────
  const approvals = collectApprovals(checks, settings);
  const inkSum = approvals.ink.reduce((s, a) => s + a.weight, 0);
  const penSum = approvals.pencil.reduce((s, a) => s + a.weight, 0);
  const hi = Math.max(0, 100 - inkSum);
  const lo = Math.max(0, hi - penSum);
  const formula = [
    `100${approvals.ink.map((a) => ` ${MINUS} ${a.weight}`).join('')} = ${hi}`,
    approvals.pencil.length ? `${hi}${approvals.pencil.map((a) => ` ${MINUS} ${a.weight}`).join('')} = ${lo}` : null,
  ]
    .filter(Boolean)
    .join(' · open: ');

  const trust = weakest(W.trust, D.trust, ...(scenario.type === 'row' ? units.map((u) => u.trust) : []));

  return {
    ...base,
    pins,
    lot_poly: lotRing,
    sides: scenario.type === 'row' ? unitBuilds.flatMap((b) => b.sides) : main.sides,
    envelope: { poly: envPoly, area: Math.round(envArea), method: main.env.method },
    width: W,
    depth: D,
    units,
    checks,
    relief,
    approvals,
    score: { hi, lo, formula },
    questions: dedupeQuestions(questions),
    trust,
    notes,
  };
}

function frontOf(b: Built): Unit['front'] {
  const f = b.sides.find((s) => s.kind === 'front');
  return f ? { a: f.a, b: f.b, setback: f.setback ?? 0 } : null;
}

/** Never a negative number: "24 − 15 − 15 leaves no buildable width". */
function noneFormula(terms: number[], what: string): string {
  return `${terms.map(fmtFt).join(` ${MINUS} `)} leaves no buildable ${what}`;
}

function unionEnvelopes(bs: Built[]): Ring {
  const polys = bs.map((b) => b.env.poly).filter((p) => p.length >= 3);
  if (!polys.length) return [];
  if (polys.length === 1) return polys[0];
  try {
    return dropCollinear(unionRings(polys));
  } catch {
    return polys[0];
  }
}

/** End-unit width if the narrow-lot table covers attached houses (end lot's deed frontage). */
function altEndWidth(ps: Parcel[], narrow: EffectiveRule | undefined): { value: number; formula: string } {
  const f = ps[0].deed?.front ?? 0;
  const row = narrowRow(narrow, f);
  const s = row ? row.interior : 0;
  return { value: f - s, formula: minusFormula([f, s, 0], f - s, fmtFt) };
}
/** End-unit width under the district side setback. */
function altEndWidthNo(ps: Parcel[], sideInt: EffectiveRule): { value: number; formula: string } {
  const f = ps[0].deed?.front ?? 0;
  const s = num(sideInt) ?? 0;
  return { value: f - s, formula: minusFormula([f, s, 0], f - s, fmtFt) };
}

function useWords(v: string | undefined): string {
  switch (v) {
    case 'P':
      return 'permitted by right';
    case 'S':
      return 'a special exception';
    case 'SPR':
      return 'permitted with Site Plan Review';
    case 'N':
      return 'not permitted';
    default:
      return 'unknown';
  }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function sectionOf(rs: RuleSet, ids: string[]): string {
  const r = rs.rules.find((x) => ids.includes(x.id));
  return r ? r.section : '';
}

export function collectApprovals(checks: Check[], settings: Settings): LotResult['approvals'] {
  const ink = new Map<ApprovalKind, Approval>();
  const pen = new Map<ApprovalKind, Approval>();
  for (const c of checks) {
    for (const a of c.approvals) {
      const target = a.trust === 'ink' ? ink : pen;
      const cur = target.get(a.kind) ?? { kind: a.kind, label: APPROVAL_LABEL[a.kind], weight: settings.weights[a.kind], why: [] };
      cur.why.push(a.why);
      target.set(a.kind, cur);
    }
  }
  for (const k of ink.keys()) pen.delete(k); // deduct once per distinct approval
  const order: ApprovalKind[] = ['variance', 'administrator_exception', 'grading_review', 'parking_relief', 'other_owner', 'city_public_sale'];
  const sort = (m: Map<ApprovalKind, Approval>) => order.filter((k) => m.has(k)).map((k) => m.get(k)!);
  return { ink: sort(ink), pencil: sort(pen) };
}

function dedupeQuestions(qs: OpenQuestion[]): OpenQuestion[] {
  const seen = new Set<string>();
  return qs.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
}

