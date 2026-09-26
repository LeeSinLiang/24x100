// The review audit log. Lives in localStorage; entries published in data/rules/reviews.json are loaded
// first and the browser's own entries follow. A browser's entries reach reviews.json only through the
// steward: "Send to the steward" on the review screen, then `npm run check-reviews` (docs/pilot.md).
import { useCallback, useEffect, useState } from 'react';
import { auditProblems } from '@engine/rules';
import type { AuditEntry } from '@engine/types';
import { SEED_REVIEWS } from './data';

const KEY = 'lot24x100.audit.v1';

function safeRead(): AuditEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function safeWrite(list: AuditEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private window: the log still works for this page view */
  }
}

export function seedEntries(): AuditEntry[] {
  const s = SEED_REVIEWS as { entries?: AuditEntry[] } | AuditEntry[];
  return Array.isArray(s) ? s : s?.entries ?? [];
}

let published: Set<string> | null = null;
/** Ids of the entries published in data/rules/reviews.json. Anything else in the log is this browser's. */
export function publishedIds(): Set<string> {
  return (published ??= new Set(seedEntries().map((e) => e.id)));
}

/** Whether a question's current assumption or City confirmation (by, at) is a published entry. */
export function questionDecisionPublished(questionId: string, at: string | null, by: string | null): boolean {
  return seedEntries().some((e) => e.question_id === questionId && e.at === at && e.reviewer === by && (e.action === 'assumed' || e.action === 'city_confirmed'));
}

const listeners = new Set<() => void>();

export function useAudit(): {
  entries: AuditEntry[];
  local: AuditEntry[];
  add: (e: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) => { ok: boolean; problems: string[]; entry?: AuditEntry };
  replaceLocal: (list: AuditEntry[]) => void;
} {
  const [local, setLocal] = useState<AuditEntry[]>(() => safeRead());
  useEffect(() => {
    const on = () => setLocal(safeRead());
    listeners.add(on);
    window.addEventListener('storage', on);
    return () => {
      listeners.delete(on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const add = useCallback((e: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) => {
    const at = e.at ?? new Date().toISOString();
    const entry: AuditEntry = { ...e, at, id: `a-${at}-${Math.floor(performance.now() * 1000) % 100000}` } as AuditEntry;
    const problems = auditProblems(entry);
    if (problems.length) return { ok: false, problems };
    const next = [...safeRead(), entry];
    safeWrite(next);
    listeners.forEach((f) => f());
    return { ok: true, problems: [], entry };
  }, []);
  const replaceLocal = useCallback((list: AuditEntry[]) => {
    safeWrite(list);
    listeners.forEach((f) => f());
  }, []);
  const seeds = seedEntries();
  const seen = new Set(seeds.map((x) => x.id));
  return { entries: [...seeds, ...local.filter((x) => !seen.has(x.id))], local, add, replaceLocal };
}

/** Assumptions set by a page link (?assume=q.id:yes) are red and labeled as coming from the link. */
export function linkAssumptions(assume: string[]): AuditEntry[] {
  return assume
    .map((a) => a.split(':'))
    .filter(([id, choice]) => id && (choice === 'yes' || choice === 'no'))
    .map(([id, choice]) => ({
      id: `link-${id}`,
      rule_id: null,
      question_id: id,
      at: '2026-09-26T00:00:00Z',
      reviewer: 'You (set by this page link)',
      role: 'viewer',
      action: 'assumed' as const,
      quote: '',
      decision: `assume ${choice}`,
      reason: 'An assumption set by the page link; not a City answer.',
      choice: choice as 'yes' | 'no',
      reference: null,
    }));
}
