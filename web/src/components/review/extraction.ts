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

/** Districts that have rules loaded: from the answer key or an extraction run. A district named only
 *  in the URL is not one of them (the review screen says so instead of inventing a tab). */
export function reviewDistricts(): string[] {
  const set = new Set<string>();
  for (const r of RULES) if (r.district !== '*') set.add(r.district);
  for (const [key, f] of Object.entries(EXTRACTED)) {
    if (key === 'eval') continue;
    const d = str(((f as Json).meta as Json | undefined)?.district);
    if (d) set.add(d);
  }
  const order = (d: string) => (d === 'RM-M' ? 0 : 1);
  return [...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

export interface EvalLine {
  district: string;
  agree: number;
  total: number;
  verbatim: string | null; // e.g. "every accepted quote verbatim"
  model: string | null;
}

/** The eval result (data/rules/extracted/eval.json, written by `python -m extract eval`) as one line
 *  per district. Shape read: { districts: { "RM-M": { model, agreement: { agree, fields },
 *  quotes: { accepted, rejected_quote, accepted_recheck_failures } } } }. Nothing is invented: a
 *  field missing from the file is left out of the line, and an unknown shape shows no line at all. */
export function evalLines(): EvalLine[] {
  const e = EXTRACTED.eval as Json | undefined;
  const ds = (e?.districts ?? null) as Record<string, Json> | null;
  if (!ds || typeof ds !== 'object') return [];
  const out: EvalLine[] = [];
  for (const [district, d] of Object.entries(ds)) {
    const a = (d?.agreement ?? {}) as Json;
    if (typeof a.agree !== 'number' || typeof a.fields !== 'number') continue;
    const q = (d.quotes ?? {}) as Json;
    const fails = Array.isArray(q.accepted_recheck_failures) ? q.accepted_recheck_failures.length : null;
    const rejectedQuote = typeof q.rejected_quote === 'number' ? q.rejected_quote : null;
    const verbatim =
      fails === 0 && rejectedQuote != null
        ? `every accepted quote verbatim${rejectedQuote ? ` (${rejectedQuote} rejected by the quote guard)` : ''}`
        : fails
          ? `${fails} accepted quote${fails === 1 ? '' : 's'} no longer verbatim`
          : null;
    out.push({ district, agree: a.agree, total: a.fields, verbatim, model: str(d.model) });
  }
  return out;
}
