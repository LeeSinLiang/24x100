// What the extraction run and its evaluation wrote, read defensively: the files are produced by
// another part of the build (extract/), may be absent, and are never filled in by the interface.
import { EXTRACTED, RULES } from '../../lib/data';

export interface ExtractionMeta {
  district: string;
  provider: string | null;
  model: string | null;
  prompt_sha: string | null;
  run_at: string | null;
  note: string | null;
  sections: string[];
  rules: number;
  rejected: { field: string; section: string; reason: string }[];
  ambiguous: string[]; // rule ids the guards marked ambiguous
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** The extracted file for a district (data/rules/extracted/<slug>.json), or null when no run exists. */
export function extractionFor(district: string): ExtractionMeta | null {
  for (const [key, f] of Object.entries(EXTRACTED)) {
    if (key === 'eval') continue;
    const file = f as Json;
    const meta = (file.meta ?? {}) as Json;
    const rules = Array.isArray(file.rules) ? (file.rules as Json[]) : [];
    const d = str(meta.district) ?? (rules[0] ? str(rules[0].district) : null) ?? key.toUpperCase();
    if (d !== district && key !== district.toLowerCase()) continue;
    const rejected = (Array.isArray(file.rejected) ? (file.rejected as Json[]) : []).map((x) => {
      const r = (x.rule ?? {}) as Json;
      return { field: str(r.field) ?? '—', section: str(r.section) ?? '—', reason: str(x.reason) ?? 'no reason recorded' };
    });
    const checks = Array.isArray(file.checks) ? (file.checks as Json[]) : [];
    return {
      district: d,
      provider: str(meta.provider),
      model: str(meta.model),
      prompt_sha: str(meta.prompt_sha),
      run_at: str(meta.run_at),
      note: str(meta.note),
      sections: Array.isArray(meta.sections) ? (meta.sections as unknown[]).map(String) : [],
      rules: rules.length,
      rejected,
      ambiguous: checks.filter((c) => c.ambiguous === true).map((c) => String(c.id)),
    };
  }
  return null;
}

/** Districts that have hand-checked or extracted rules (plus the one in the URL). */
export function reviewDistricts(current: string): string[] {
  const set = new Set<string>();
  for (const r of RULES) if (r.district !== '*') set.add(r.district);
  for (const [key, f] of Object.entries(EXTRACTED)) {
    if (key === 'eval') continue;
    const d = str(((f as Json).meta as Json | undefined)?.district);
    if (d) set.add(d);
  }
  set.add(current);
  const order = (d: string) => (d === 'RM-M' ? 0 : 1);
  return [...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

export interface EvalLine {
  district: string;
  agree: number;
  total: number;
  verbatim: string | null; // e.g. "every accepted quote verbatim"
  model: string | null;
  note: string | null;
}

const AGREE = ['agree', 'agreed', 'agreement_count', 'matches', 'matched', 'match', 'correct', 'fields_agree'];
const TOTAL = ['total', 'fields', 'compared', 'n', 'count', 'fields_total', 'fields_compared'];

function num(o: Json, keys: string[]): number | null {
  for (const k of keys) if (typeof o[k] === 'number' && Number.isFinite(o[k])) return o[k] as number;
  return null;
}

function findAgreement(o: unknown, depth = 0): Json | null {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  const j = o as Json;
  if (num(j, AGREE) != null && num(j, TOTAL) != null) return j;
  for (const v of Object.values(j)) {
    const hit = findAgreement(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** The eval result (data/rules/extracted/eval.json) as one line of facts, or null. Nothing is
 *  invented: a field missing from the file is left out of the line. */
export function evalLine(): EvalLine | null {
  const e = EXTRACTED.eval as Json | undefined;
  if (!e) return null;
  const hit = findAgreement(e);
  if (!hit) return null;
  const agree = num(hit, AGREE)!;
  const total = num(hit, TOTAL)!;
  const meta = (e.meta ?? {}) as Json;
  const district = str(hit.district) ?? str(e.district) ?? str(meta.district) ?? 'RM-M';
  const rejectedQuotes = num(e, ['quotes_failed', 'quote_failures', 'non_verbatim']) ?? num(hit, ['quotes_failed', 'quote_failures', 'non_verbatim']);
  const verbatimFlag = e.quotes_verbatim ?? e.verbatim ?? hit.quotes_verbatim ?? hit.verbatim;
  const verbatim =
    verbatimFlag === true || rejectedQuotes === 0
      ? 'every accepted quote verbatim'
      : typeof rejectedQuotes === 'number'
        ? `${rejectedQuotes} accepted quote${rejectedQuotes === 1 ? '' : 's'} not verbatim`
        : null;
  return { district, agree, total, verbatim, model: str(e.model) ?? str(meta.model) ?? str(hit.model), note: str(e.note) ?? str(meta.note) };
}
