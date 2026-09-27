// The Graph view (spec §0.15 P1): one lot, or a combined group, drawn as a link-analysis graph built
// only from real objects: the engine's result, the block file's parcels and dataset list, the rule
// store with its review log, the money screen, the site unknowns and the draft letters. Nothing here
// is typed in by hand, and nothing is invented: a node exists only if its source resolves to one of
// those inputs (engine/test/graph.test.ts checks every one).
//
// Pure: no React, no DOM. layoutGraph is a fixed cluster layout (no physics, no randomness): the same
// graph at the same size always gets the same positions.
//
// Not exported from ./index: this file's EdgeKind (the graph's edge vocabulary) would collide with the
// lot-side EdgeKind in ./types. Import it as '@engine/graph'.
import { dayOf, usd } from './format';
import { isAiReviewer } from './rules';
import { TEMPLATES } from './templates';
import type { AuditEntry, BlockFile, Check, CheckStatus, EffectiveRule, LotResult, MoneyResult, Parcel, RuleSet } from './types';
import type { Inquiry } from './inquiry';
import type { UnlockOption } from './unlock';
import type { SiteRow } from './verdict';

// ─── The contract ───────────────────────────────────────────────────────────────────────────────

export type NodeType = 'lot' | 'neighbor' | 'rule' | 'quote' | 'person' | 'source' | 'estimate' | 'sale' | 'site' | 'office';
export type Cluster = 'center' | 'neighbors' | 'rules' | 'sources' | 'money' | 'site' | 'next';
export type EdgeKind =
  | 'needed to fit'
  | 'adjacent to'
  | 'constrained by'
  | 'cites'
  | 'signed by'
  | 'assesses'
  | 'ownership'
  | 'geometry'
  | 'estimates cost'
  | 'comparable sale'
  | 'has condition'
  | 'inquire';

/** Where a node came from. `ref` resolves against the inputs:
 *  record → a parcel PIN, a block dataset id (block.meta.sources) or a money record id (money.record_ids);
 *  rule → a rule id in rs.rules (a rule-file signature is the rule's own verification field);
 *  review → an audit entry id in a cited rule's history; estimate → a money estimate id or 'site_work';
 *  engine → the result key, `site:<id>` (siteUnknowns) or `letter:<office>` (the inquiry). */
export interface GraphSource {
  kind: 'record' | 'rule' | 'review' | 'engine' | 'estimate';
  ref: string;
  url?: string;
  pulled?: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  cluster: Cluster;
  label: string;
  sub?: string;
  trust: 'ink' | 'pencil' | 'red' | 'estimate' | 'unknown';
  source: GraphSource;
  detail: { k: string; v: string }[];
  /** A signature by the AI research pass: an AI check, not a person's review. */
  ai?: boolean;
  /** The centre: which checks fail or are open, in words. */
  status?: string;
  /** A City-owned lot's coin: filled when Available for Sale, a ring for any other status. */
  city?: 'for_sale' | 'held';
  /** A quote node's verbatim text. */
  quote?: string;
  /** A rule check that fails or is open, or a lot the engine says is needed to fit. */
  flag?: boolean;
  /** A rule's signature, as recorded: in the review log (`review`), or the rule file's own verification. */
  signed?: { by: string; role: string; at: string | null; ai: boolean; review: boolean; action: string; note?: string | null };
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface LotGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLetter {
  id: string;
  to: string;
  about?: string;
  tab?: string;
}

export interface GraphInput {
  result: LotResult;
  block: BlockFile;
  rs: RuleSet;
  money: MoneyResult | null;
  site: SiteRow[];
  letters: GraphLetter[];
  /** Optional: the engine's recommended combine option for a single lot (see combineOf). Its extra
   *  lots are drawn "needed to fit". */
  combine?: { pins: string[]; label: string } | null;
  /** Optional: where the comparable sales came from (Comps.meta), for the sale node's link and date. */
  comps?: { source: string; url?: string; pulled: string } | null;
}

// ─── Helpers for mounting ──────────────────────────────────────────────────────────────────────

/** The inquiry's letters in the graph's shape: one office node per letter. */
export function lettersOf(inq: Pick<Inquiry, 'letters'> | null | undefined): GraphLetter[] {
  return (inq?.letters ?? []).map((l) => ({ id: l.office, to: l.to, about: l.about, tab: l.tab }));
}

/** The unlock search's recommended option, when it combines this single lot with others. */
export function combineOf(unlock: { recommended: UnlockOption | null } | null | undefined, result: LotResult): GraphInput['combine'] {
  const o = unlock?.recommended;
  if (!o || o.lever !== 'combine' || result.pins.length !== 1 || !o.scenario.pins.includes(result.pins[0])) return null;
  return { pins: o.scenario.pins, label: o.label };
}

// ─── Words ─────────────────────────────────────────────────────────────────────────────────────

const FIELD_WORDS: Record<string, string> = {
  min_lot_area: 'Minimum lot size',
  front_setback: 'Front setback',
  rear_setback: 'Rear setback',
  side_setback_interior: 'Interior side setback',
  side_setback_exterior: 'Street side setback',
  party_wall_side: 'Party-wall side setback',
  contextual_side: 'Contextual side setback',
  contextual_rear: 'Contextual rear setback',
  narrow_lot_side_table: 'Narrow-lot side yards',
  max_height_ft: 'Maximum height',
  max_stories: 'Maximum stories',
  grading_review: 'Grading on steep slopes',
  lot_of_record: 'Lot of record',
};
const TYPE_WORDS: Record<string, string> = { detached: 'detached', two: 'two-unit', row: 'rowhouse', three: 'three-unit' };

export function ruleFieldWords(field: string): string {
  if (FIELD_WORDS[field]) return FIELD_WORDS[field];
  const m = field.match(/^(use|parking)_(.*)$/);
  if (m) return `${m[1] === 'use' ? 'Use' : 'Parking'}: ${TYPE_WORDS[m[2]] ?? m[2]}`;
  return field.replaceAll('_', ' ');
}

export function ruleValueWords(r: EffectiveRule): string {
  if (Array.isArray(r.value)) return 'table by lot width';
  if (r.value == null) return r.unit === 'flag' ? 'when it applies' : '—';
  if (r.unit === 'use') return ({ P: 'permitted', S: 'special exception', SPR: 'site plan review', N: 'not permitted' } as Record<string, string>)[String(r.value)] ?? String(r.value);
  if (r.unit === 'sf') return `${Number(r.value).toLocaleString('en-US')} sf`;
  if (r.unit === 'spaces_per_unit') return `${r.value} per unit`;
  if (r.unit === 'stories') return `${r.value} stories`;
  return `${r.value} ${r.unit}`;
}

const STATUS_WORDS: Record<CheckStatus, string> = {
  pass: 'passes',
  fail: 'fails',
  open: 'open',
  needs_survey: 'needs a survey',
  not_assessed: 'not assessed',
  info: 'information',
};
/** A check that holds the lot back: it fails, or it isn't settled yet. */
const CONSTRAINS: CheckStatus[] = ['fail', 'open', 'needs_survey'];

const TRUST_WORDS: Record<GraphNode['trust'], string> = {
  ink: 'Ink: sourced',
  pencil: 'Pencil: not reviewed yet',
  red: 'Red: your assumption',
  estimate: 'Practitioner estimate',
  unknown: 'Not assessed',
};
export function trustWords(t: GraphNode['trust']): string {
  return TRUST_WORDS[t];
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function lotName(p: Parcel): string {
  return p.lot != null ? `Lot ${p.lot}${p.lot_suffix ?? ''}` : p.addr;
}
function lotNum(p: Parcel): string {
  return p.lot != null ? `${p.lot}${p.lot_suffix ?? ''}` : p.addr;
}
function andList(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
function byLot(a: Parcel, b: Parcel): number {
  return (a.lot ?? 1e9) - (b.lot ?? 1e9) || (a.lot_suffix ?? '').localeCompare(b.lot_suffix ?? '') || a.pin.localeCompare(b.pin);
}
function ownerType(p: Parcel): string {
  return p.assess?.ownercat ? titleCase(p.assess.ownercat) : 'not in the assessment';
}
function range(lo: number, hi: number, round: number): string {
  return lo === hi ? usd(lo, round) : `${usd(lo, round)}–${usd(hi, round)}`;
}

/** The signature behind a rule's current state: the last sign or City confirmation in the review log
 *  since the last reopen (as web/src/components/review/reviewlog.ts signatureOf), else the rule file's
 *  own verification (the pre-seeded research pass); null when nobody has signed it. */
function signatureFor(r: EffectiveRule): { reviewer: string; role: string; at: string | null; note: string | null; action: string; entry: AuditEntry | null } | null {
  let sig: AuditEntry | null = null;
  for (const e of r.history) {
    if (e.action === 'source_checked' || e.action === 'city_confirmed') sig = e;
    else if (e.action === 'reopened') sig = null;
  }
  if (sig) return { reviewer: sig.reviewer, role: sig.role, at: sig.at, note: sig.reason, action: sig.action, entry: sig };
  const v = r.verification;
  if (v.level !== 'unreviewed' && v.reviewer && v.role) return { reviewer: v.reviewer, role: v.role, at: v.at, note: v.note, action: v.level, entry: null };
  return null;
}

function ruleState(r: EffectiveRule): { trust: GraphNode['trust']; words: string } {
  if (r.state === 'struck') return { trust: 'pencil', words: 'Struck by a reviewer: not used.' };
  if (r.sealed) return { trust: 'ink', words: 'Ink: City-confirmed.' };
  if (r.state === 'ink') return { trust: 'ink', words: r.ai_checked ? 'Ink: source-checked by an AI agent. A teammate should re-check it.' : 'Ink: source-checked by a named person.' };
  if (r.quote_status === 'failed') return { trust: 'pencil', words: 'Pencil: the quote was not found in the saved code text.' };
  if (r.dagger) return { trust: 'pencil', words: 'Pencil: read by an AI and not yet checked by a person (†).' };
  return { trust: 'pencil', words: 'Pencil: proposed by the model, not reviewed.' };
}

// ─── Which datasets the result actually used ───────────────────────────────────────────────────

/** A record field (the tail of an engine record id, record:<pin>:<field>) → the block datasets it
 *  came from, and the edge that says how. */
const FIELD_SOURCES: Record<string, { id: string; kind: EdgeKind; use: string }[]> = {
  deed: [{ id: 'wprdc_assessments', kind: 'assesses', use: 'deed dimensions (parsed from the legal description)' }],
  lotarea: [{ id: 'wprdc_assessments', kind: 'assesses', use: 'assessed lot area' }],
  poly: [{ id: 'pgh_parcels', kind: 'geometry', use: 'lot lines (the City parcel polygon)' }],
  city: [
    { id: 'city_owned', kind: 'ownership', use: 'City ownership and sale status' },
    { id: 'wprdc_assessments', kind: 'ownership', use: 'owner type (a category, never a name)' },
  ],
  slope25: [{ id: 'slope25', kind: 'geometry', use: 'share of the lot at 25%+ slope' }],
  undermined: [{ id: 'undermined', kind: 'geometry', use: 'mapped undermined areas' }],
  built: [
    { id: 'building_footprints', kind: 'geometry', use: 'whether a neighbor is built (footprints)' },
    { id: 'wprdc_assessments', kind: 'assesses', use: 'whether a neighbor is built (year built)' },
  ],
};

// ─── buildGraph ────────────────────────────────────────────────────────────────────────────────

export function buildGraph(input: GraphInput): LotGraph {
  const { result: r, block, rs, money, site, letters } = input;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const has = new Set<string>();
  const add = (n: GraphNode) => {
    if (has.has(n.id)) return;
    has.add(n.id);
    nodes.push(n);
  };
  const edgeSeen = new Set<string>();
  const link = (from: string, to: string, kind: EdgeKind) => {
    const k = `${from}→${to}`; // one edge per pair; the first kind wins
    if (!has.has(from) || !has.has(to) || edgeSeen.has(k)) return;
    edgeSeen.add(k);
    edges.push({ from, to, kind });
  };
  const parcel = (pin: string) => block.parcels.find((p) => p.pin === pin);
  const parcelsSrc = block.meta.sources.find((s) => s.id === 'pgh_parcels');

  // ── Centre: the lot, or the combined lots ──
  const group = r.pins.map(parcel).filter((p): p is Parcel => !!p).sort(byLot);
  const groupSet = new Set(r.pins);
  const center = `lot:${r.pins.join('+')}`;
  const tname = TEMPLATES[r.scenario.type]?.name ?? r.scenario.type;
  const failing = r.checks.filter((c) => c.status === 'fail').map((c) => c.label);
  const open = r.checks.filter((c) => c.status === 'open' || c.status === 'needs_survey').map((c) => c.label);
  const status =
    r.state !== 'ok'
      ? `Can't tell: ${r.refusal?.reason ?? 'not assessed'}`
      : [failing.length ? `${andList(failing)} ${failing.length > 1 ? 'fail' : 'fails'}` : '', open.length ? `${andList(open)} open` : ''].filter(Boolean).join(' · ') || 'Every check passes';
  add({
    id: center,
    type: 'lot',
    cluster: 'center',
    label: group.length > 1 ? `Lots ${andList(group.map(lotNum))}` : group[0] ? `${lotName(group[0])} · ${group[0].addr}` : r.key,
    sub: `${group.length > 1 ? 'combined · ' : ''}${tname}${r.district ? ` · ${r.district}` : ''}`,
    trust: r.state !== 'ok' ? 'unknown' : r.trust,
    source: { kind: 'engine', ref: r.key },
    status,
    detail: [
      { k: 'Building', v: tname },
      { k: group.length > 1 ? 'Lots, combined' : 'Lot', v: group.map((p) => `${lotName(p)} (${p.addr})`).join('; ') },
      { k: 'Block', v: `${block.meta.name}, ${block.meta.neighborhood}` },
      ...(r.district ? [{ k: 'District', v: r.district }] : []),
      ...(r.refusal ? [{ k: "Can't tell", v: r.refusal.reason }] : []),
      ...r.checks.map((c) => ({ k: c.label, v: `${STATUS_WORDS[c.status]} (${c.trust}). ${c.text}` })),
    ],
  });

  // ── Neighbors: the lots in the group, then the lots that share a lot line with it ──
  const combineExtra = new Set((input.combine?.pins ?? []).filter((p) => !groupSet.has(p)));
  const adjacent = new Set<string>();
  for (const s of r.sides) for (const n of s.neighbors) if (!groupSet.has(n.pin)) adjacent.add(n.pin);
  const neighborPins: { p: Parcel; role: 'group' | 'combine' | 'adjacent' }[] = [];
  if (group.length > 1) for (const p of group) neighborPins.push({ p, role: 'group' });
  const outside = [...new Set([...adjacent, ...combineExtra])]
    .map(parcel)
    .filter((p): p is Parcel => !!p)
    .sort(byLot);
  for (const p of outside) neighborPins.push({ p, role: combineExtra.has(p.pin) ? 'combine' : 'adjacent' });
  for (const { p, role } of neighborPins) {
    // Owner TYPE only, never a name: the City's inventory status, or the County's owner category.
    add({
      id: `parcel:${p.pin}`,
      type: 'neighbor',
      cluster: 'neighbors',
      label: `${lotName(p)} · ${p.city ? 'City-owned' : ownerType(p)}`,
      sub: `${p.city ? p.city.status : 'County owner type'} · ${p.built ? 'built' : 'vacant'}`,
      trust: 'ink',
      source: { kind: 'record', ref: p.pin, url: parcelsSrc?.url, pulled: parcelsSrc?.pulled ?? block.meta.pulled },
      city: p.city ? (p.city.status === 'Available for Sale' ? 'for_sale' : 'held') : undefined,
      flag: role !== 'adjacent' || undefined,
      detail: [
        { k: 'Address', v: p.addr },
        { k: 'Parcel', v: p.pin },
        {
          k: 'In this graph',
          v:
            role === 'group'
              ? `One of the combined lots for the ${tname.toLowerCase()}.`
              : role === 'combine'
                ? `The engine's best combine option: ${input.combine!.label}.${adjacent.has(p.pin) ? ' It shares a lot line with the lot.' : ''}`
                : 'Shares a lot line with the lot.',
        },
        { k: 'Owner type (County)', v: ownerType(p) },
        { k: 'City inventory', v: p.city ? `${p.city.status}${p.city.inventory ? ` · ${p.city.inventory}` : ''}${p.city.status_updated ? ` (status last updated ${p.city.status_updated})` : ''}` : 'not in the City-Owned Properties list' },
        { k: 'Built', v: `${p.built ? 'yes' : 'no (vacant)'}${p.built_basis ? `: ${p.built_basis}` : ''}` },
        ...(p.zone ? [{ k: 'Zoning', v: p.zone }] : []),
        ...(p.deed ? [{ k: 'Deed', v: `${p.deed.front} × ${p.deed.depth} ft` }] : []),
      ],
    });
    link(`parcel:${p.pin}`, center, role === 'adjacent' ? 'adjacent to' : 'needed to fit');
  }

  // ── Rules: every rule a check cites, its verbatim quote, and who signed it ──
  const ruleChecks = new Map<string, Check[]>();
  for (const c of r.checks) for (const id of new Set(c.rule_ids)) ruleChecks.set(id, [...(ruleChecks.get(id) ?? []), c]);
  const signers = new Map<string, { id: string; reviewer: string; role: string; rules: { r: EffectiveRule; at: string | null; action: string; note: string | null }[] }>();
  for (const [rid, checks] of ruleChecks) {
    const rule = rs.rules.find((x) => x.id === rid);
    if (!rule) continue; // never invent a rule the store doesn't hold
    const st = ruleState(rule);
    const constrains = checks.some((c) => CONSTRAINS.includes(c.status));
    const ruleNode = `rule:${rule.id}`;
    const sig = signatureFor(rule);
    add({
      id: ruleNode,
      type: 'rule',
      cluster: 'rules',
      label: `${ruleFieldWords(rule.field)} · ${ruleValueWords(rule)}`,
      sub: `§${rule.section} · ${rule.district === '*' ? 'all districts' : rule.district}`,
      trust: st.trust,
      source: { kind: 'rule', ref: rule.id, url: rule.source_url, pulled: rule.retrieved },
      ai: (rule.ai_checked && !!sig && isAiReviewer(sig.reviewer, sig.role)) || undefined,
      flag: constrains || undefined,
      signed: sig ? { by: sig.reviewer, role: sig.role, at: sig.at, ai: isAiReviewer(sig.reviewer, sig.role), review: !!sig.entry, action: sig.action, note: sig.note } : undefined,
      detail: [
        { k: 'Rule', v: ruleFieldWords(rule.field) },
        { k: 'Value', v: ruleValueWords(rule) },
        ...(rule.condition ? [{ k: 'Condition', v: rule.condition }] : []),
        { k: 'Section', v: `§${rule.section} · ${rule.district === '*' ? 'all districts' : rule.district}` },
        { k: 'State', v: st.words },
        {
          k: 'Signed',
          v: sig
            ? `${sig.reviewer} (${sig.role})${isAiReviewer(sig.reviewer, sig.role) ? ', an AI check, not a person' : ''}${sig.at ? ` · ${dayOf(sig.at)}` : ''}${sig.entry ? ' · review log' : ' · recorded in the rule file'}`
            : 'Not signed: pencil until a person source-checks it.',
        },
        {
          k: 'Origin',
          v: rule.origin === 'extracted' ? `proposed by ${rule.model ?? 'a model'}${rule.prompt_sha ? ` (prompt ${rule.prompt_sha.slice(0, 8)})` : ''}` : 'answer key from the team’s research notes',
        },
        { k: 'Checks', v: checks.map((c) => `${c.label}: ${STATUS_WORDS[c.status]}`).join('; ') },
        ...(rule.question_for_city ? [{ k: 'Question for the City', v: rule.question_for_city }] : []),
        { k: 'Source file', v: `${rule.source_file}${rule.retrieved ? `, retrieved ${rule.retrieved}` : ''}` },
      ],
    });
    if (constrains) link(center, ruleNode, 'constrained by');
    const quoteNode = `quote:${rule.id}`;
    add({
      id: quoteNode,
      type: 'quote',
      cluster: 'rules',
      label: `“${rule.quote.replace(/\s+/g, ' ').trim()}”`,
      sub: `§${rule.section} · ${rule.source_file.split('/').pop()}`,
      trust: rule.quote_status === 'failed' ? 'pencil' : 'ink',
      source: { kind: 'rule', ref: rule.id, url: rule.source_url, pulled: rule.retrieved },
      quote: rule.quote,
      detail: [
        { k: 'Section', v: `§${rule.section}` },
        {
          k: 'Word for word',
          v: rule.quote_status === 'failed' ? 'Not found in the saved code text: treat the rule as unverified.' : rule.quote_status === 'verified' ? 'Found word for word in the saved code text.' : 'Not checked against the saved code text here.',
        },
        { k: 'Saved text', v: `${rule.source_file}${rule.retrieved ? `, retrieved ${rule.retrieved}` : ''}` },
      ],
    });
    link(ruleNode, quoteNode, 'cites');
    if (sig) {
      const pid = `person:${sig.reviewer}|${sig.role}`;
      const isAi = isAiReviewer(sig.reviewer, sig.role);
      if (!signers.has(pid)) {
        signers.set(pid, { id: pid, reviewer: sig.reviewer, role: sig.role, rules: [] });
        add({
          id: pid,
          type: 'person',
          cluster: 'rules',
          label: sig.reviewer,
          sub: isAi ? `${sig.role} · an AI check, not a person` : sig.role,
          trust: 'ink',
          ai: isAi || undefined,
          source: sig.entry ? { kind: 'review', ref: sig.entry.id, pulled: sig.at ?? undefined } : { kind: 'rule', ref: rule.id, pulled: sig.at ?? undefined },
          detail: [], // filled below, once every rule this signer signed is known
        });
      }
      signers.get(pid)!.rules.push({ r: rule, at: sig.at, action: sig.action, note: sig.note });
      link(ruleNode, pid, 'signed by');
    }
  }
  for (const s of signers.values()) {
    const n = nodes.find((x) => x.id === s.id)!;
    n.detail = [
      { k: 'Name', v: s.reviewer },
      { k: 'Role', v: s.role },
      { k: 'Kind', v: n.ai ? 'An AI check (the research pass), not a person’s review. A teammate should re-sign.' : 'A person’s review, as recorded.' },
      ...s.rules.map(({ r: x, at, action, note }) => ({
        k: `§${x.section} ${ruleFieldWords(x.field).toLowerCase()}`,
        v: `${action === 'city_confirmed' ? 'recorded a City confirmation' : 'source-checked'}${at ? ` · ${dayOf(at)}` : ''}${note ? ` · “${note}”` : ''}${x.history.length ? '' : ' (recorded in the rule file)'}`,
      })),
    ];
  }

  // ── Sources: the block datasets the result actually used ──
  const uses = new Map<string, { kind: EdgeKind; use: Set<string>; targets: Map<string, EdgeKind> }>();
  const use = (id: string, kind: EdgeKind, what: string, target: string) => {
    const src = block.meta.sources.find((s) => s.id === id);
    if (!src) return; // a dataset the block file doesn't list is never drawn
    const u = uses.get(id) ?? { kind, use: new Set<string>(), targets: new Map<string, EdgeKind>() };
    u.use.add(what);
    if (!u.targets.has(target)) u.targets.set(target, kind);
    uses.set(id, u);
  };
  const recordTarget = (pin: string) => (groupSet.has(pin) ? center : has.has(`parcel:${pin}`) ? `parcel:${pin}` : center);
  for (const c of r.checks)
    for (const rid of c.record_ids) {
      const m = rid.match(/^record:([^:]+):(.+)$/);
      if (!m) continue;
      for (const f of FIELD_SOURCES[m[2]] ?? []) use(f.id, f.kind, f.use, recordTarget(m[1]));
    }
  if (r.district) use('zoning', 'geometry', `zoning district (${r.district})`, center);
  if (r.sides.some((s) => s.street)) use('osm_streets', 'geometry', 'street names for the front and rear', center);
  if (site.some((s) => s.id === 'environmental') && block.hist_zoning?.['1927']) use('hist_zoning_1927', 'geometry', `past use: the 1927 zoning map (${block.hist_zoning['1927']})`, center);
  if (letters.some((l) => l.id === 'rco') && group.some((p) => p.overlays.some((o) => o.startsWith('RCO')))) use('zoning_overlays', 'geometry', 'the Registered Community Organization for the RCO letter', center);
  for (const src of block.meta.sources) {
    const u = uses.get(src.id);
    if (!u) continue;
    const sid = `source:${src.id}`;
    const pub = src.name.startsWith('City of Pittsburgh ') ? 'City of Pittsburgh' : src.name.startsWith('WPRDC ') ? 'WPRDC' : src.name.startsWith('OpenStreetMap') ? 'OpenStreetMap' : null;
    const short = src.name.replace(/^City of Pittsburgh /, '').replace(/^WPRDC /, '');
    add({
      id: sid,
      type: 'source',
      cluster: 'sources',
      label: short,
      sub: `${pub ? `${pub} · ` : ''}pulled ${src.pulled ? src.pulled.slice(0, 10) : block.meta.pulled.slice(0, 10)}`,
      trust: 'ink',
      source: { kind: 'record', ref: src.id, url: src.url, pulled: src.pulled ?? block.meta.pulled },
      detail: [
        { k: 'Dataset', v: src.name },
        { k: 'Used for', v: [...u.use].join('; ') },
        { k: 'Pulled', v: src.pulled ?? block.meta.pulled },
        ...(src.url ? [{ k: 'URL', v: src.url }] : []),
        ...((src as { sha256?: string }).sha256 ? [{ k: 'SHA-256', v: (src as { sha256?: string }).sha256! }] : []),
      ],
    });
    for (const [t, kind] of u.targets) link(sid, t, kind);
  }

  // ── Money: the practitioner estimates, attributed, and the comparable sale ──
  if (money) {
    for (const e of money.estimates) {
      const id = `estimate:${e.id}`;
      add({
        id,
        type: 'estimate',
        cluster: 'money',
        label: `${e.speculative ? 'Production builder' : 'Build'} ${range(e.psf[0], e.psf[1], 1)}/sf`,
        sub: e.speculative ? 'speculative · practitioner estimate' : 'practitioner estimate',
        trust: 'estimate',
        source: { kind: 'estimate', ref: e.id },
        detail: [
          { k: 'Estimate', v: e.label },
          { k: 'Per sq ft', v: `${range(e.psf[0], e.psf[1], 1)}/sf` },
          { k: 'Per home', v: `${range(e.vertical[0], e.vertical[1], 1)} (${money.sqft.toLocaleString('en-US')} sf per home)` },
          { k: 'Arithmetic', v: e.formula },
          { k: 'Supplied by', v: e.supplied_by },
          ...(e.note ? [{ k: 'Note', v: e.note }] : []),
          { k: 'Kind', v: `Practitioner estimate, unconfirmed${e.speculative ? '; speculative, shown beside the estimate and never averaged' : '; never averaged'}.` },
        ],
      });
      link(id, center, 'estimates cost');
    }
    add({
      id: 'estimate:site_work',
      type: 'estimate',
      cluster: 'money',
      label: `Site work ${range(money.site_work.lo, money.site_work.hi, 1)}`,
      sub: 'practitioner estimate',
      trust: 'estimate',
      source: { kind: 'estimate', ref: 'site_work' },
      detail: [
        { k: 'Estimate', v: 'Site work, single unit' },
        { k: 'Range', v: range(money.site_work.lo, money.site_work.hi, 1) },
        { k: 'Supplied by', v: money.site_work.supplied_by },
        ...(money.site_work.note ? [{ k: 'Note', v: money.site_work.note }] : []),
        { k: 'Kind', v: 'Practitioner estimate, unconfirmed.' },
      ],
    });
    link('estimate:site_work', center, 'estimates cost');
    if (money.new_build) {
      const nb = money.new_build;
      const where = nb.label.includes(': ') ? nb.label.slice(nb.label.indexOf(': ') + 2) : nb.label;
      const ref = money.record_ids.find((x) => x === 'record:comps') ?? money.record_ids[0];
      if (ref) {
        add({
          id: 'sale:newest',
          type: 'sale',
          cluster: 'money',
          label: `Newest new build ${usd(nb.value, 1)}`,
          sub: where,
          trust: nb.evidence === 'estimate' ? 'estimate' : nb.evidence === 'red' ? 'red' : 'ink',
          source: { kind: 'record', ref, url: input.comps?.url, pulled: input.comps?.pulled },
          detail: [
            { k: 'Sale', v: nb.label },
            { k: 'Price', v: usd(nb.value, 1) },
            { k: 'Caveat', v: nb.note },
            ...(input.comps ? [{ k: 'Dataset', v: input.comps.source }, { k: 'Pulled', v: input.comps.pulled }] : []),
            { k: 'Used for', v: 'what is left after building: this sale minus vertical construction, per home' },
          ],
        });
        link('sale:newest', center, 'comparable sale');
      }
    }
  }

  // ── Site: the unknowns, never assessed ──
  for (const s of site) {
    const id = `site:${s.id}`;
    add({
      id,
      type: 'site',
      cluster: 'site',
      label: s.label,
      sub: `not assessed${s.deal_killer ? ' · can stop a deal early' : ''}`,
      trust: 'unknown',
      source: { kind: 'engine', ref: `site:${s.id}` },
      detail: [
        { k: 'Status', v: 'Not assessed. It could change the decision.' },
        ...s.signals.map((x, i) => ({ k: i === 0 ? 'Free signal' : 'Also', v: x })),
        { k: 'Resolves it', v: s.resolves },
        { k: 'Cost', v: s.cost },
        ...(s.deal_killer ? [{ k: 'Why first', v: 'Can stop a deal early (a practitioner at the hackathon).' }] : []),
      ],
    });
    link(center, id, 'has condition');
  }

  // ── Next: one office per draft letter ──
  for (const l of letters) {
    const id = `office:${l.id}`;
    add({
      id,
      type: 'office',
      cluster: 'next',
      label: l.tab ?? l.to,
      sub: l.about,
      trust: 'ink',
      source: { kind: 'engine', ref: `letter:${l.id}` },
      detail: [
        { k: 'To', v: l.to },
        ...(l.about ? [{ k: 'About', v: l.about }] : []),
        { k: 'Letter', v: 'A draft. Nothing has been sent: you decide whether and where to send it.' },
      ],
    });
    link(center, id, 'inquire');
  }

  return { nodes, edges };
}

// ─── Focus: the chain behind one decision ────────────────────────────────────────────────────────
//
// Team review, round 3: the film's technical beat shows one decision's chain, parcel → rule → exact quote →
// who reviewed it → the result, and nothing else. focusGraph is a filter over the real graph: it never adds a
// node or an edge; it keeps the ones the decision rests on. The decision is the engine's checks the focused
// node bears on (a rule's or a quote's: the checks citing that rule; a dataset's or a neighbour's: the checks
// whose records came from it; a signer's: the checks of the rules they signed; the lot's: the checks that fail
// or are open). The result is those checks, as the engine wrote them.

/** Information checks the engine tells as part of another decision: the contextual side setback is the width's
 *  note (explanation() in engine/src/sentence.ts tells them together; the rules wall shows it only as the width
 *  row's context), so a width chain includes the contextual rule and the neighbours it looked at, and the other
 *  way round. Named here by the engine's check ids, which are constants of evaluate(). */
const TOLD_WITH: Record<string, string[]> = { width: ['contextual'], contextual: ['width'] };

export interface FocusResult {
  id: string; // the engine's check id
  label: string;
  status: CheckStatus;
  trust: Check['trust'];
  text: string; // the check's own sentence
  available: number | null;
  required: number | null;
  unit: string;
}

export interface GraphFocus {
  /** The focused node. */
  id: string;
  /** The decision: the engine's check ids the chain explains. */
  checks: string[];
  /** The kept nodes and edges: a subset of the graph, never an addition. */
  graph: LotGraph;
  /** The decision's outcome, from the engine's checks (the lot node carries it on the canvas). */
  result: FocusResult[];
}

/** The chain behind the focused node's decision, or null when the node isn't in the graph. */
export function focusGraph(g: LotGraph, r: LotResult, id: string): GraphFocus | null {
  const node = g.nodes.find((n) => n.id === id);
  if (!node) return null;
  const center = g.nodes.find((n) => n.cluster === 'center');
  const ruleOf = (nid: string) => (nid.startsWith('rule:') ? nid.slice(5) : nid.startsWith('quote:') ? nid.slice(6) : null);
  const recordsOf = (c: Check) => c.record_ids.map((x) => x.match(/^record:([^:]+):(.+)$/)).filter((m): m is RegExpMatchArray => !!m);

  // 1. The decision: which checks the node bears on.
  let ids: string[] = [];
  if (node.type === 'rule' || node.type === 'quote') {
    const rid = ruleOf(node.id)!;
    ids = r.checks.filter((c) => c.rule_ids.includes(rid)).map((c) => c.id);
  } else if (node.type === 'person') {
    const signed = g.edges.filter((e) => e.kind === 'signed by' && e.to === node.id).map((e) => ruleOf(e.from)!);
    ids = r.checks.filter((c) => c.rule_ids.some((x) => signed.includes(x))).map((c) => c.id);
  } else if (node.type === 'source') {
    const ds = node.id.slice('source:'.length);
    ids = r.checks.filter((c) => recordsOf(c).some((m) => (FIELD_SOURCES[m[2]] ?? []).some((f) => f.id === ds))).map((c) => c.id);
  } else if (node.type === 'neighbor') {
    const pin = node.id.slice('parcel:'.length);
    ids = r.checks.filter((c) => recordsOf(c).some((m) => m[1] === pin)).map((c) => c.id);
  } else if (node.type === 'lot') ids = r.checks.filter((c) => CONSTRAINS.includes(c.status)).map((c) => c.id);
  for (const c of [...ids]) for (const x of TOLD_WITH[c] ?? []) if (!ids.includes(x) && r.checks.some((k) => k.id === x)) ids.push(x);
  const checks = r.checks.filter((c) => ids.includes(c.id));

  // 2. The chain: the lot, the decision's rules with their quotes and signers, the datasets and neighbours its
  //    records came from, and the focused node itself (an estimate, a site row or an office keeps its links).
  const keep = new Set<string>([node.id, ...(center ? [center.id] : [])]);
  const has = (x: string) => g.nodes.some((n) => n.id === x);
  for (const c of checks) {
    for (const rid of c.rule_ids) {
      if (!has(`rule:${rid}`)) continue;
      keep.add(`rule:${rid}`);
      for (const e of g.edges) if (e.from === `rule:${rid}` && (e.kind === 'cites' || e.kind === 'signed by')) keep.add(e.to);
    }
    for (const m of recordsOf(c)) {
      if (has(`parcel:${m[1]}`)) keep.add(`parcel:${m[1]}`);
      for (const f of FIELD_SOURCES[m[2]] ?? []) if (has(`source:${f.id}`)) keep.add(`source:${f.id}`);
    }
  }
  // The zoning map says which district's rules apply: part of any chain through a rule.
  if (checks.some((c) => c.rule_ids.length) && has('source:zoning')) keep.add('source:zoning');
  if (!checks.length) for (const e of g.edges) if (e.from === node.id || e.to === node.id) keep.add(e.from === node.id ? e.to : e.from);
  const nodes = g.nodes.filter((n) => keep.has(n.id));
  const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return {
    id: node.id,
    checks: checks.map((c) => c.id),
    graph: { nodes, edges },
    result: checks.map((c) => ({ id: c.id, label: c.label, status: c.status, trust: c.trust, text: c.text, available: c.available, required: c.required, unit: c.unit })),
  };
}

/** Where a focused chain's columns sit on a canvas `w` px wide: records on the left, then the lot (with its
 *  result), the rules with their exact quotes, and who reviewed them. Wide (the inspector folded away): one
 *  column per step. Narrow (a node's details open beside it): the signers go under the rules, so a quote keeps
 *  room for its words instead of every label shrinking. The canvas reads the same frame for its headings. */
export function focusFrame(w: number): { narrow: boolean; records: number; center: number; box: number; rules: number; persons: number | null; textRoom: number } {
  const narrow = w < 960;
  const records = narrow ? Math.max(0.24 * w, 168) : 0.2 * w;
  const box = narrow ? 210 : 250; // the lot's box, px
  const center = narrow ? records + 30 + box / 2 : 0.37 * w;
  const rules = narrow ? center + box / 2 + 44 : 0.5 * w;
  const persons = narrow ? null : 0.9 * w;
  return { narrow, records, center, box, rules, persons, textRoom: (persons ?? w) - rules - (narrow ? 36 : 96) };
}

/** A fixed layout for a focused chain: one column per step, each list centred on the lot's row, a rule's quote
 *  just under it (the quote's words run beside it), each signer level with the rules they signed (narrow: under
 *  the last rule). */
export function layoutFocus(g: LotGraph, w: number, h: number): Map<string, { x: number; y: number }> {
  const F = focusFrame(w);
  const pos = new Map<string, { x: number; y: number }>();
  const put = (id: string, x: number, y: number) => pos.set(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  const of = (t: NodeType) => g.nodes.filter((n) => n.type === t);
  const mid = 0.5 * h;
  for (const n of g.nodes.filter((x) => x.cluster === 'center')) put(n.id, F.center, mid);
  const records = [...of('source'), ...of('neighbor')];
  const rstep = Math.min(62, (0.7 * h) / Math.max(1, records.length - 1));
  records.forEach((n, i) => put(n.id, F.records, mid + (i - (records.length - 1) / 2) * rstep));
  // A rule and its quote take one band: the rule's line, then the quote's words (up to four lines).
  const rules = of('rule');
  const persons = of('person');
  const spare = F.narrow ? 70 * persons.length : 0;
  const band = Math.min(F.narrow ? 124 : 160, (0.7 * h - spare) / Math.max(1, rules.length));
  const top = mid - (band * rules.length + spare) / 2 + 12;
  rules.forEach((n, i) => {
    const y = top + band * i;
    put(n.id, F.rules, y);
    const q = g.edges.find((e) => e.kind === 'cites' && e.from === n.id);
    if (q) put(q.to, F.rules, y + 34);
  });
  const taken: number[] = [];
  persons.forEach((p, i) => {
    if (F.persons == null) return put(p.id, F.rules + 40 + i * 150, top + band * rules.length + 10);
    const ys = g.edges.filter((e) => e.kind === 'signed by' && e.to === p.id).map((e) => pos.get(e.from)?.y ?? 0);
    let y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : top;
    while (taken.some((t) => Math.abs(t - y) < 56)) y += 56;
    taken.push(y);
    put(p.id, F.persons, y);
  });
  // Anything else kept (an estimate, a site row, an office): under the lot, in a row.
  const rest = g.nodes.filter((n) => !pos.has(n.id));
  rest.forEach((n, i) => put(n.id, spread(rest.length, 0.3 * w, 0.62 * w, i), 0.88 * h));
  return pos;
}

// ─── Layout: fixed clusters ────────────────────────────────────────────────────────────────────

/** Where each cluster sits, as fractions of the canvas. The canvas reads the same table to place
 *  labels (left of the glyph for the left-hand clusters, right of it elsewhere) and headings. */
export const GRAPH_FRAME = {
  min: { w: 860, h: 500 },
  center: { x: 0.37, y: 0.47, w: 180 }, // w: the box is w + 16 px wide; its height follows its words
  neighbors: { x: 0.185, y0: 0.085, y1: 0.36 },
  sources: { x: 0.185, y0: 0.62, y1: 0.965 },
  rules: { x: 0.555, y0: 0.075, y1: 0.465 },
  quotes: { x: 0.81 },
  persons: { x: 0.92 },
  next: { x: 0.8, y0: 0.575, y1: 0.69 },
  site: { x: 0.605, y0: 0.72, y1: 0.965 },
  money: { x0: 0.405, y0: 0.64, x1: 0.505, y1: 0.93 },
} as const;

function spread(n: number, a: number, b: number, i: number): number {
  if (n <= 1) return (a + b) / 2;
  return a + ((b - a) * i) / (n - 1);
}
/** Rows in [a, b], but no farther apart than `max` px: short lists sit near the top of their band. */
function rows(n: number, a: number, b: number, i: number, max: number): number {
  if (n <= 1) return a + Math.min(max, b - a) / 2;
  const step = Math.min(max, (b - a) / (n - 1));
  return a + step * i;
}

export function layoutGraph(g: LotGraph, w: number, h: number): Map<string, { x: number; y: number }> {
  const F = GRAPH_FRAME;
  const pos = new Map<string, { x: number; y: number }>();
  const put = (id: string, x: number, y: number) => pos.set(id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  const of = (c: Cluster, t?: NodeType) => g.nodes.filter((n) => n.cluster === c && (!t || n.type === t));

  for (const n of of('center')) put(n.id, F.center.x * w, F.center.y * h);

  const col = (list: GraphNode[], x: number, y0: number, y1: number, max: number) => list.forEach((n, i) => put(n.id, x * w, rows(list.length, y0 * h, y1 * h, i, max)));
  col(of('neighbors'), F.neighbors.x, F.neighbors.y0, F.neighbors.y1, 44);
  col(of('sources'), F.sources.x, F.sources.y0, F.sources.y1, 36);
  col(of('site'), F.site.x, F.site.y0, F.site.y1, 40);
  col(of('next'), F.next.x, F.next.y0, F.next.y1, 26);

  // Rules: one row per rule, its quote beside it; each signer at the middle of the rules it signed.
  const rules = of('rules', 'rule');
  rules.forEach((n, i) => {
    const y = rows(rules.length, F.rules.y0 * h, F.rules.y1 * h, i, 34);
    put(n.id, F.rules.x * w, y);
  });
  for (const q of of('rules', 'quote')) {
    const rule = g.edges.find((e) => e.kind === 'cites' && e.to === q.id);
    const at = rule ? pos.get(rule.from) : undefined;
    put(q.id, F.quotes.x * w, at?.y ?? F.rules.y0 * h);
  }
  const persons = of('rules', 'person');
  const taken: number[] = [];
  persons.forEach((p) => {
    const ys = g.edges.filter((e) => e.kind === 'signed by' && e.to === p.id).map((e) => pos.get(e.from)?.y ?? 0);
    let y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : F.rules.y0 * h;
    while (taken.some((t) => Math.abs(t - y) < 46)) y += 46; // two signers never overlap
    taken.push(y);
    put(p.id, F.persons.x * w, y);
  });

  // Money: a staircase down and to the right, labels to the left of each mark, so every edge from the
  // lot reaches its node past the ones above it without crossing their labels.
  const money = [...of('money', 'estimate'), ...of('money', 'sale')];
  money.forEach((n, i) => put(n.id, spread(money.length, F.money.x0 * w, F.money.x1 * w, i), spread(money.length, F.money.y0 * h, F.money.y1 * h, i)));

  // Anything left (a cluster this table doesn't know) goes to the centre's corner, never at random.
  for (const n of g.nodes) if (!pos.has(n.id)) put(n.id, 12, 12);
  return pos;
}
