// The review log: every decision, newest first. Decisions made in this browser are not published until
// the steward publishes them: "Send to the steward" saves them to a file, the steward uploads it, and
// scripts/check-reviews.ts checks it with the same rules as here (reviewlog.ts) before it is merged into
// data/rules/reviews.json (docs/pilot.md). Export and import of the whole log stay for maintainers.
import { useMemo, useRef, useState } from 'react';
import type { AuditEntry } from '@engine/types';
import { fieldName } from '../Drawer';
import { dateFmt, Label } from '../ui';
import { QUESTIONS, RULES, codeFor } from '../../lib/data';
import { checkEntry, checkImport, type ImportReport, type Store } from './reviewlog';

export { checkImport, type ImportReport };

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
  const [sent, setSent] = useState<{ file: string; n: number } | null>(null);
  const saved = entries.filter((e) => !e.id.startsWith('link-'));
  const rows = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  // This browser's decisions that nobody else can see yet. Assumptions are explorations and stay here.
  const unpublished = local.filter((e) => !seedIds.has(e.id) && !e.id.startsWith('link-'));
  const toSend = unpublished.filter((e) => e.action !== 'assumed');
  const keptHere = unpublished.length - toSend.length;
  // The same check the steward's publish step runs (scripts/check-reviews.ts), so problems show here first.
  const precheck = useMemo(() => {
    const store: Store = { rules: new Map(RULES.map((r) => [r.id, r])), questions: new Map(QUESTIONS.map((q) => [q.id, q])), codeFor };
    const out: { id: string; who: string; why: string[]; flag: boolean }[] = [];
    for (const e of toSend) {
      const c = checkEntry(e, store, { incoming: true });
      if (c.errors.length || c.flags.length) out.push({ id: e.id, who: e.reviewer, why: [...c.errors, ...c.flags], flag: !c.errors.length });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toSend.map((e) => e.id).join(',')]);

  const download = (name: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doExport = () => {
    download('reviews.json', JSON.stringify({ exported_at: new Date().toISOString(), entries: saved }, null, 1) + '\n');
    setExported(saved.length);
  };

  const doSend = () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const name = `reviews-${stamp}.json`;
    const body = {
      exported_at: now.toISOString(),
      from: '24×100 review screen: decisions saved in one browser, not yet published',
      next: 'The steward uploads this file to data/rules/uploads/ (GitHub: Add file → Upload files). npm run check-reviews checks it and merges it into data/rules/reviews.json. See docs/pilot.md.',
      entries: toSend,
    };
    download(name, JSON.stringify(body, null, 1) + '\n');
    setSent({ file: name, n: toSend.length });
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
            Every decision, newest first: who, role, when, level, the rule and the reason. {seedIds.size} published in data/rules/reviews.json · {unpublished.length} saved only in this browser, not published.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ink" onClick={doSend} disabled={!toSend.length}>
            Send to the steward
          </button>
          <button type="button" className="btn" onClick={doExport}>
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
      <div className="rv-steward" aria-label="How decisions are published">
        <p>
          <strong>Publishing is the steward’s step.</strong>{' '}
          {toSend.length
            ? `“Send to the steward” saves the ${toSend.length === 1 ? 'decision' : `${toSend.length} decisions`} made in this browser to a file. `
            : 'Nothing to send: no signatures, strikes or City answers are saved only in this browser. '}
          Send the file to your rule steward by email or chat. The steward uploads it to <code>data/rules/uploads/</code> in the project’s GitHub repository (Add file → Upload files); a check runs, and if every entry passes, the site rebuilds with them published. Until then they show as “not published”, here and on each rule.
          {keptHere ? ` ${keptHere === 1 ? 'One assumption stays' : `${keptHere} assumptions stay`} in this browser: assumptions are explorations and are not sent.` : ''}
        </p>
        <p className="small muted">
          Steward’s runbook: <code>docs/pilot.md</code>. The repository is github.com/LeeSinLiang/24x100; its publish workflow hasn’t run there yet, and no one has agreed to be the steward.
        </p>
        {!record && precheck.length > 0 && (
          <div className="warn">
            <p>
              The steward’s check would stop {precheck.length === 1 ? 'one entry' : `${precheck.length} entries`}. Fix {precheck.length === 1 ? 'it' : 'them'} here first, or tell the steward:
            </p>
            <ul>
              {precheck.map((x) => (
                <li key={x.id}>
                  {x.who || 'no name'}: {x.why.join('; ')}
                  {x.flag ? ' (a person can publish it anyway after checking)' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!record && sent && (
        <p className="rv-status" role="status">
          Saved {sent.n} {sent.n === 1 ? 'decision' : 'decisions'} to {sent.file}. Next: send it to your steward. It stays marked “not published” until they publish it.
        </p>
      )}
      {!record && exported != null && (
        <p className="rv-status" role="status">
          Exported the whole log ({exported} {exported === 1 ? 'entry' : 'entries'}, published and this browser’s) to reviews.json. To publish this browser’s decisions, use “Send to the steward”.
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
              const src = e.id.startsWith('link-') ? 'page link, not saved' : seedIds.has(e.id) ? 'published' : 'this browser · not published';
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
