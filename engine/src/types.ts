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
  quote_status?: 'verified' | 'failed'; // set when loaded against the saved code text
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
  | 'use_variance' // the use table says not permitted (§911.02): a use variance from the Zoning Board of Adjustment
  | 'special_exception' // the use table says special exception (§911.02)
  | 'grading_review'
  | 'administrator_exception'
  | 'lot_consolidation' // two or more lots made into one zoning lot (the City's process)
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
  envelope: Ring; // this unit's (or building's) envelope
  front: { a: Pt; b: Pt; setback: number } | null; // front side of this unit's lot
}

export interface OpenQuestion {
  id: string;
  text: string;
  ask: string;
  section: string | null;
  trust: Trust; // pencil (open) or red (assumed)
}

export type RefusalCode =
  | 'records_disagree'
  | 'missing_rule'
  | 'edges_unclear'
  | 'sanity'
  | 'missing_input'
  | 'not_adjacent' // a group whose lots don't all share edges can't be one zoning lot
  | 'mixed_districts'; // a group that spans zoning districts

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

/** Evidence classes (DESIGN_GUIDE §5): a checked fact, a practitioner's estimate, your assumption. */
export type Evidence = 'ink' | 'estimate' | 'red';

export interface ValueSignal {
  id: 'median' | 'newest' | 'affordable';
  value: number;
  label: string; // what it is
  note: string; // what it is not ("not an appraisal", "one sale; may be price-restricted")
  evidence: Evidence;
}

export interface CostEstimate {
  id: 'A' | 'B' | 'prod';
  label: string; // "Vertical construction"
  psf: [number, number];
  vertical: [number, number]; // per home
  /** Left for site work, soft costs and land, per home: new-build value − vertical cost. [best, worst] */
  left: [number, number];
  note: string;
  supplied_by: string;
  default: boolean;
  speculative: boolean;
  formula: string;
}

/** The money screen (spec §0.12 C3 as refined by §0.13 C10–C11): vertical construction at each
 *  practitioner estimate, and what a new-build sale would leave for site work, soft costs and land.
 *  Estimates are shown side by side and never averaged. */
export interface MoneyResult {
  homes: number;
  sqft: number; // per home (red, from the template)
  estimates: CostEstimate[];
  new_build: ValueSignal | null; // the value used for "left after building"
  context: ValueSignal[]; // the median (context only) and what an 80% AMI buyer could pay (a ceiling)
  site_work: { lo: number; hi: number; note: string; supplied_by: string };
  money_verdict: 'only_with_subsidy' | 'worth_pricing_site' | 'depends_on_builder' | 'no_new_build';
  swing: number; // how much the estimate's own range moves what's left, per home
  with_assumptions: { lo: number; hi: number; soft: number; financing: number; formula: string }; // the practitioner estimate (A)
  comps: { median: number; q1: number; q3: number; count: number; thin: boolean; ward: number | null };
  affordable: { price: number; income: number; household: number; formula: string };
  source_leads: string[];
  record_ids: string[];
}
