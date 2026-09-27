// The case file (agents/, `npm run steward -- <pin>`): what a team of agents did for one lot, in order, with every
// source, draft and gate, and the verifier's word on it. The run is committed (data/cases/<id>.json); this page reads
// it and can replay it (the findings flip from "free, not run" to what the check found). Words a model wrote are pencil:
// no person has checked them, though the verifier traced every number in them.
import { useEffect, useMemo, useState } from 'react';
import { Label } from '../components/ui';
import type { ViewProps } from './types';
import '../styles/case.css';

interface Source {
  url: string;
  pulled_at: string;
  sha256: string;
  via?: string;
  dataset?: string;
}
interface Step {
  agent: string;
  n: number;
  action: 'plan' | 'tool' | 'draft' | 'verify' | 'gate';
  tool?: string;
  input: unknown;
  summary: string;
  sources: Source[];
  ok: boolean;
  t: number;
  model?: string;
  tokens?: { in: number; out: number };
  cost_usd_paid_rate?: number | null;
}
interface Finding {
  check: string;
  title: string;
  status: 'found' | 'nothing' | 'couldnt' | 'not_done';
  summary: string;
  source: Source | null;
  ask?: string;
}
interface Draft {
  kind: string;
  to?: string;
  subject?: string;
  text: string;
  by?: string;
  gate?: string;
}
interface Gate {
  kind: 'sign' | 'send' | 'spend';
  what: string;
  status: 'waiting' | 'approved';
}
interface Event {
  kind: 'real' | 'simulated';
  pin: string;
  addr: string;
  link: string;
  explanation: string;
  draft?: number;
}
export interface CaseFile {
  id: string;
  goal: string;
  lot: { pin: string; addr: string; lot?: string; block?: string; hood?: string; zone?: string; link?: string };
  run_at: string;
  model: { id: string | null; key: string | null; planned_by: 'model' | 'rule'; why: string };
  tokens: { in: number; out: number; calls: number };
  cost: { usd_paid_rate: number; note: string };
  plan: { agent: string; what: string; why: string }[];
  steps: Step[];
  findings: Finding[];
  drafts: Draft[];
  gates: Gate[];
  verifier: { checked: Record<string, number>; failed: string[]; ok: boolean };
  status: 'published' | 'blocked';
  summary?: { text: string; by: string };
  links?: { label: string; href: string }[];
  events?: Event[];
  rerun?: string;
}

const files = import.meta.glob('../../../data/cases/*.json', { eager: true, import: 'default' }) as Record<string, CaseFile>;
export const CASES: Record<string, CaseFile> = Object.fromEntries(Object.values(files).map((c) => [c.id, c]));

const AGENT: Record<string, string> = { steward: 'Steward', 'due-diligence': 'Due diligence', policy: 'Policy', watch: 'Watch', verifier: 'Verifier' };
const STATUS: Record<Finding['status'], string> = { found: 'Found', nothing: 'Checked · nothing', couldnt: 'Couldn’t check', not_done: 'Paid · not done' };
const whenET = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET';
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const modelWords = (c: CaseFile) =>
  c.model.planned_by === 'model' ? `planned with ${c.steps.find((s) => s.model)?.model ?? c.model.id} (key: ${c.model.key})` : `planned by rule, no model (${c.model.why})`;

/** Which step turned a finding from "not run" to its result (the replay flips it then). */
function stepOf(c: CaseFile, f: Finding): number {
  const s = c.steps.find((x) => x.agent === 'due-diligence' && (x.tool?.endsWith(`:${f.check}`) || (x.action === 'draft' && JSON.stringify(x.input).includes(`"${f.check}"`))));
  return s?.n ?? 0;
}

export function CaseView({ s }: ViewProps) {
  const id = s.pin ?? '';
  const c = CASES[id];
  // Replay: steps appear one by one (the film's beat, or the button); otherwise the whole run shows at once.
  const [shown, setShown] = useState(s.anim ? 0 : Number.POSITIVE_INFINITY);
  const [run, setRun] = useState(s.anim);
  useEffect(() => {
    if (!run || !c) return;
    setShown(0);
    let k = 0;
    let tick = 0;
    // A beat's first second is trimmed as loading: the replay starts after it.
    const start = window.setTimeout(() => {
      tick = window.setInterval(() => {
        k += 1;
        setShown(k);
        if (k >= c.steps.length) {
          window.clearInterval(tick);
          setRun(false);
        }
      }, 420);
    }, 900);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(tick);
    };
  }, [run, c]);
  const byStep = useMemo(() => (c ? c.findings.map((f) => stepOf(c, f)) : []), [c]);
  if (!c) {
    const ids = Object.values(CASES);
    return (
      <main className="case-view" id="main">
        <h1 className="case-title">No case file for {id || 'this lot'}</h1>
        <p>
          Run the agents: <code>npm run steward -- {id || '<pin>'} --goal two</code>. Committed case files:{' '}
          {ids.map((x, i) => (
            <span key={x.id}>
              {i ? ', ' : ''}
              <a href={`?view=case&pin=${x.id}`}>{x.lot.addr}</a>
            </span>
          ))}
          .
        </p>
      </main>
    );
  }
  const steps = c.steps.filter((x) => x.n <= shown);
  const done = shown >= c.steps.length;
  const waiting = c.gates.filter((g) => g.status === 'waiting');
  return (
    <main className="case-view" id="main" data-case={c.id} data-status={c.status}>
      <header className="case-head">
        <p className="label case-kicker">Case file · the agents’ run</p>
        <h1 className="case-title">
          {c.lot.link ? <a href={c.lot.link}>{c.lot.addr}</a> : c.lot.addr}
          {c.lot.lot ? <span className="case-sub"> · lot {c.lot.lot}{c.lot.hood ? `, ${c.lot.hood}` : ''}</span> : null}
        </h1>
        <p className="case-goal">
          Goal: {c.goal}.{' '}
          {done ? (
            <span className={`stamp case-stamp ${c.status === 'published' ? 'is-ok' : 'is-blocked'}`} data-case-stamp={c.status}>
              {c.status === 'published' ? 'Verified' : 'Blocked by the verifier'}
            </span>
          ) : (
            <span className="stamp stamp-pencil case-stamp" data-case-stamp="running">
              Agents working · step {Math.min(shown, c.steps.length)} of {c.steps.length}
            </span>
          )}
        </p>
        <p className="small muted case-meta">
          Run {whenET(c.run_at)} · {modelWords(c)} · {c.tokens.calls} model calls, {c.tokens.in.toLocaleString('en-US')} tokens in and {c.tokens.out.toLocaleString('en-US')} out, $
          {c.cost.usd_paid_rate.toFixed(4)} at the paid rate · re-run: <code>{c.rerun ?? `npm run steward -- ${c.id}`}</code>
        </p>
        {c.summary && done ? (
          <p className={`case-summary ${c.summary.by === 'rule template' ? '' : 'pencil-text'}`} data-trust={c.summary.by === 'rule template' ? 'ink' : 'pencil'}>
            {c.summary.text} <span className="small muted">({c.summary.by === 'rule template' ? 'a fixed template' : `written by ${c.summary.by}; every number traced by the verifier, no person has read it`})</span>
          </p>
        ) : null}
        {!s.record && (
          <button type="button" className="btn btn-small case-replay" onClick={() => setRun(true)} disabled={run}>
            {run ? 'Replaying…' : 'Replay the run'}
          </button>
        )}
      </header>

      <div className="case-cols">
        <section className="case-section" aria-labelledby="case-steps-h">
          <Label as="h2">
            <span id="case-steps-h">What the agents did · {c.steps.length} steps</span>
          </Label>
          <ol className="case-steps" data-case-steps>
            {steps.map((x) => (
              <li key={x.n} className={`case-step is-${x.action} ${x.ok ? '' : 'is-fail'}`} data-step={x.n} data-agent={x.agent}>
                <span className="case-agent" data-agent-tag={x.agent}>
                  {AGENT[x.agent] ?? x.agent}
                </span>
                <span className="case-action">{x.action}</span>
                <p className={`case-step-text ${x.model ? 'pencil-text' : ''}`} data-trust={x.model ? 'pencil' : undefined}>
                  {x.summary}
                </p>
                {x.tool || x.sources.length || x.model ? (
                  <p className="case-step-meta small muted">
                    {x.tool ? <code>{x.tool}</code> : null}
                    {x.sources.map((src) => (
                      <a key={src.url} className="case-src" href={src.url.startsWith('http') ? src.url : undefined} target="_blank" rel="noreferrer" title={`pulled ${src.pulled_at} · sha256 ${src.sha256}`}>
                        {src.url.startsWith('http') ? host(src.url) : src.url} · sha {src.sha256.slice(0, 8)}
                      </a>
                    ))}
                    {x.model ? (
                      <span>
                        {x.model} · {x.tokens?.in ?? 0} in, {x.tokens?.out ?? 0} out
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <div className="case-side">
          {c.findings.length ? (
            <section className="case-section" aria-labelledby="case-find-h">
              <Label as="h2">
                <span id="case-find-h">Due diligence · {c.findings.length} checks</span>
              </Label>
              <ul className="case-findings" data-case-findings>
                {c.findings.map((f, i) => {
                  const on = byStep[i] <= shown;
                  const st = on ? f.status : 'pending';
                  return (
                    <li key={f.check} className={`case-finding is-${st}`} data-finding={f.check} data-finding-status={st}>
                      <span className="case-tag" data-finding-tag>
                        {on ? STATUS[f.status] : f.status === 'not_done' ? 'Paid' : 'Free · not run'}
                      </span>
                      <strong className="case-finding-title">{f.title.replace(/^./, (m) => m.toUpperCase())}</strong>
                      {on ? (
                        <p className="case-finding-text">
                          {f.summary}
                          {f.source ? (
                            <>
                              {' '}
                              <a href={f.source.url} target="_blank" rel="noreferrer" title={`pulled ${f.source.pulled_at} · sha256 ${f.source.sha256}`}>
                                source
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {c.events?.length ? (
            <section className="case-section" aria-labelledby="case-ev-h">
              <Label as="h2">
                <span id="case-ev-h">What changed · {c.events.length}</span>
              </Label>
              <ul className="case-events">
                {c.events.map((e, i) => {
                  const d = e.draft != null ? c.drafts[e.draft] : null;
                  const byModel = !!d?.by && !d.by.startsWith('engine') && d.by !== 'rule template';
                  return (
                    <li key={i} className={`case-event is-${e.kind}`} data-event={e.kind} data-event-pin={e.pin}>
                      {e.kind === 'simulated' ? <span className="stamp stamp-pencil case-sim">Simulation · not a record</span> : null}
                      <p className={e.kind === 'simulated' || e.draft != null ? 'pencil-text' : ''} data-event-text>
                        <a href={e.link}>{e.addr}</a>: {e.explanation.replace(/^SIMULATION, not a record: /, '')}
                      </p>
                      {d ? (
                        <details className="case-draft case-event-draft" data-event-draft>
                          <summary>
                            <span className="case-gate-kind">send · waiting</span> Next move drafted: {d.subject}
                          </summary>
                          <pre className={`case-draft-text ${byModel ? 'pencil-text' : ''}`}>{d.text}</pre>
                          <p className="small muted">{byModel ? `Written by ${d.by}; every number traced by the verifier. ` : ''}Not sent: a person reads it and decides.</p>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="case-section" aria-labelledby="case-gates-h">
            <Label as="h2">
              <span id="case-gates-h">Waiting on a person · {waiting.length}</span>
            </Label>
            <ul className="case-gates" data-case-gates>
              {c.gates.map((g, i) => (
                <li key={i} className={`case-gate is-${g.kind}`}>
                  <span className="case-gate-kind">{g.kind}</span> {g.what} <span className="small muted">· {g.status}</span>
                </li>
              ))}
            </ul>
            <p className="small muted">Nothing is sent, signed or paid for without a person. 24×100 never sends anything to the City.</p>
          </section>

          <section className="case-section" aria-labelledby="case-drafts-h">
            <Label as="h2">
              <span id="case-drafts-h">Drafts · {c.drafts.length}{c.events?.some((e) => e.draft != null) ? ' (the next moves are with their changes)' : ''}</span>
            </Label>
            {c.drafts.map((d, i) => (c.events?.some((e) => e.draft === i) ? null : (
              <details key={i} className="case-draft" data-draft={d.kind}>
                <summary>
                  {d.subject ?? d.kind}
                  <span className="small muted">
                    {' '}
                    · to {d.to ?? 'someone'} · {d.by?.startsWith('engine') ? 'the engine' : d.by === 'rule template' ? 'a fixed template' : `written by ${d.by}`}
                  </span>
                </summary>
                <pre className={`case-draft-text ${d.by && !d.by.startsWith('engine') && d.by !== 'rule template' ? 'pencil-text' : ''}`}>{d.text}</pre>
              </details>
            )))}
          </section>

          <section className={`case-section case-verifier ${c.verifier.ok ? 'is-ok' : 'is-blocked'}`} aria-labelledby="case-ver-h" data-verifier={c.verifier.ok ? 'ok' : 'blocked'}>
            <Label as="h2">
              <span id="case-ver-h">Verifier</span>
            </Label>
            <p>
              {c.verifier.checked.quotes ?? 0} quotes verbatim in the saved code · {c.verifier.checked.numbers ?? 0} numbers traced to the engine or a source ·{' '}
              {c.verifier.checked.findings ?? 0} findings with their source · no name or mailing address anywhere.
            </p>
            {c.verifier.failed.length ? (
              <ul>
                {c.verifier.failed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {c.links?.length ? (
              <p className="small">
                {c.links.map((l) => (
                  <a key={l.href} className="case-link" href={l.href}>
                    {l.label}
                  </a>
                ))}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
