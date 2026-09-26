// 24×100 engine types. This file is the contract (PLAN.md §2); only the orchestrator changes it.
// Units: feet and square feet throughout. Local frame: x along the main street, y down.

export type Pt = [number, number];
export type Ring = Pt[];
export type Trust = 'ink' | 'pencil' | 'red';
export type TemplateId = 'detached' | 'two' | 'row' | 'three';

// ─── Block file (data/blocks/<id>.json) ─────────────────────────────────────

export interface SourceRef {
  id: string;
  name: string;
  url?: string;
  pulled?: string;
  note?: string;
}

export interface Assessment {
  lotarea: number | null;
  use: string | null;
  class?: string | null;
  ownercat: string | null;
  yearbuilt: number | null;
  stories: string | number | null;
  finish: string | null;
  legal: string | null;
  asof: string | null;
}

export interface Deed {
  plan: string | null;
  plan_lot: string | null;
  front: number;
  depth: number;
  part?: boolean;
  parsed_from: string;
}

export interface CityRecord {
  status: string;
  inventory: string | null;
  status_updated: string | null;
  zoned_as?: string | null;
}

export type ReconState = 'ok' | 'records_disagree' | 'no_deed' | 'no_assessment';

export interface Recon {
  state: ReconState;
  ratio: number | null;
  assessed: number | null;
  mapped: number;
  deed_area: number | null;
}

export interface Parcel {
  pin: string;
  lot: number | null;
  lot_suffix?: string | null;
  addr: string;
  addr_source: 'city_owned' | 'assessment';
  addr_street: string | null;
  poly: Ring[];
  rep_point?: Pt;
  zone: string | null;
  zone_frac?: number;
  overlays: string[];
  assess: Assessment | null;
  deed: Deed | null;
  city: CityRecord | null;
  built: boolean;
  built_basis?: string;
  building_ids?: string[];
  slope25: number;
  undermined: number;
  mapped_area: number;
  lotdim?: { width: number; len: number } | null;
  recon: Recon;
}

export interface Street {
  name: string;
  osm_id?: number;
  line: Pt[];
}

export interface Building {
  id: string;
  poly: Ring[];
  lot_pin: string | null;
  material: string | null;
  source?: string;
}

export interface BlockMeta {
  id: string;
  name: string;
  neighborhood: string;
  ward?: number;
  pulled: string;
  sources: SourceRef[];
  origin: { lat: number; lon: number };
  rotation_deg: number;
  frame?: string;
  main_street: string;
  bounding_streets?: string[];
  selection?: string;
  counts_note?: string;
  recon_tolerance: number;
  pipeline_version?: string;
}

export interface BlockFile {
  meta: BlockMeta;
  streets: Street[];
  parcels: Parcel[];
  buildings: Building[];
  slope: Ring[][];
  undermined?: Ring[][];
  hist_zoning?: Record<string, string>;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export type RuleField =
  | 'min_lot_area'
  | 'front_setback'
  | 'rear_setback'
  | 'side_setback_interior'
  | 'side_setback_exterior'
  | 'party_wall_side'
  | 'contextual_side'
  | 'contextual_rear'
  | 'narrow_lot_side_table'
  | 'max_height_ft'
  | 'max_stories'
  | 'use_detached'
  | 'use_two'
  | 'use_row'
  | 'use_three'
  | 'parking_detached'
  | 'parking_two'
  | 'parking_row'
  | 'parking_three'
  | 'grading_review'
  | 'lot_of_record';

export interface NarrowRow {
  max_width: number; // applies to lots with width <= max_width (and > the next row's max_width)
  interior: number;
  streetside: number;
}

export type UsePermission = 'P' | 'S' | 'SPR' | 'N';

export type VerificationLevel = 'unreviewed' | 'source_checked' | 'city_confirmed';

export interface CityReference {
  text: string;
  date: string;
  who: string;
}

export interface Verification {
  level: VerificationLevel;
  reviewer: string | null;
  role: string | null;
  at: string | null;
  note: string | null;
  reference: CityReference | null;
}

export interface Rule {
  id: string;
  district: string;
  field: RuleField;
  value: number | NarrowRow[] | UsePermission | null;
  unit: 'ft' | 'sf' | 'stories' | 'spaces_per_unit' | 'table' | 'use' | 'flag';
  applies_to: (TemplateId | 'row_end' | '*')[];
  condition: string | null;
  section: string;
  quote: string;
  source_file: string;
  source_url?: string;
  retrieved?: string;
  origin: 'answer_key' | 'extracted';
  dagger: boolean;
  question_for_city: string | null;
  verification: Verification;
  model: string | null;
  prompt_sha: string | null;
  enacted?: { ordinance: string; effective: string; quote: string } | null; // history note, verbatim
}

export interface Question {
  id: string;
  district: string | '*';
  section: string;
  quote: string;
  source_file: string;
  question: string;
  ask: string;
  affects: string[];
  yes: { extends_applies_to?: ('row_end' | TemplateId)[] };
  no: Record<string, never> | { extends_applies_to?: never };
}

export type AuditAction = 'source_checked' | 'struck' | 'assumed' | 'city_confirmed' | 'reopened';

export interface AuditEntry {
  id: string;
  rule_id: string | null;
  question_id: string | null;
  at: string;
  reviewer: string;
  role: string;
  action: AuditAction;
  quote: string;
  decision: string;
  reason: string;
  choice: 'yes' | 'no' | null;
  reference: CityReference | null;
}

export type RuleState = 'ink' | 'pencil' | 'struck';

export interface EffectiveRule extends Rule {
  state: RuleState;
  sealed: boolean; // City-confirmed
  ai_checked: boolean; // source-checked by an AI agent only; a teammate should re-sign
  history: AuditEntry[];
}

export type QuestionStatus = 'open' | 'assumed' | 'city_confirmed';

export interface QuestionState {
  question: Question;
  status: QuestionStatus;
  choice: 'yes' | 'no' | null;
  by: string | null;
  role: string | null;
  at: string | null;
  reference: CityReference | null;
}

export interface RuleSet {
  district: string;
  rules: EffectiveRule[];
  questions: QuestionState[];
}

// ─── Scenario, settings ─────────────────────────────────────────────────────

export interface Proposal {
  width: number; // ft (per unit for rowhouses)
  depth: number; // ft
  stories: number;
  height: number; // ft
  units: number; // for row: computed by the fitter
  home_sqft: number; // finished sq ft per home
}

export interface Scenario {
  type: TemplateId;
  pins: string[]; // the lot(s); first is the selected lot unless a group is ordered along the street
  proposal: Proposal;
  pending_parking_repeal?: boolean; // lever 4 (Bill 2025-1545, pending, †)
}

export type ApprovalKind =
  | 'variance'
  | 'grading_review'
  | 'administrator_exception'
  | 'city_public_sale'
  | 'other_owner'
  | 'parking_relief';

export interface Settings {
  recon_tolerance: number; // red, default 0.10
  weights: Record<ApprovalKind, number>; // red
  slope_flag_threshold: number; // red, fraction of lot at 25%+ slope that raises the grading question
  min_rowhouse_unit_width: number; // red, default 16
}

// ─── Result object ──────────────────────────────────────────────────────────

export type EdgeKind = 'front' | 'rear' | 'side_interior' | 'side_exterior' | 'party_wall';

export interface Side {
  kind: EdgeKind;
  edge_idx: number[]; // indices of the lot ring's edges that make up this side
  a: Pt; // start (ring order)
  b: Pt; // end
  points: Pt[]; // the polyline of this side (>= 2 points)
  length: number;
  neighbors: { pin: string; built: boolean; addr: string; lot: number | null }[];
  street: string | null;
  setback: number | null; // ft applied; null when a rule is missing
  setback_rule_ids: string[];
  setback_trust: Trust;
  setback_note: string | null;
  through_lot?: boolean; // rear side faces a street
}

export interface Measure {
  deed: number | null; // integer feet by deed; null when there is no deed
  mapped: number; // one decimal, from the mapped envelope
  none: boolean; // true = no buildable width/depth (the arithmetic went <= 0)
  formula: string; // e.g. "24 − 10 − 10 = 4"
  terms: { value: number; label: string }[]; // first term minus the rest
  trust: Trust;
  rule_ids: string[];
  record_ids: string[];
}

export type CheckId =
  | 'width'
  | 'depth'
  | 'area'
  | 'height'
  | 'stories'
  | 'use'
  | 'parking'
  | 'grading'
  | 'undermined'
  | 'ownership'
  | 'contextual';

export type CheckStatus = 'pass' | 'fail' | 'open' | 'needs_survey' | 'not_assessed' | 'info';

export interface Check {
  id: CheckId;
  label: string;
  required: number | null;
  available: number | null;
  shortfall: number | null;
  unit: string;
  status: CheckStatus;
  trust: Trust;
  text: string; // one plain sentence
  rule_ids: string[];
  record_ids: string[];
  approvals: { kind: ApprovalKind; trust: Trust; why: string }[];
  /** The other outcome of an open or assumed question, e.g. rowhouse end units 21 ft "if yes". */
  alternative?: { available: number; formula: string; question_id: string; choice: 'yes' | 'no'; trust: Trust } | null;
}

export interface Relief {
  check: CheckId;
  text: string; // "side setbacks 10 → 4 ft on each side"
  from: number;
  to: number;
  section: string;
  approval: ApprovalKind;
}

export interface Approval {
  kind: ApprovalKind;
  label: string;
  weight: number;
  why: string[];
}

export interface Score {
  hi: number;
  lo: number;
  formula: string;
}

export interface Unit {
  pin: string;
  width: Measure;
  end: boolean;
  trust: Trust;
}

export interface OpenQuestion {
  id: string;
  text: string;
  ask: string;
  section: string | null;
  trust: Trust; // pencil (open) or red (assumed)
}

export type RefusalCode = 'records_disagree' | 'missing_rule' | 'edges_unclear' | 'sanity' | 'missing_input';

export interface LotResult {
  key: string;
  block_id: string;
  scenario: Scenario;
  pins: string[];
  district: string | null;
  state: 'ok' | 'refused';
  refusal: { code: RefusalCode; reason: string; values?: Record<string, number | string> } | null;
  sides: Side[];
  lot_poly: Ring; // the lot or the union of the group
  envelope: { poly: Ring; area: number; method: 'halfplane_convex' | 'buffer_concave' | 'none' };
  width: Measure | null;
  depth: Measure | null;
  units: Unit[]; // rowhouse units, or one entry per building
  checks: Check[];
  relief: Relief[];
  approvals: { ink: Approval[]; pencil: Approval[] };
  score: Score | null;
  questions: OpenQuestion[];
  not_assessed: string[];
  trust: Trust;
  notes: string[];
}

// ─── Money ──────────────────────────────────────────────────────────────────

export interface Comps {
  meta: { source: string; resource_id?: string; pulled: string; filters: string; ward?: number };
  counts: { transfers: number; valid: number; valid_1_2_unit: number };
  median: number;
  q1: number;
  q3: number;
  quantile_method?: string;
  newest: { addr: string; yearbuilt: number; price: number; sqft: number | null; saledate: string }[];
}

export interface Hud {
  area_name: string;
  median: number;
  l80: number[]; // index 0 = 1 person
  source_url: string;
  pulled: string;
}

export interface Assumption {
  key: string;
  value: number | [number, number];
  unit: string;
  label: string;
  supplied_by: string;
  role: string;
  note: string;
}

export interface MoneyResult {
  homes: number;
  sqft: number;
  value: { median: number; q1: number; q3: number; newest: number | null; count: number; thin: boolean };
  cost: { lo: number; hi: number; formula: string };
  break_even_psf: { value: number; formula: string; none: boolean };
  gap: { lo: number; hi: number; formula: string };
  affordable: { price: number; income: number; household: number; formula: string };
  affordability_gap: number; // median value − affordable price (negative = market already below)
  trust: Trust; // red whenever an assumption is used
  assumptions_used: string[];
  record_ids: string[];
}
