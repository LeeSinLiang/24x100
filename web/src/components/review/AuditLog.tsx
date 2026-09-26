// The review log: every decision, newest first, with export to data/rules/reviews.json and import
// back (each entry validated with the engine's auditProblems before it is merged).
import { useRef, useState } from 'react';
import { auditProblems } from '@engine/rules';
import type { AuditEntry } from '@engine/types';
import { fieldName } from '../Drawer';
import { dateFmt, Label } from '../ui';
import { QUESTIONS, RULES } from '../../lib/data';

const ACTIONS = ['source_checked', 'struck', 'assumed', 'city_confirmed', 'reopened'] as const;

const ACTION_WORDS: Record<string, string> = {
  source_checked: 'Source-checked',
  struck: 'Struck',
  assumed: 'Assumed (red)',
  city_confirmed: 'City-confirmed',
  reopened: 'Reopened',
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return `${dateFmt(iso)}, ${t}`;
}

function subject(e: AuditEntry): { text: string; district: string | null; id: string | null } {
  if (e.rule_id) {
    const r = RULES.find((x) => x.id === e.rule_id);
    return r ? { text: `${fieldName(r.field)} · ${r.district === '*' ? 'all districts' : r.district} · §${r.section}`, district: r.district === '*' ? null : r.district, id: r.id } : { text: e.rule_id, district: null, id: null };
  }
  const q = QUESTIONS.find((x) => x.id === e.question_id);
  return { text: q ? `Question: ${q.question.slice(0, 90)}${q.question.length > 90 ? '…' : ''}` : String(e.question_id), district: null, id: q ? `q:${q.id}` : null };
}

/** Structural checks the engine's auditProblems doesn't make (it assumes a well-formed entry). */
function shapeProblems(x: unknown): string[] {
  if (!x || typeof x !== 'object') return ['not an object'];
  const e = x as Record<string, unknown>;
  const p: string[] = [];
  if (typeof e.id !== 'string' || !e.id.trim()) p.push('no id');
  if (!ACTIONS.includes(e.action as (typeof ACTIONS)[number])) p.push(`unknown action "${String(e.action)}"`);
  for (const k of ['rule_id', 'question_id'] as const) if (e[k] != null && typeof e[k] !== 'string') p.push(`${k} must be text or null`);
  for (const k of ['reviewer', 'role', 'reason', 'at'] as const) if (e[k] != null && typeof e[k] !== 'string') p.push(`${k} must be text`);
  return p;
}

function withDefaults(x: Partial<AuditEntry>): AuditEntry {
  return {
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
}

export interface ImportReport {
  accepted: AuditEntry[];
  duplicates: number;
  rejected: { id: string; why: string }[];
}

export function checkImport(json: unknown, known: Set<string>): ImportReport {
  const list = Array.isArray(json) ? json : Array.isArray((json as { entries?: unknown })?.entries) ? (json as { entries: unknown[] }).entries : null;
  if (!list) return { accepted: [], duplicates: 0, rejected: [{ id: '(file)', why: 'expected { "entries": [...] } or a list of entries' }] };
  const out: ImportReport = { accepted: [], duplicates: 0, rejected: [] };
  const seen = new Set(known);
  list.forEach((x, i) => {
    const shape = shapeProblems(x);
    const raw = x as Partial<AuditEntry>;
    const id = typeof raw?.id === 'string' ? raw.id : `entry ${i + 1}`;
    if (shape.length) return void out.rejected.push({ id, why: shape.join('; ') });
    const e = withDefaults(raw);
    const probs = auditProblems(e);
    if (probs.length) return void out.rejected.push({ id, why: probs.join('; ') });
    if (seen.has(e.id)) return void out.duplicates++;
    seen.add(e.id);
    out.accepted.push(e);
  });
  return out;
}

export function AuditLog({
  entries,
  seedIds,
  local,
  replaceLocal,
  onGo,
  record,
}: {
  entries: AuditEntry[]; // committed + this browser + page-link assumptions
  seedIds: Set<string>;
  local: AuditEntry[];
  replaceLocal: (list: AuditEntry[]) => void;
  onGo: (district: string | null, id: string) => void;
  record: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | { error: string } | null>(null);
  const [exported, setExported] = useState<number | null>(null);
  const saved = entries.filter((e) => !e.id.startsWith('link-'));
  const rows = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));

  const doExport = () => {
    const body = JSON.stringify({ exported_at: new Date().toISOString(), entries: saved }, null, 1) + '\n';
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reviews.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(saved.length);
  };

  const doImport = async (f: File) => {
    try {
      const json = JSON.parse(await f.text());
      const r = checkImport(json, new Set(saved.map((e) => e.id)));
      if (r.accepted.length) replaceLocal([...local, ...r.accepted]);
      setReport(r);
    } catch (err) {
      setReport({ error: `Couldn’t read ${f.name}: ${(err as Error).message}` });
    }
  };

  return (
    <section className="rv-log" aria-labelledby="rv-log-h">
      <header className="rv-log-head">
        <div>
          <h2 id="rv-log-h" className="wall-title">
            The review log
          </h2>
          <p className="small muted">
            Every decision, newest first: who, role, when, level, the rule and the reason. {seedIds.size} committed in data/rules/reviews.json · {local.length} saved in this browser. Export it and commit the file so the team shares one record.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ink" onClick={doExport}>
            Export review log
          </button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            Import review log
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Review log file to import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      {!record && exported != null && (
        <p className="rv-status" role="status">
          Exported {exported} {exported === 1 ? 'entry' : 'entries'} to reviews.json. Commit it as data/rules/reviews.json.
        </p>
      )}
      {!record && report && (
        <div className="rv-status" role="status">
          {'error' in report ? (
            <p className="warn">{report.error}</p>
          ) : (
            <>
              <p>
                Imported {report.accepted.length} {report.accepted.length === 1 ? 'entry' : 'entries'}
                {report.duplicates ? `; ${report.duplicates} already in the log` : ''}
                {report.rejected.length ? `; ${report.rejected.length} rejected` : ''}.
              </p>
              {report.rejected.length > 0 && (
                <ul className="small">
                  {report.rejected.map((x, i) => (
                    <li key={i} className="warn">
                      {x.id}: {x.why}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="na">— No decisions yet. Sign, strike or assume something above and it appears here with your name and the time.</p>
      ) : (
        <table className="rv-log-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Role</th>
              <th scope="col">Level</th>
              <th scope="col">Rule or question</th>
              <th scope="col">Decision</th>
              <th scope="col">Reason · reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const sub = subject(e);
              const src = e.id.startsWith('link-') ? 'page link, not saved' : seedIds.has(e.id) ? 'committed' : 'this browser';
              const tone = e.action === 'assumed' ? 'red' : e.action === 'struck' ? 'struck' : e.action === 'reopened' ? 'pencil' : 'ink';
              return (
                <tr key={e.id} className={`is-${tone}`}>
                  <td data-h="When">
                    {when(e.at)}
                    <div className="small muted">{src}</div>
                  </td>
                  <td data-h="Who">{e.reviewer}</td>
                  <td data-h="Role">{e.role}</td>
                  <td data-h="Level" className={`rv-act rv-act-${tone}`}>
                    {ACTION_WORDS[e.action] ?? e.action}
                    {e.choice ? ` ${e.choice}` : ''}
                  </td>
                  <td data-h="Rule">
                    {sub.id ? (
                      <button type="button" className="link" onClick={() => onGo(sub.district, sub.id!)}>
                        {sub.text}
                      </button>
                    ) : (
                      sub.text
                    )}
                  </td>
                  <td data-h="Decision">{e.decision}</td>
                  <td data-h="Reason">
                    {e.reason}
                    {e.reference && (
                      <div className="small">
                        {e.reference.who}, {e.reference.date}: {e.reference.text}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Label className="rv-log-foot">Assumptions stay red and never count as a City answer · a City confirmation needs a reference, a date and who</Label>
    </section>
  );
}
