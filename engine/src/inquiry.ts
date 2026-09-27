// The inquiry: one short draft letter per office, each carrying only what that office needs, plus a
// checklist for the sender that is never sent. Templates fill in the facts from the engine result;
// questions come from the rule store's question_for_city fields and from open checks. Every number
// in a letter must appear in the engine output, or that letter's export is blocked (spec §10).
//
// Routing (verified against pittsburghpa.gov, Finance · Real Estate): City property sales go through
// the Department of Finance's Real Estate Division (a Request to Purchase form); zoning questions go
// to the Zoning Administrator; gap financing to the URA; a lot-area dispute to the County's Office of
// Property Assessments; the community meeting to the RCO.
import { evaluate } from './evaluate';
import { listAnd } from './format';
import { APPROVAL_LABEL, DEFAULT_SETTINGS, TEMPLATES } from './templates';
import { varianceWords, type VarianceContext } from './verdict';
import type { BlockFile, CityReference, EffectiveRule, LotResult, MoneyResult, Parcel, QuestionState, RuleSet, Settings, Trust } from './types';
import { siteUnknowns } from './verdict';

export interface InquiryItem {
  text: string;
  trust: Trust | 'struck' | 'estimate';
  cite?: string; // "§903.03.C" or "City-Owned Properties"
  ref?: string; // the record a non-§ citation opens, e.g. "record:<pin>:city"
}
export interface InquirySection {
  id: 'build' | 'lot' | 'money' | 'facts' | 'questions' | 'records' | 'site' | 'next' | 'struck' | 'assumptions' | 'not_assessed' | 'unrouted';
  heading: string;
  to?: string; // who the questions are for
  note?: string; // shown when there are no items
  items: InquiryItem[];
}
export interface NumberCheck {
  ok: boolean;
  unknown: string[];
  checked: number;
}

export type OfficeId = 'assessment' | 'real_estate' | 'zoning' | 'ura' | 'rco';

/** One letter to one office: its own To, the From placeholder, the date, the disclaimer and its own number check. */
export interface InquiryLetter {
  office: OfficeId;
  tab: string; // short name for the office picker
  to: string; // the addressee, in full
  about: string; // what this letter asks, in a few words
  subject: string;
  opening: string; // one framing sentence; no facts
  sections: InquirySection[];
  date: string;
  from: string;
  disclaimer: string;
  check: NumberCheck;
  markdown: string;
  text: string;
}

export interface Inquiry {
  title: string;
  subtitle: string;
  date: string;
  from: string;
  recipients: { who: string; why: string; office: OfficeId }[];
  letters: InquiryLetter[];
  /** The sender's checklist, never sent: what to check next (the lot view shows it too), site unknowns, set-aside rules, not assessed. */
  sections: InquirySection[];
  disclaimer: string;
  check: NumberCheck; // every letter and the checklist
  text: string; // the combined download, as plain text
  markdown: string; // the combined download: the checklist, then every letter
  refused: boolean;
}

/** The sender fills this in; 24×100 never writes as anyone. */
export const FROM_PLACEHOLDER = '[your name, organization and contact]';

export const DISCLAIMER =
  'Decision support, not legal, financial or zoning advice. The City of Pittsburgh interprets its own code. Draft prepared with 24×100 from public records; not sent automatically: you decide whether to send it.';

export const OFFICES: Record<Exclude<OfficeId, 'rco'>, { to: string; tab: string }> = {
  assessment: { to: 'Allegheny County Office of Property Assessments', tab: 'County assessments' },
  real_estate: { to: 'City of Pittsburgh, Department of Finance, Real Estate Division', tab: 'City Real Estate' },
  zoning: { to: 'Zoning Administrator, Department of City Planning, City of Pittsburgh', tab: 'Zoning Administrator' },
  ura: { to: 'Urban Redevelopment Authority of Pittsburgh', tab: 'URA' },
};

function cap(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function usd(n: number, round = 1000): string {
  const v = Math.round(n / round) * round;
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
}
function ft(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

// Quantities never end in these; a section-shaped number followed by one is a quantity, not a citation.
const UNIT_AHEAD = String.raw`(?!\d|\s*(?:ft\b|feet|foot|sf\b|sq|%|percent|stories|units?\b|spaces?\b|acres?\b))`;

/** Numbers that are names, not quantities: addresses, lot numbers, code sections, dates, PINs, ordinances and file numbers. */
function stripIdentifiers(s: string): string {
  return (
    s
      .replace(/24×100/g, '')
      // Code sections, with or without "§", "Section" or "Sec.": §925.06, 925.07, §915.02.A.1.c, §903.03.C.2(c).
      // Never after "$", a digit or a decimal point, and never followed by a unit.
      .replace(new RegExp(String.raw`(?<![\d$.,])§*\s?\d{3}\.\d{2}${UNIT_AHEAD}(?:\.[A-Za-z0-9]+)*(?:\([a-z0-9]+\))*`, 'g'), '')
      .replace(/\bCh(?:apter|\.)\s?\d+/g, '')
      .replace(/\b\d{4}[A-Z]\d{5}[A-Z0-9]{6}\b/g, '')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/\b\d{1,2} [A-Z][a-z]{2,8} \d{4}\b/g, '')
      .replace(/\b(?:Ord(?:inance)?\.?|Bill|File)(?:\s+No\.)?\s+\d[\d-]*/g, '')
      // Legislative file numbers: "2025-1579".
      .replace(new RegExp(String.raw`(?<![\d$.,])\b(?:19|20)\d{2}-\d{2,5}\b${UNIT_AHEAD}`, 'g'), '')
      .replace(/\bBlock [\dA-Z-]+/g, '')
      .replace(/\b\d+[A-Z]? (?:[NSEW]\.? )?(?:[A-Z][a-z]+ ){1,3}(?:St|Way|Ave|Street|Avenue|Rd|Road|Blvd|Pl|Place|Ter|Terrace|Dr|Drive|Ln|Lane|Ct|Court|Aly|Alley)\b/g, '')
      .replace(new RegExp(String.raw`\b[Ll]ots? \d+[A-Z]?(?:[–-]\d+)?(?:(?:, | and )\d+[A-Z]?${UNIT_AHEAD})*`, 'g'), '')
      .replace(/\bWard \d+/g, '')
      .replace(/\bFY\s?\d{4}/g, '')
      .replace(/\bplan lot \d+/gi, '')
      .replace(/\b(19|20)\d{2}\b/g, '')
  );
}

export function numbersIn(s: string): number[] {
  return [...stripIdentifiers(s).matchAll(/(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function allowedNumbers(r: LotResult, m: MoneyResult | null, rs: RuleSet, block: BlockFile, recorded: { quoted: string[]; alts: LotResult[] }): Set<number> {
  const s = new Set<number>([0, 1, 2, 3, 4, 100]);
  const add = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return;
    s.add(v);
    s.add(Math.round(v));
    s.add(Math.round(v * 10) / 10);
    s.add(Math.round(v / 100) * 100);
    s.add(Math.round(v / 1000) * 1000);
  };
  // The result, and the engine's own re-runs without a recorded City confirmation (the question it answered quotes both outcomes).
  for (const x of [r, ...recorded.alts]) {
    for (const meas of [x.width, x.depth, ...x.units.map((u) => u.width)]) if (meas) [meas.deed, meas.mapped, ...meas.terms.map((t) => t.value)].forEach(add);
    for (const c of x.checks) [c.required, c.available, c.shortfall, c.alternative?.available, c.available != null && c.unit === 'share' ? c.available * 100 : null].forEach(add);
    for (const y of x.relief) [y.from, y.to, ...numbersIn(y.text)].forEach(add); // the per-side values the engine wrote
    for (const c of x.checks) if (c.alternative) numbersIn(c.alternative.formula).forEach(add);
  }
  const P = r.scenario.proposal;
  [P.width, P.depth, P.stories, P.height, P.units, P.home_sqft, r.units.length].forEach(add);
  for (const rule of rs.rules) if (typeof rule.value === 'number') add(rule.value);
  if (m) {
    [m.gap?.lo, m.gap?.hi, ...(m.gap ? numbersIn(m.gap.formula) : []), m.homes, m.sqft, m.swing, m.site_work.lo, m.site_work.hi, m.with_assumptions.lo, m.with_assumptions.hi, m.comps.median, m.comps.q1, m.comps.q3, m.comps.count, m.affordable.price, m.affordable.income, m.affordable.household, m.new_build?.value].forEach(add);
    for (const e of m.estimates) [...e.psf, ...e.vertical, ...e.left, -e.left[0], -e.left[1]].forEach(add);
    [m.with_assumptions.soft * 100, m.with_assumptions.financing * 100, m.site_work.lo / 1000, m.site_work.hi / 1000, Math.round(m.swing / 1000)].forEach(add);
    for (const sig of [...m.context, ...(m.new_build ? [m.new_build] : [])]) numbersIn(sig.label).forEach(add);
  }
  [80, 30].forEach(add); // "80% AMI", "30% of income": definitions, not results
  if (r.refusal?.values) Object.values(r.refusal.values).forEach((v) => typeof v === 'number' && add(v));
  [25].forEach(add); // "25% slope or steeper" is the layer's definition
  // Record values the engine read for these lots (areas quoted in the lot-area check, deed dimensions).
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)).filter((p): p is NonNullable<typeof p> => !!p);
  for (const p of ps) [p.mapped_area, p.assess?.lotarea, p.deed ? p.deed.front * p.deed.depth : null, p.deed?.front, p.deed?.depth, p.slope25 * 100, p.undermined * 100].forEach(add);
  [ps.reduce((a, p) => a + p.mapped_area, 0), ps.reduce((a, p) => a + (p.assess?.lotarea ?? 0), 0), ps.reduce((a, p) => a + (p.deed ? p.deed.front * p.deed.depth : 0), 0), ps.reduce((a, p) => a + (p.deed?.front ?? 0), 0)].forEach(add);
  // A recorded City confirmation is quoted as it was recorded (who, reference); its numbers are the log's, not ours.
  for (const t of recorded.quoted) numbersIn(t).forEach(add);
  return s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2016-11-17" → "17 Nov 2016" in prose sent to people. */
export function humanDates(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`);
}
/** A logged time, as the calendar day in Pittsburgh. */
function dayOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return humanDates(d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
}

/** "a two-unit house", "a row of 3 attached houses". */
function buildingPhrase(type: string, homes: number): string {
  return type === 'row' ? `a row of ${homes} attached houses` : type === 'three' ? 'a three-unit house' : type === 'two' ? 'a two-unit house' : 'a detached house';
}

function lotRange(ps: { lot: number | null; lot_suffix?: string | null }[]): string {
  const n = ps.map((p) => p.lot ?? 0).sort((a, b) => a - b);
  return n.length > 1 ? `lots ${n[0]}–${n[n.length - 1]}` : `lot ${n[0]}${ps[0].lot_suffix ?? ''}`;
}
/** "lot 25", "lots 25 and 27". */
function lotList(ps: Parcel[]): string {
  const ns = ps.map((p) => `${p.lot ?? '?'}${p.lot_suffix ?? ''}`);
  return ns.length === 1 ? `lot ${ns[0]}` : `lots ${listAnd(ns)}`;
}
function lotName(p: Parcel): string {
  return p.lot != null ? `lot ${p.lot}${p.lot_suffix ?? ''}` : p.addr;
}
/** "2241 Mahon St (lot 25)"; "lot 26 on Mahon St" when the lot has no street number. */
function place(p: Parcel): string {
  if (p.addr.includes('(no number)')) return p.lot != null ? `${lotName(p)} on ${p.addr.replace(' (no number)', '')}` : p.addr.replace(' (no number)', '');
  return p.lot != null ? `${p.addr} (${lotName(p)})` : p.addr;
}

const rec = (p: Parcel, field: string) => `record:${p.pin}:${field}`;
const FOR_SALE = 'Available for Sale'; // the City inventory's status for a lot on offer

type Fact = { item: InquiryItem; ruleIds: string[] };

/** What the code and the records say about fitting the proposal: ink only, each with the rules it used. */
function codeFacts(r: LotResult, rs: RuleSet, ps: Parcel[], vctx: VarianceContext = {}): Fact[] {
  if (r.state !== 'ok') return [];
  const facts: Fact[] = [];
  const inkRule = (ids: string[]) => ids.map((id) => rs.rules.find((x) => x.id === id)).filter((x): x is EffectiveRule => !!x);
  const secs = (ids: string[]) => [...new Set(inkRule(ids).map((x) => `§${x.section}`))].join(', ');
  const W = r.width!;
  const wCheck = r.checks.find((c) => c.id === 'width')!;
  if (W.trust === 'ink' && wCheck.trust !== 'pencil')
    facts.push({
      item: { text: W.none ? `Buildable width as of right: none (${W.formula}, by the deed dimensions).` : `Buildable width as of right: ${W.formula} ft by the deed dimensions (${ft(W.mapped)} ft on the City map).`, trust: 'ink', cite: secs(W.rule_ids) },
      ruleIds: W.rule_ids,
    });
  if (r.depth && r.depth.trust === 'ink') facts.push({ item: { text: `Buildable depth as of right: ${r.depth.formula} ft.`, trust: 'ink', cite: secs(r.depth.rule_ids) }, ruleIds: r.depth.rule_ids });
  for (const c of r.checks) {
    if (['width', 'depth'].includes(c.id)) continue;
    // Code facts cite a rule; record-only checks (ownership, undermining) belong to other letters or the checklist.
    if (!c.rule_ids.length) continue;
    if (c.trust !== 'ink' || c.status === 'open' || c.status === 'needs_survey') continue;
    let text = humanDates(c.text.replace(/^Your /, 'Our '));
    if (c.id === 'grading' && ps.length > 1) text = `Share of each lot at 25% slope or steeper on the City's slope layer: ${slopeList(ps)}.`;
    const cite = secs(c.rule_ids) || (c.id === 'grading' ? 'City slope layer' : undefined);
    facts.push({ item: { text, trust: 'ink', cite: cite && !text.includes(cite) ? cite : undefined }, ruleIds: c.rule_ids });
  }
  for (const x of r.relief) {
    const needs = x.approval === 'variance' ? varianceWords(x.check === 'width' && x.text.startsWith('side setbacks'), vctx, r.district) : `${APPROVAL_LABEL[x.approval]} may be needed.`;
    facts.push({
      // The section is the rule the proposal falls short of (the setbacks), not the variance authority.
      item: { text: `It doesn't fit as of right: what we propose would need ${x.text} (the rule is §${x.section}). ${needs}`, trust: 'ink' },
      ruleIds: rs.rules.filter((y) => y.section === x.section).map((y) => y.id),
    });
  }
  return facts;
}

/** "lot 25: 53%, lot 26: 56% and lot 27: 42%", as the Site panel lists them. */
function slopeList(ps: Parcel[]): string {
  return listAnd(ps.map((p) => `${lotName(p)}: ${Math.round(p.slope25 * 100)}%`));
}

/** Which office a question is for, from its "ask" field. */
function officeFor(ask: string): OfficeId | null {
  if (/real estate/i.test(ask)) return 'real_estate';
  if (/zoning/i.test(ask)) return 'zoning';
  if (/urban redevelopment|\bURA\b/.test(ask)) return 'ura';
  if (/assessment/i.test(ask)) return 'assessment';
  if (/\bRCO\b|community/i.test(ask)) return 'rco';
  return null;
}

function recordedWords(by: string | null, role: string | null, at: string | null, answer: string, ref: CityReference | null): string {
  const who = by ? ` by ${by}${role ? ` (${role})` : ''}` : '';
  const when = at ? ` on ${dayOf(at)}` : '';
  const refw = ref ? ` (reference: ${[ref.who, ref.date ? humanDates(ref.date) : null, ref.text].filter(Boolean).join(', ')})` : '';
  return `Recorded in this app${who}${when}: ${answer}${refw}. Please confirm this is the City's reading.`;
}

function ruleValueWords(rule: EffectiveRule): string {
  const f = rule.field.replaceAll('_', ' ').replace(/ ft$/, '');
  const v = rule.value;
  if (typeof v === 'number') return `${f}: ${v.toLocaleString('en-US')}${rule.unit === 'ft' ? ' ft' : rule.unit === 'sf' ? ' sf' : rule.unit === 'stories' ? ' stories' : rule.unit === 'spaces_per_unit' ? ' spaces per unit' : ''}`;
  if (v === 'P') return `${f}: permitted by right`;
  if (v === 'N') return `${f}: not permitted`;
  if (typeof v === 'string') return `${f}: ${v === 'S' ? 'special exception' : v === 'SPR' ? 'site plan review' : v}`;
  return f;
}

/**
 * City confirmations recorded in this app, and the facts that rest on them. A confirmation drops the
 * question from the engine result; the letter keeps it, quotes the record and asks the City to confirm.
 * Which questions and facts are involved is found by re-running the engine with the confirmation removed:
 * a question that comes back is one it answered; a fact that disappears or changes rests on it.
 */
function recordedConfirmations(r: LotResult, block: BlockFile, rs: RuleSet, settings: Settings, ps: Parcel[], facts: Fact[]): { items: InquiryItem[]; rests: Set<string>; quoted: string[]; alts: LotResult[] } {
  const items: InquiryItem[] = [];
  const rests = new Set<string>();
  const quoted: string[] = [];
  const alts: LotResult[] = [];
  if (r.state !== 'ok') return { items, rests, quoted, alts };
  const rerun = (alt: RuleSet): LotResult | null => {
    try {
      const x = evaluate({ block, rs: alt, settings }, r.scenario);
      return x.state === 'ok' ? x : null;
    } catch {
      return null;
    }
  };
  for (const q of rs.questions.filter((x) => x.status === 'city_confirmed')) {
    const reopened: QuestionState = { ...q, status: 'open', choice: null, by: null, role: null, at: null, reference: null };
    const alt = { ...rs, questions: rs.questions.map((x) => (x === q ? reopened : x)) };
    const r0 = rerun(alt);
    if (!r0 || !r0.questions.some((x) => x.id === q.question.id) || r.questions.some((x) => x.id === q.question.id)) continue;
    alts.push(r0);
    const open = new Set(codeFacts(r0, alt, ps).map((f) => f.item.text));
    for (const f of facts) if (!open.has(f.item.text)) rests.add(f.item.text);
    const words = recordedWords(q.by, q.role, q.at, `the City confirmed the answer is ${q.choice ?? 'recorded without a choice'}`, q.reference);
    quoted.push(words);
    items.push({ text: `${q.question.question} ${words}`, trust: 'pencil', cite: q.question.section ? `§${q.question.section}` : undefined });
  }
  const sealed = rs.rules.filter((x) => x.sealed && x.question_for_city);
  if (sealed.length) {
    const alt = { ...rs, rules: rs.rules.map((x) => (x.sealed ? { ...x, sealed: false } : x)) };
    const r0 = rerun(alt);
    for (const rule of sealed) {
      const id = `q.rule.${rule.id}`;
      if (!r0 || !r0.questions.some((x) => x.id === id) || r.questions.some((x) => x.id === id)) continue;
      if (!alts.includes(r0)) alts.push(r0);
      for (const f of facts) if (f.ruleIds.includes(rule.id)) rests.add(f.item.text);
      const v = rule.verification;
      const words = recordedWords(v.reviewer, v.role, v.at, `the City confirmed our reading of §${rule.section} (${ruleValueWords(rule)})`, v.reference);
      quoted.push(words);
      items.push({ text: `${rule.question_for_city} ${words}`, trust: 'pencil', cite: `§${rule.section}` });
    }
  }
  return { items, rests, quoted, alts };
}

function tagFor(it: InquiryItem, sec: InquirySection): string {
  if (it.trust === 'red') return sec.id === 'build' ? '[our proposal] ' : '[our assumption] ';
  if (it.trust === 'estimate') return '[screening estimate] ';
  if (it.trust === 'struck') return '[set aside] ';
  // A question is open by being a question; elsewhere an open item says so.
  if (it.trust === 'pencil' && !['next', 'questions', 'records', 'unrouted'].includes(sec.id)) return '[open] ';
  return '';
}

const ORDERED = new Set<InquirySection['id']>(['questions', 'records', 'next', 'money']);

function sectionLines(sec: InquirySection): string[] {
  const lines = [`## ${sec.heading}`];
  if (!sec.items.length && sec.note) lines.push(sec.note);
  sec.items.forEach((it, i) => lines.push(`${ORDERED.has(sec.id) && sec.id !== 'money' ? `${i + 1}.` : '-'} ${tagFor(it, sec)}${it.text}${it.cite ? ` (${it.cite})` : ''}`));
  lines.push('');
  return lines;
}

function checkNumbers(texts: string[], allowed: Set<number>): NumberCheck {
  const unknown: string[] = [];
  let checked = 0;
  for (const t of texts)
    for (const n of numbersIn(t)) {
      checked++;
      if (!allowed.has(n)) unknown.push(`${n} in "${t.slice(0, 80)}…"`);
    }
  return { ok: unknown.length === 0, unknown, checked };
}

function checkedTexts(sections: InquirySection[]): string[] {
  return sections.flatMap((s) => s.items.filter((it) => it.trust !== 'struck').map((it) => it.text));
}

function letterFrom(
  office: OfficeId,
  head: { to: string; tab: string; about: string; subject: string; opening: string },
  sections: InquirySection[],
  date: string,
  allowed: Set<number>,
): InquiryLetter {
  const lines = [`# ${head.subject}`, `To: ${head.to}`, `From: ${FROM_PLACEHOLDER}`, `Date: ${humanDates(date)}`, '', head.opening, ''];
  for (const sec of sections) lines.push(...sectionLines(sec));
  const markdown = [...lines, `_${DISCLAIMER}_`].join('\n');
  const text = [...lines.map((l) => l.replace(/^#+ /, '')), DISCLAIMER].join('\n');
  const check = checkNumbers([head.subject, head.opening, ...checkedTexts(sections)], allowed);
  return { office, ...head, sections, date, from: FROM_PLACEHOLDER, disclaimer: DISCLAIMER, check, markdown, text };
}

export function buildInquiry(r: LotResult, block: BlockFile, rs: RuleSet, m: MoneyResult | null, date: string, settings: Settings = DEFAULT_SETTINGS, vctx: VarianceContext = {}): Inquiry {
  const tpl = TEMPLATES[r.scenario.type];
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!).sort((a, b) => (a.lot ?? 0) - (b.lot ?? 0));
  const P = r.scenario.proposal;
  const cityLots = ps.filter((p) => p.city);
  const others = ps.filter((p) => !p.city);
  const rco = (ps[0].overlays ?? []).find((o) => o.startsWith('RCO'))?.replace(/^RCO - /, '');
  const homes = r.scenario.type === 'row' ? r.units.length : P.units;
  const phrase = buildingPhrase(r.scenario.type, homes);
  const homesWords = `${homes} home${homes === 1 ? '' : 's'}`;
  const where = `${listAnd(ps.map(place))}, ${block.meta.neighborhood}`;
  const street = ps.find((p) => p.addr_street)?.addr_street ?? block.meta.main_street;
  const blockName = block.meta.name.replace(/\s*\(.*\)$/, '');
  const groupName = ps.length > 1 ? `${lotRange(ps)} on ${street}, ${blockName}` : place(ps[0]);
  const refused = r.state === 'refused';
  const disagree = r.refusal?.code === 'records_disagree';

  // ── Facts and questions, before they are split into letters ─────────────────────────────────
  const facts = codeFacts(r, rs, ps, vctx);
  const confirmed = recordedConfirmations(r, block, rs, settings, ps, facts);
  const allowed = allowedNumbers(r, m, rs, block, confirmed);
  [vctx.stuck?.n, vctx.street?.same, vctx.street?.of].forEach((v) => v != null && allowed.add(v)); // counts the variance line cites
  const zaFacts: InquiryItem[] = facts.map((f) => (confirmed.rests.has(f.item.text) ? { ...f.item, text: `${f.item.text} This rests on a City confirmation recorded in this app, quoted with the questions below; we ask you to confirm it.` } : f.item));

  const routed: Record<OfficeId, InquiryItem[]> = { assessment: [], real_estate: [], zoning: [], ura: [], rco: [] };
  const unrouted: InquiryItem[] = [];
  const gradingOpen = r.checks.some((c) => c.id === 'grading' && c.status === 'open');
  for (const q of r.questions) {
    const office = officeFor(q.ask) ?? (q.id.startsWith('q.rule') || q.section ? 'zoning' : null);
    if (office === 'zoning' && /grading|slope/i.test(q.id) && gradingOpen) continue; // asked once, below
    const item: InquiryItem = { text: humanDates(q.text), trust: q.trust === 'red' ? 'red' : 'pencil', cite: q.section ? `§${q.section}` : undefined };
    if (office) routed[office].push(item);
    else unrouted.push({ ...item, text: `${item.text} (for: ${q.ask})` });
  }
  const za = routed.zoning;
  const ruleOf = (c: { rule_ids: string[] }) => c.rule_ids.map((id) => rs.rules.find((x) => x.id === id)).find(Boolean);
  for (const c of r.checks) {
    if (!(c.trust === 'pencil' && (c.status === 'open' || c.status === 'needs_survey') && c.id !== 'width')) {
      if (c.id === 'contextual' && c.trust === 'pencil') za.push({ text: `${humanDates(c.text).replace(/\s*\(§[^)]+\)\.?$/, '.').replace(/,? so this stays pencil/, '')} Can a contextual side setback be used here, and what evidence of the neighbor's setback do you accept?`, trust: 'pencil', cite: '§925.06.C' });
      continue;
    }
    const rule = ruleOf(c);
    if (c.id === 'use') {
      za.push({
        text: rule ? `Our unchecked reading of the use table says ${phrase} is ${String(rule.value) === 'P' ? 'permitted by right' : 'not permitted by right'} in ${r.district}. Is that right?` : `Is ${phrase} permitted by right in ${r.district}?`,
        trust: 'pencil',
        cite: '§911.02',
      });
    } else if (c.id === 'parking') {
      za.push({
        text:
          c.required != null && c.required > 0
            ? `Our unchecked reading is that ${c.required} parking space${c.required === 1 ? '' : 's'} would be required; we haven't checked that they fit. What is required here, and can relief be granted on a lot this size?`
            : 'What parking is required here, and can relief be granted on a lot this size?',
        trust: 'pencil',
        cite: '§914.02.A',
      });
    } else if (c.id === 'grading') {
      const share = ps.length > 1 ? `On the City's slope layer, the share of each lot at 25% slope or steeper is ${slopeList(ps)}. ` : c.available != null ? `About ${Math.round(c.available * 100)}% of the lot is 25% slope or steeper on the City's slope layer. ` : '';
      za.push({ text: `${share}Does grading review or a geotechnical report apply to building here?`, trust: 'pencil', cite: rule ? `§${rule.section}` : '§915.02.A' });
    } else if (c.id === 'area') {
      za.push({ text: 'The deed and the County assessment fall on different sides of the minimum lot size. Which governs, and would a survey settle it?', trust: 'pencil' });
    }
    // Undermining is not a code question: it stays in the checklist and the site section.
  }
  za.push(...confirmed.items);
  const variances = r.relief.filter((x) => x.approval === 'variance');
  if (variances.length)
    za.push({
      text: `If a variance from the Zoning Board of Adjustment is the route for ${listAnd(variances.map((x) => x.text))}, what would you need to see from us before we apply?`,
      trust: 'pencil',
      cite: [...new Set(variances.map((x) => `§${x.section}`))].join(', '),
    });

  // ── The letters ─────────────────────────────────────────────────────────────────────────────
  const letters: InquiryLetter[] = [];
  const proposal: InquiryItem = {
    text: `${cap(phrase)} (${homesWords}): ${r.scenario.type === 'row' ? `houses ${ft(P.width)} ft wide` : `a building ${ft(P.width)} ft wide`}, ${ft(P.depth)} ft deep, ${P.stories} stories and ${ft(P.height)} ft tall. This is our proposal, not a requirement.`,
    trust: 'red',
  };

  // County Office of Property Assessments: only when the records disagree.
  if (disagree) {
    const v = r.refusal?.values ?? {};
    const p = ps[0];
    letters.push(
      letterFrom(
        'assessment',
        { ...OFFICES.assessment, about: 'the assessed lot area', subject: `Records question: lot area of ${place(p)}`, opening: 'The County assessment and the City’s parcel map disagree about this lot’s size, and we would like to know which is right before we go further.' },
        [
          {
            id: 'facts',
            heading: 'What the records say',
            items: [{ text: `The County assessment says ${Number(v.assessed).toLocaleString('en-US')} sf and the City's parcel map measures ${Number(v.mapped).toLocaleString('en-US')} sf, more than the difference we can work with.`, trust: 'ink', cite: 'County assessment; City parcel map', ref: rec(p, 'lotarea') }],
          },
          {
            id: 'records',
            heading: 'Our questions',
            to: OFFICES.assessment.to,
            items: [
              { text: `Which lot area is right for ${place(p)}? We can’t check the zoning rules until the records agree.`, trust: 'pencil' },
              { text: `Is there a recorded survey, deed plan or subdivision plan for this parcel (PIN ${p.pin}) that shows its dimensions?`, trust: 'pencil' },
              { text: 'If the assessed lot area is out of date, how do we ask for it to be corrected?', trust: 'pencil' },
              ...routed.assessment,
            ],
          },
        ],
        date,
        allowed,
      ),
    );
  }

  // City Real Estate: only when the group has City-owned lots. Status, price, process and timeline; no cost figures.
  if (cityLots.length) {
    const lotsW = cityLots.length === 1 ? place(cityLots[0]) : listAnd(cityLots.map(place));
    const recordItems: InquiryItem[] = cityLots.map((p) => ({
      text: `${cap(place(p))}, parcel ID ${p.pin}: City-owned, ${p.city!.status}${p.city!.status_updated ? `; the City's inventory last updated this status on ${humanDates(p.city!.status_updated)}` : ''}.`,
      trust: 'ink',
      cite: 'City-Owned Properties',
      ref: rec(p, 'city'),
    }));
    for (const p of others)
      recordItems.push({
        text: `${cap(place(p))} is not in the City's inventory (County owner type: ${(p.assess?.ownercat ?? 'unknown').toLowerCase()}), so we are not asking you about it; we will look up its owner in Allegheny County's public real-estate records.`,
        trust: 'ink',
        cite: 'County assessment',
        ref: rec(p, 'city'),
      });
    const status = routed.real_estate;
    const qs: InquiryItem[] = [
      ...status,
      // The engine asks about stale or unusual statuses; when it didn't (or couldn't: a refused lot), ask here.
      ...(status.length
        ? []
        : [
            ...cityLots.filter((p) => p.city!.status !== FOR_SALE).map((p) => ({ text: `${cap(place(p))} is listed as "${p.city!.status}". Could it be offered for sale?`, trust: 'pencil' as const })),
            ...(cityLots.some((p) => p.city!.status === FOR_SALE)
              ? [{ text: `Is ${cityLots.length === 1 ? 'it' : listAnd(cityLots.filter((p) => p.city!.status === FOR_SALE).map(place))} still available for sale, and is anything pending?`, trust: 'pencil' as const }]
              : []),
          ]),
      { text: `How is the price set for ${lotsW}, and when in the process would we learn it?`, trust: 'pencil' },
      {
        text: `We understand a purchase starts with the Real Estate Division's Request to Purchase form. What are the steps after that, and how long does it usually take from application to closing, including City Council's approval?`,
        trust: 'pencil',
        cite: 'Request to Purchase form; City Code Chapter 452',
      },
      ...(cityLots.length > 1 ? [{ text: `Can ${lotList(cityLots)} be bought together, on one Request to Purchase form and in one sale?`, trust: 'pencil' as const }] : []),
      ...(disagree ? [{ text: `The County assessment and the City's parcel map disagree about the size of ${place(ps[0])}. Does the City hold a survey or deed plan for it?`, trust: 'pencil' as const }] : []),
    ];
    letters.push(
      letterFrom(
        'real_estate',
        {
          ...OFFICES.real_estate,
          about: 'sale status, price, process and timeline',
          subject: `Buying City-owned land: ${lotsW}`,
          opening: 'We would like to ask about buying the City-owned land below.',
        },
        [
          { id: 'build', heading: 'What we are exploring', items: [{ text: `${cap(phrase)} (${homesWords}) on ${where}.`, trust: 'red' }] },
          { id: 'facts', heading: 'What the City’s records say', items: recordItems },
          { id: 'questions', heading: 'Our questions', to: OFFICES.real_estate.to, items: qs },
        ],
        date,
        allowed,
      ),
    );
  }

  // Zoning Administrator: a request for a determination on the open code questions only. No money, no practitioner quotes.
  if (!refused && za.length) {
    const deeds = ps.every((p) => p.deed);
    const same = deeds && ps.every((p) => p.deed!.front === ps[0].deed!.front && p.deed!.depth === ps[0].deed!.depth);
    const dims = !deeds
      ? `the City map measures ${listAnd(ps.map((p) => `${ps.length > 1 ? `${lotName(p)}: ` : ''}${Math.round(p.mapped_area).toLocaleString('en-US')} sf`))}; the County legal description gives no deed dimensions`
      : same
        ? `${ps.length > 1 ? 'each ' : ''}${ps[0].deed!.front} × ${ps[0].deed!.depth} ft by deed${ps.length > 1 ? `, ${ps.reduce((a, p) => a + p.deed!.front, 0)} ft of frontage together` : ''}`
        : `${listAnd(ps.map((p) => `${lotName(p)}: ${p.deed!.front} × ${p.deed!.depth} ft`))} by deed`;
    const red = za.filter((q) => q.trust === 'red');
    letters.push(
      letterFrom(
        'zoning',
        {
          ...OFFICES.zoning,
          about: 'a zoning determination on the open code questions',
          subject: `Request for a zoning determination: ${phrase} ${ps.length > 1 ? 'on' : 'at'} ${groupName}`,
          opening: 'We would like a zoning determination on the open questions below, for the proposal described here, before we go further.',
        },
        [
          { id: 'lot', heading: 'The site', items: [{ text: `${where}. Zoned ${r.district}. Lot size: ${dims}.`, trust: 'ink', cite: 'County assessment (legal description); City zoning map', ref: rec(ps[0], 'deed') }] },
          { id: 'build', heading: 'What we propose', items: [proposal] },
          { id: 'facts', heading: 'What the code and the records say', note: 'Nothing checked in ink yet: every reading below is still open.', items: zaFacts },
          { id: 'questions', heading: 'Questions for the Zoning Administrator', to: OFFICES.zoning.to, items: za },
          ...(red.length
            ? [{ id: 'assumptions' as const, heading: 'Our assumptions', items: red.map((q) => ({ text: `We explored an answer to an open question, but we are not relying on it: ${q.text}`, trust: 'red' as const })) }]
            : []),
        ],
        date,
        allowed,
      ),
    );
  } else if (refused && !disagree) {
    const p = ps[0];
    letters.push(
      letterFrom(
        'zoning',
        { ...OFFICES.zoning, about: 'which record to rely on', subject: `Records question: ${place(p)}`, opening: 'We could not check this lot against the zoning rules yet and would like to know which record to rely on.' },
        [
          { id: 'facts', heading: 'What the records say', items: [{ text: `We could not check this lot against the zoning rules yet: ${r.refusal?.reason ?? ''}`, trust: 'ink' }] },
          { id: 'records', heading: 'Our questions', to: OFFICES.zoning.to, items: [{ text: `Which record should we rely on to settle it for ${place(p)}?`, trust: 'pencil' }] },
        ],
        date,
        allowed,
      ),
    );
  }

  // URA: the money screen and the gap question. Programs are not named: we haven't verified which fit.
  if (!refused && m) {
    const moneyItems: InquiryItem[] = [];
    const u = (n: number) => usd(n, 100);
    if (m.new_build) {
      moneyItems.push({ text: `What a new home here sells for: ${m.new_build.label}, ${usd(m.new_build.value)} (${m.new_build.note}).`, trust: 'ink' });
      for (const e of m.estimates) {
        const left = e.left[0] < 0 ? null : e.left[1] < 0 ? `at most ${u(e.left[0])}` : e.left[0] === e.left[1] ? u(e.left[0]) : `${u(e.left[1])}–${u(e.left[0])}`;
        const who = e.supplied_by.replace(/, unconfirmed$/, '');
        moneyItems.push({
          text: `${e.label}: ${e.psf[0] === e.psf[1] ? `about $${e.psf[0]}` : `$${e.psf[0]}–$${e.psf[1]}`} per sq ft × ${m.sqft.toLocaleString('en-US')} sq ft = ${e.vertical[0] === e.vertical[1] ? u(e.vertical[0]) : `${u(e.vertical[0])}–${u(e.vertical[1])}`} per home, ${left ? `which leaves ${left} for site work, soft costs and land` : 'more than that sale: nothing is left for site work, soft costs and land'}. Estimate from ${who}, unconfirmed. ${e.note}`,
          trust: 'estimate',
        });
      }
      moneyItems.push({ text: `Site work for a single unit typically runs ${u(m.site_work.lo)}–${u(m.site_work.hi)} (${m.site_work.supplied_by.replace(/ \([^)]*\)/, '')}). That is not a cap: fill, soil or deep lines can cost far more.`, trust: 'estimate' });
      for (const c of m.context) moneyItems.push({ text: `${c.label}: ${usd(c.value)} (${c.note}).`, trust: c.evidence === 'red' ? 'red' : 'ink' });
      moneyItems.push({ text: `These are screening estimates from a practitioner at the hackathon. Costs vary a lot with builder size, so a builder's price for this building would settle it; the estimate's own range moves what's left by ${u(m.swing)} per home.`, trust: 'estimate' });
    } else moneyItems.push({ text: 'Not assessed: no recent new-build sale in this ward to compare with.', trust: 'ink' });
    letters.push(
      letterFrom(
        'ura',
        {
          ...OFFICES.ura,
          about: 'gap financing for small for-sale infill',
          subject: `Gap financing for small for-sale infill: ${homesWords} ${ps.length > 1 ? 'on' : 'at'} ${groupName}`,
          opening: 'We are screening whether small for-sale infill can work on this site and would like to ask which gap financing might fit.',
        },
        [
          { id: 'build', heading: 'What we are exploring', items: [{ text: `${cap(phrase)} on ${where}: ${homesWords} for sale, about ${m.sqft.toLocaleString('en-US')} sq ft${homes === 1 ? '' : ' each'}. This is our proposal, not a requirement.`, trust: 'red' }] },
          { id: 'money', heading: 'The money screen (screening estimates)', items: moneyItems },
          {
            id: 'assumptions',
            heading: 'Our assumptions',
            items: [
              {
                text: `Soft costs (${Math.round(m.with_assumptions.soft * 100)}%) and financing (${Math.round(m.with_assumptions.financing * 100)}%) are our assumptions and are left out of what's left; with them, construction at the practitioner's estimate comes to ${usd(m.with_assumptions.lo, 100)}–${usd(m.with_assumptions.hi, 100)} per home, still without site work or land.`,
                trust: 'red',
              },
              ...(m.gap
                ? [
                    {
                      text: `So our screening estimate of the subsidy each home would need, before land, is ${usd(m.gap.lo, 100)}–${usd(m.gap.hi, 100)}: ${m.gap.formula}. It rests on the practitioner's cost estimate, typical site work and our assumptions above; a builder's price would replace it.`,
                      trust: 'red' as const,
                    },
                  ]
                : []),
            ],
          },
          {
            id: 'questions',
            heading: 'Our questions',
            to: OFFICES.ura.to,
            items: [
              { text: `Which of your gap-financing programs fit small for-sale infill like this (${homesWords})?`, trust: 'pencil' },
              { text: 'What would you need to see from us to talk about it: for example a builder’s price, site studies, or the buyers’ income limits?', trust: 'pencil' },
              ...routed.ura,
            ],
          },
        ],
        date,
        allowed,
      ),
    );
  }

  // The RCO: very short. The proposal, where it is, and a request to present. No money, no code arguments.
  if (!refused && rco)
    letters.push(
      letterFrom(
        'rco',
        {
          to: `${rco} (Registered Community Organization)`,
          tab: 'Community (RCO)',
          about: 'presenting at a community meeting',
          subject: `Asking to present at a community meeting: ${phrase} ${ps.length > 1 ? 'on' : 'at'} ${groupName}`,
          opening: 'We are at an early stage and would like to hear from the community before choosing a design.',
        },
        [
          { id: 'build', heading: 'What we are exploring', items: [{ text: `${cap(phrase)} (${homesWords}) on ${where}. Nothing is designed or decided yet.`, trust: 'red' }] },
          {
            id: 'questions',
            heading: 'Our request',
            to: rco,
            items: [{ text: 'Could we present this idea at one of your community meetings and hear what neighbors want? When is the next one, and how do we get on the agenda?', trust: 'pencil' }, ...routed.rco],
          },
        ],
        date,
        allowed,
      ),
    );

  // ── The sender's checklist (not sent) ───────────────────────────────────────────────────────
  const checklist: InquirySection[] = [];
  // What to check next, in order (spec §0.13 C13): free and decisive first, paid only if the numbers leave room.
  const next: InquiryItem[] = [];
  const cityNames = cityLots.map((p) => p.addr.replace(' (no number)', ` (lot ${p.lot})`));
  const cityQ = routed.real_estate.map((q) => q.text);
  next.push({
    text: `Free: City Real Estate and the URA. ${cityNames.length ? `What would the City ask for ${listAnd(cityNames)}, and what are the process and timeline? ` : ''}${cityQ.join(' ')}${cityQ.length ? ' ' : ''}${
      others.length
        ? `Look up the owner of ${listAnd(others.map(lotName))} (County owner type: ${others.map((p) => (p.assess?.ownercat ?? 'unknown').toLowerCase()).join(', ')}) in Allegheny County's public real-estate records (this app doesn't store owner names), and ask whether they would sell. `
        : ''
    }This changes the decision if a lot can't be had or the price eats what's left.`,
    trust: 'pencil',
  });
  next.push({
    text: `Free or cheap, and decisive: a builder's price for this building, or recent City and County building-permit valuations. Costs vary a lot with builder size (a practitioner at the hackathon), so this is the check that decides whether anything is left.`,
    trust: 'pencil',
  });
  next.push({ text: 'Free: the undermining maps and environmental records. These can stop a deal early; check them before paying for anything.', trust: 'pencil' });
  next.push({
    text: `Low cost: the Zoning Administrator, by letter or a pre-application meeting, with the open code questions. This changes the decision if the reading of the rules changes what fits${r.relief.length ? ' or whether a variance is realistic' : ''}.`,
    trust: 'pencil',
  });
  next.push({ text: 'Paid, and only if the numbers leave room: a Phase I Environmental Site Assessment, a geotechnical investigation or test pits (for fill), and utility location and depth.', trust: 'pencil' });
  checklist.push({ id: 'next', heading: 'What to check next, in order', items: next });

  // Site: not assessed, could change the decision. No dollar amounts.
  checklist.push({
    id: 'site',
    heading: 'Site: not assessed, and it could change the decision',
    items: siteUnknowns(r, block).map((row) => ({ text: `${row.label}${/[.?!]$/.test(row.label) ? '' : '.'} ${row.signals.join(' ')} What resolves it: ${row.resolves} (cost: ${row.cost}).`, trust: 'ink' as const })),
  });
  if (unrouted.length) checklist.push({ id: 'unrouted', heading: 'Open questions we couldn’t route to an office', items: unrouted });
  const struck = rs.rules
    .filter((x) => x.state === 'struck')
    .map((x) => ({ text: `${x.field.replaceAll('_', ' ')}: "${x.quote.slice(0, 120)}${x.quote.length > 120 ? '…' : ''}" (struck by ${x.history.filter((h) => h.action === 'struck').slice(-1)[0]?.reviewer ?? 'a reviewer'})`, trust: 'struck' as const, cite: `§${x.section}` }));
  checklist.push({ id: 'struck', heading: 'Checked and set aside', items: struck.length ? struck : [{ text: 'Nothing struck yet.', trust: 'ink' }] });
  checklist.push({
    id: 'not_assessed',
    heading: 'Not assessed',
    items: [
      { text: 'Title, liens and back taxes. Soil, environmental, water and sewer: see the site section above.', trust: 'ink' },
      { text: `Community priorities: bring this to the Registered Community Organization${rco ? ` (${rco})` : ''} before choosing a design.`, trust: 'ink' },
    ],
  });

  const title =
    ps.length > 1
      ? `${tpl.name} on ${lotRange(ps)}, ${street} (${block.meta.name})`
      : `${tpl.name} at ${ps[0].addr.replace(' (no number)', '')} (lot ${ps[0].lot}${ps[0].lot_suffix ?? ''}, ${block.meta.name})`;
  const subtitle = `${block.meta.name}, ${block.meta.neighborhood} · ${r.district ?? 'district unknown'} · draft ${date}`;
  const intro = `${letters.length} draft letter${letters.length === 1 ? '' : 's'}, one per office. Nothing has been sent: you decide whether and where to send each one.`;
  const head = [`# ${title}`, subtitle, '', intro, '', `Letters: ${letters.map((l) => `${l.to} (${l.about})`).join('; ')}`, ''];
  const cover = [...head, '# Your checklist (not sent)', '', ...checklist.flatMap(sectionLines)];
  const markdown = [...cover, ...letters.flatMap((l) => ['---', '', l.markdown, ''])].join('\n').trimEnd();
  const text = [...cover.map((l) => l.replace(/^#+ /, '')), ...letters.flatMap((l) => ['---', '', l.text, ''])].join('\n').trimEnd();
  const own = checkNumbers([title, subtitle, intro, ...checkedTexts(checklist)], allowed);
  const check: NumberCheck = {
    ok: own.ok && letters.every((l) => l.check.ok),
    unknown: [...own.unknown.map((u) => `${u} (your checklist)`), ...letters.flatMap((l) => l.check.unknown.map((u) => `${u} (${l.tab})`))],
    checked: own.checked + letters.reduce((a, l) => a + l.check.checked, 0),
  };
  return {
    title,
    subtitle,
    date,
    from: FROM_PLACEHOLDER,
    recipients: letters.map((l) => ({ who: l.to, why: l.about, office: l.office })),
    letters,
    sections: checklist,
    disclaimer: DISCLAIMER,
    check,
    text,
    markdown,
    refused,
  };
}
