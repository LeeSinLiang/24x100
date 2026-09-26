// The review log's shared checks, used by the review screen (import, "Send to the steward") and by
// scripts/check-reviews.ts (the steward's publish step), so the browser and the publish step apply the
// same rules. Pure: no React and no bundler globals, so Node runs it too (hence the relative imports).
// The engine's auditProblems is the base; this adds what needs the rule store and the saved code text.
import { AI_ROLE, auditProblems, effectiveRule } from '../../../../engine/src/rules';
import { checkQuote, normalizeWs } from '../../../../engine/src/source';
import type { AuditEntry, CityReference, EffectiveRule, Question, Rule } from '../../../../engine/src/types';

export const ACTIONS = ['source_checked', 'struck', 'assumed', 'city_confirmed', 'reopened'] as const;

/** A published entry may carry this when a person published it despite a flag (--allow-flagged). */
export type PublishedEntry = AuditEntry & { flags_accepted_at?: string };

/** Structural checks the engine's auditProblems doesn't make (it assumes a well-formed entry). */
export function shapeProblems(x: unknown): string[] {
  if (!x || typeof x !== 'object') return ['not an object'];
  const e = x as Record<string, unknown>;
  const p: string[] = [];
  if (typeof e.id !== 'string' || !e.id.trim()) p.push('no id');
  if (!ACTIONS.includes(e.action as (typeof ACTIONS)[number])) p.push(`unknown action "${String(e.action)}"`);
  for (const k of ['rule_id', 'question_id'] as const) if (e[k] != null && typeof e[k] !== 'string') p.push(`${k} must be text or null`);
  for (const k of ['reviewer', 'role', 'reason', 'at'] as const) if (e[k] != null && typeof e[k] !== 'string') p.push(`${k} must be text`);
  if (e.reference != null && typeof e.reference !== 'object') p.push('reference must be an object or null');
  return p;
}

export function withDefaults(x: Partial<PublishedEntry>): PublishedEntry {
  const e: PublishedEntry = {
    id: String(x.id),
    rule_id: x.rule_id ?? null,
    question_id: x.question_id ?? null,
    at: String(x.at ?? ''),
    reviewer: String(x.reviewer ?? ''),
    role: String(x.role ?? ''),
    action: x.action!,
    quote: x.quote ?? '',
    decision: x.decision ?? '',
    reason: String(x.reason ?? ''),
    choice: x.choice ?? null,
    reference: x.reference ?? null,
  };
  if (typeof x.flags_accepted_at === 'string') e.flags_accepted_at = x.flags_accepted_at;
  return e;
}

/** The entries of an exported log: { "entries": [...] } or a bare list; null for anything else. */
export function entriesOf(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  const e = (json as { entries?: unknown } | null)?.entries;
  return Array.isArray(e) ? e : null;
}

// ─── City confirmations: a reference someone else can look up ──────────────────────────────────

export const REFERENCE_KINDS = { letter: 'Letter', email: 'Email', case: 'Case', ticket: 'Ticket' } as const;
export type ReferenceKind = keyof typeof REFERENCE_KINDS;

/** The stored reference text: "Letter: <subject or sender>", "Email: …", "Case <number>", "Ticket <number>". */
export function composeReference(kind: ReferenceKind, detail: string): string {
  const d = detail.trim();
  return kind === 'letter' || kind === 'email' ? `${REFERENCE_KINDS[kind]}: ${d}` : `${REFERENCE_KINDS[kind]} ${d}`;
}

/** A YYYY-MM-DD date that exists on the calendar, as a UTC timestamp; NaN otherwise. */
export function calendarDate(s: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim());
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : NaN;
}

const DAY = 24 * 3600 * 1000;

/** A City confirmation must point at something another person can look up: a dated letter or email,
 *  or a case or ticket number. "Phone call" or a bare name is not a reference. */
export function cityReferenceProblems(ref: CityReference | null | undefined, now = Date.now()): string[] {
  if (!ref) return ['a City confirmation needs a reference'];
  const p: string[] = [];
  const text = (ref.text ?? '').trim();
  const isDocument = /\b(letter|e-?mail)\b/i.test(text) && text.replace(/\b(letter|e-?mail)\b[:\s]*/i, '').trim().length > 0;
  const numbered = /\b(case|ticket)\b\D{0,16}\d/i.test(text);
  if (!isDocument && !numbered) p.push('the reference must be a letter or an email (with its date), or a case or ticket number');
  const t = calendarDate(ref.date);
  if (Number.isNaN(t)) p.push('the reference date must be a real date (YYYY-MM-DD)');
  else if (t > now + DAY) p.push('the reference date is in the future');
  if (!(ref.who ?? '').trim()) p.push('who at the City is required');
  return p;
}

// ─── Flags: publishable only after a person has looked (--allow-flagged) ───────────────────────

export const PLACEHOLDER = /placeholder|test|replace|lorem|example/i;

/** Reasons to stop and look before publishing. Not errors: a person may override them. */
export function publishFlags(e: AuditEntry): string[] {
  const out: string[] = [];
  const named: [string, string | null | undefined][] = [
    ['reviewer', e.reviewer],
    ['role', e.role],
    ['City contact', e.reference?.who],
  ];
  for (const [label, v] of named) if (v && PLACEHOLDER.test(v)) out.push(`${label} "${v}" looks like a placeholder or a test`);
  if ((e.role ?? '').trim() === AI_ROLE) out.push(`signed as "${AI_ROLE}": an AI check, not a person's review`);
  if (e.action === 'assumed') out.push('an assumption (red): published, every visitor would see the numbers turn red');
  return out;
}

// ─── One entry against the rule store ──────────────────────────────────────────────────────────

export interface Store {
  rules: Map<string, Rule>;
  questions: Map<string, Question>;
  /** The saved code text for a rule's source_file, or null when it isn't available. */
  codeFor: (file: string) => string | null;
}

export interface EntryCheck {
  errors: string[];
  warnings: string[];
  flags: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Everything wrong with one entry. `incoming` entries (not yet published) are held to the rule store
 *  strictly; for entries already published, a rule that has since changed is a warning, not a failure. */
export function checkEntry(raw: unknown, store: Store, opts: { incoming: boolean; now?: number }): EntryCheck & { entry: PublishedEntry | null } {
  const now = opts.now ?? Date.now();
  const shape = shapeProblems(raw);
  if (shape.length) return { entry: null, errors: shape, warnings: [], flags: [] };
  const e = withDefaults(raw as Partial<PublishedEntry>);
  const errors = [...auditProblems(e)];
  const warnings: string[] = [];
  const later = (msg: string) => (opts.incoming ? errors : warnings).push(msg);

  if (e.at && !Number.isNaN(Date.parse(e.at))) {
    if (!ISO.test(e.at)) errors.push(`time "${e.at}" is not an ISO 8601 timestamp with a time zone`);
    else if (Date.parse(e.at) > now + DAY) errors.push(`time ${e.at} is in the future`);
  }
  if (e.action === 'city_confirmed') for (const p of cityReferenceProblems(e.reference, now)) errors.push(p);

  const subject: { section: string; quote: string; source_file: string; what: string } | null = e.rule_id
    ? (() => {
        const r = store.rules.get(e.rule_id!);
        return r ? { section: r.section, quote: r.quote, source_file: r.source_file, what: `rule ${r.id}` } : null;
      })()
    : e.question_id
      ? (() => {
          const q = store.questions.get(e.question_id!);
          return q ? { section: q.section, quote: q.quote, source_file: q.source_file, what: `question ${q.id}` } : null;
        })()
      : null;
  if (e.rule_id && !subject) later(`rule "${e.rule_id}" is not in the rule store`);
  if (!e.rule_id && e.question_id && !subject) later(`question "${e.question_id}" is not in data/rules/questions.json`);

  if (subject) {
    const quote = e.quote.trim();
    if (!quote) {
      if (e.action === 'source_checked') later(`no quote recorded: a source check must say which words were checked`);
    } else {
      if (normalizeWs(quote) !== normalizeWs(subject.quote)) later(`the quote in this entry differs from the ${subject.what}'s quote now: the rule changed after it was reviewed`);
      const text = store.codeFor(subject.source_file);
      if (text == null) warnings.push(`no saved code text for ${subject.source_file}: quote not checked`);
      else {
        const c = checkQuote(text, subject.section, quote);
        if (!c.ok) later(`the quote no longer passes against the saved code text (§${subject.section}): ${c.reason}`);
      }
    }
  }
  const flags = e.flags_accepted_at ? [] : publishFlags(e);
  return { entry: e, errors, warnings, flags };
}

// ─── A whole log ───────────────────────────────────────────────────────────────────────────────

export interface ImportReport {
  accepted: PublishedEntry[];
  duplicates: number;
  rejected: { id: string; why: string }[];
}

/** The in-app import: each entry validated with the engine's auditProblems (and, for a City
 *  confirmation, a real reference) before it is merged; entries already in the log are skipped. */
export function checkImport(json: unknown, known: Set<string>): ImportReport {
  const list = entriesOf(json);
  if (!list) return { accepted: [], duplicates: 0, rejected: [{ id: '(file)', why: 'expected { "entries": [...] } or a list of entries' }] };
  const out: ImportReport = { accepted: [], duplicates: 0, rejected: [] };
  const seen = new Set(known);
  list.forEach((x, i) => {
    const shape = shapeProblems(x);
    const raw = x as Partial<AuditEntry>;
    const id = typeof raw?.id === 'string' ? raw.id : `entry ${i + 1}`;
    if (shape.length) return void out.rejected.push({ id, why: shape.join('; ') });
    const e = withDefaults(raw);
    const probs = [...auditProblems(e), ...(e.action === 'city_confirmed' ? cityReferenceProblems(e.reference) : [])];
    if (probs.length) return void out.rejected.push({ id, why: probs.join('; ') });
    if (seen.has(e.id)) return void out.duplicates++;
    seen.add(e.id);
    out.accepted.push(e);
  });
  return out;
}

/** Key-order-independent JSON, for telling a re-sent entry from a changed one. */
function canonical(e: PublishedEntry): string {
  const { flags_accepted_at: _, ...rest } = e;
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sort(rest));
}

export interface MergeResult {
  merged: PublishedEntry[];
  added: PublishedEntry[];
  duplicates: number;
  conflicts: { id: string; why: string }[];
}

/** Published entries first, in their order; new ones after, oldest first. An id already published
 *  with the same content is a duplicate (skipped); with different content, a conflict (an error). */
export function mergeLog(published: PublishedEntry[], incoming: PublishedEntry[]): MergeResult {
  const byId = new Map(published.map((e) => [e.id, e]));
  const added: PublishedEntry[] = [];
  const conflicts: MergeResult['conflicts'] = [];
  let duplicates = 0;
  for (const e of incoming) {
    const had = byId.get(e.id);
    if (had) {
      if (canonical(had) === canonical(e)) duplicates++;
      else conflicts.push({ id: e.id, why: 'already published with different content; an entry is never rewritten, record a new decision instead' });
      continue;
    }
    byId.set(e.id, e);
    added.push(e);
  }
  added.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return { merged: [...published, ...added], added, duplicates, conflicts };
}

// ─── Whose signature is it? ────────────────────────────────────────────────────────────────────

/** The entry behind a rule's current verification (the last sign or City confirmation since the last
 *  reopen), following the engine's fold in effectiveRule; null when the verification is the rule file's. */
export function signatureOf(r: EffectiveRule): AuditEntry | null {
  let sig: AuditEntry | null = null;
  for (const e of r.history) {
    if (e.action === 'source_checked' || e.action === 'city_confirmed') sig = e;
    else if (e.action === 'reopened') sig = null;
  }
  return sig;
}

/** The entry that last changed a rule's state (sign, confirm, strike or reopen); null if none. */
export function lastDecisionOf(r: EffectiveRule): AuditEntry | null {
  return r.history.length ? r.history[r.history.length - 1] : null;
}

/** Local = saved in this browser only: not in data/rules/reviews.json and not set by a page link. */
export function isLocal(e: AuditEntry | null | undefined, published: Set<string>): boolean {
  return !!e && !published.has(e.id) && !e.id.startsWith('link-');
}

// ─── What publishing changes ───────────────────────────────────────────────────────────────────

export interface StateChange {
  rule: Rule;
  before: EffectiveRule['state'];
  after: EffectiveRule['state'];
}

/** Every rule whose effective state differs between two logs (the engine decides each state). */
export function stateChanges(rules: Rule[], before: AuditEntry[], after: AuditEntry[]): StateChange[] {
  const out: StateChange[] = [];
  for (const r of rules) {
    const a = effectiveRule(r, before).state;
    const b = effectiveRule(r, after).state;
    if (a !== b) out.push({ rule: r, before: a, after: b });
  }
  return out;
}

const VERB: Record<AuditEntry['action'], string> = {
  source_checked: 'signed as source-checked',
  struck: 'struck',
  assumed: 'assumed',
  city_confirmed: 'recorded a City confirmation for',
  reopened: 'reopened',
};

/** "Jane Doe (Zoning analyst) signed as source-checked rule r1d-h.x.min_lot_area (R1D-H §903.03.D.2) · 2026-09-27" */
export function describeEntry(e: AuditEntry, store: Pick<Store, 'rules' | 'questions'>): string {
  const r = e.rule_id ? store.rules.get(e.rule_id) : undefined;
  const q = !r && e.question_id ? store.questions.get(e.question_id) : undefined;
  const what = r
    ? `rule ${r.id} (${r.district === '*' ? 'all districts' : r.district} §${r.section})`
    : q
      ? `question ${q.id} (§${q.section})`
      : `${e.rule_id ?? e.question_id}`;
  const extra = e.action === 'city_confirmed' && e.reference ? `: ${e.reference.who}, ${e.reference.date}, ${e.reference.text}` : e.choice ? ` (${e.choice})` : '';
  return `${e.reviewer} (${e.role}) ${VERB[e.action] ?? e.action} ${what}${extra} · ${e.at.slice(0, 10)}`;
}
