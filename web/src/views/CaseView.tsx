// The case file (agents/, `npm run steward -- <pin>`), at a glance: who worked the lot (the agent lane), what the
// checks found (one tile each), and what waits for a person (three gates). The agents' full log, with every source,
// token and draft, sits one click down. The run is committed (data/cases/<id>.json) and can be replayed: the cards
// light in order and each check flips from "free, not run" to its result. Every short line here is read from the case
// file's own fields; words a model wrote stay in the log, in pencil.
import { useEffect, useMemo, useState } from 'react';
import { Label } from '../components/ui';
import { VerdictStamp } from '../components/workspace/plain';
import { BLOCKS } from '../lib/data';
import { useLotModel } from '../lib/model';
import { parseUrl } from '../lib/url';
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
  input: Record<string, unknown> | unknown;
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
  derived?: Record<string, { value: number; formula: string }>;
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
interface ChangeItem {
  kind: string;
  what: string;
  before: string;
  after: string;
}
interface Event {
  kind: 'real' | 'simulated';
  pin: string;
  addr: string;
  link: string;
  explanation: string;
  draft?: number;
  items?: ChangeItem[];
  built?: string[];
  after?: { formula: string; best: number; trust: string };
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
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const SHORT: Record<string, string> = {
  permits: 'Permits',
  violations: 'Violations',
  condemned: 'Condemned',
  liens: 'Tax liens',
  '311': '311',
  undermining: 'Mines',
  slope: 'Slope',
  phase1: 'Phase I',
  survey: 'Survey',
  geotech: 'Soils',
};
const T = '︎'; // text presentation: ⚠ and ⏸ as glyphs, not emoji
const n = (x: number) => x.toLocaleString('en-US');
const whenET = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET';
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const d = (f: Finding, k: string) => f.derived?.[k]?.value;

/** A check's one key fact, from its own derived values (never a new number). */
function fact(f: Finding): string {
  if (f.status === 'not_done') return 'waiting for you';
  if (f.status === 'couldnt') return `ask ${f.ask ?? 'the office'}`;
  const found = f.status === 'found';
  switch (f.check) {
    case 'violations':
      return found ? `${d(f, 'case_files') ?? d(f, 'records')} case${d(f, 'case_files') === 1 ? '' : 's'}${d(f, 'first_year') ? ` · ${d(f, 'first_year')}` : ''}` : 'no case';
    case '311':
      return found ? `${d(f, 'near')} requests nearby` : 'none nearby';
    case 'slope':
      return found ? `${d(f, 'percent')}% steep` : 'not steep';
    case 'undermining':
      return found ? `${d(f, 'percent')}% undermined` : 'not undermined';
    case 'liens':
      return found ? `${d(f, 'unsatisfied')} open · $${n(Number(d(f, 'unsatisfied_total')))}` : 'none open';
    case 'condemned':
      return found ? 'on the list' : 'not listed';
    case 'permits':
      return found ? `${d(f, 'records')} on record` : 'none';
    default:
      return found ? 'found' : 'none';
  }
}

/** The step that turned a check from "not run" to its result (the replay flips it then). */
function stepOf(c: CaseFile, f: Finding): number {
  const s = c.steps.find((x) => x.agent === 'due-diligence' && (x.tool?.endsWith(`:${f.check}`) || (x.action === 'draft' && JSON.stringify(x.input).includes(`"${f.check}"`))));
  return s?.n ?? 0;
}

interface Card {
  agent: string;
  state: 'done' | 'found' | 'drafted' | 'waiting' | 'blocked';
  line: string;
  first: number;
  last: number;
}

/** The agent lane's cards: a state and one short line each, read from the case file. */
function lane(c: CaseFile): Card[] {
  const range = (a: string) => {
    const ns = c.steps.filter((s) => s.agent === a).map((s) => s.n);
    return { first: ns.length ? Math.min(...ns) : Infinity, last: ns.length ? Math.max(...ns) : Infinity };
  };
  const cards: Card[] = [];
  if (c.steps.some((s) => s.agent === 'steward')) cards.push({ agent: 'steward', state: 'done', line: `planned ${c.plan.length} agents · ${c.model.planned_by === 'model' ? 'with a model' : 'by rule'}`, ...range('steward') });
  const free = c.findings.filter((f) => f.status !== 'not_done');
  const found = free.filter((f) => f.status === 'found').length;
  if (c.findings.length) cards.push({ agent: 'due-diligence', state: found ? 'found' : 'done', line: `${free.length} free checks · ${found} found`, ...range('due-diligence') });
  if (c.steps.some((s) => s.agent === 'policy')) {
    const pol = [...c.steps].reverse().find((s) => s.agent === 'policy' && (s.input as Record<string, unknown>)?.opens != null);
    const inp = (pol?.input ?? {}) as { what_if?: string; opens?: number };
    // "Q4: RM-M interior side setback 10 → 4 ft (…)" → "Q4: side setback 10 → 4 ft"
    const change = pol?.summary.match(/Q\d+: \S+ (?:interior |exterior )?([a-z ]+?) ([\d.]+ → [\d.]+ \S+)/);
    cards.push({
      agent: 'policy',
      state: pol ? 'drafted' : 'done', // a what-if drafted: a fix found, not a risk
      line: pol && change ? `${inp.what_if}: ${change[1]} ${change[2]} · ${n(inp.opens ?? 0)} lots` : `${c.steps.filter((s) => s.agent === 'policy' && /What-if S\d/.test(s.summary)).length} what-ifs would open it`,
      ...range('policy'),
    });
  }
  if (c.id !== 'watch') {
    const changed = CASES.watch?.events?.filter((e) => e.kind === 'real' && e.pin === c.lot.pin).length ?? 0;
    const at = range('policy').last < Infinity ? range('policy').last : range('due-diligence').last;
    cards.push({ agent: 'watch', state: changed ? 'found' : 'waiting', line: changed ? `watching · ${changed} change` : 'watching · no change yet', first: at, last: at });
  } else {
    const real = (c.events ?? []).filter((e) => e.kind === 'real').length;
    cards.push({ agent: 'watch', state: real ? 'found' : 'waiting', line: `${real} change${real === 1 ? '' : 's'} · ${c.drafts.length} letters drafted`, ...range('watch') });
  }
  cards.push({ agent: 'verifier', state: c.verifier.ok ? 'done' : 'blocked', line: c.verifier.ok ? `${n(c.verifier.checked.numbers ?? 0)} numbers traced ✓` : `blocked · ${c.verifier.failed.length} problems`, ...range('verifier') });
  return cards;
}

const STATE: Record<Card['state'], string> = { done: '✓ done', found: `⚠${T} found`, drafted: '✓ drafted', waiting: `⏸${T} waiting`, blocked: '✕ blocked' };

/** "not checked yet: its rules are …" → "not checked"; "too narrow: 25 − 5 − 5 = 15 ft, for a 16 ft …" → "too narrow · 15 ft < 16 ft". */
function verdictShort(s: string): string {
  const head = s.split(':')[0].replace(/ yet$/, '');
  const m = s.match(/= ([\d.]+) ft, for a ([\d.]+) ft/);
  return m ? `${head} · ${m[1]} ft < ${m[2]} ft` : head;
}

function Pill({ kind, count, noun, open, onClick }: { kind: string; count: number; noun: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`case-pill is-${kind} ${open ? 'is-open' : ''}`} aria-expanded={open} onClick={onClick} data-gate-pill={kind} disabled={!count}>
      <span className="case-pill-kind">{kind}</span> {count} {noun}
    </button>
  );
}

export function CaseView({ s, audit }: ViewProps) {
  const id = s.pin ?? '';
  const c = CASES[id];
  // The lot's own verdict stamp, from the engine as the lot page reads it.
  const ls = useMemo(() => (c?.lot.link ? parseUrl(c.lot.link) : null), [c]);
  const model = useLotModel(ls ? BLOCKS[ls.block] : undefined, ls ?? s, audit);
  // Replay: steps appear one by one (the film's beat, or the button); otherwise the whole run shows at once.
  const [shown, setShown] = useState(s.anim ? 0 : Number.POSITIVE_INFINITY);
  const [run, setRun] = useState(s.anim);
  const [gate, setGate] = useState<string | null>(null);
  const [tile, setTile] = useState<string | null>(null);
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
  const cards = useMemo(() => (c ? lane(c) : []), [c]);
  if (!c) {
    return (
      <main className="case-view" id="main">
        <h1 className="case-title">No case file for {id || 'this lot'}</h1>
        <p>
          Run the agents: <code>npm run steward -- {id || '<pin>'} --goal two</code>. Case files:{' '}
          {Object.values(CASES).map((x, i) => (
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
  const done = shown >= c.steps.length;
  const steps = c.steps.filter((x) => x.n <= shown);
  const byKind = (k: Gate['kind']) => c.gates.filter((g) => g.kind === k && g.status === 'waiting');
  const goal = c.goal.replace(/^an? /, '');
  const isWatch = c.id === 'watch';
  return (
    <main className="case-view" id="main" data-case={c.id} data-status={c.status}>
      <header className="case-head">
        <p className="label case-kicker">Case file · the agents’ run · {whenET(c.run_at)}</p>
        <h1 className="case-title">
          {c.lot.link ? <a href={c.lot.link}>{c.lot.addr}</a> : c.lot.addr}
          {c.lot.lot ? <span className="case-sub"> · lot {c.lot.lot} · goal: {goal}</span> : null}
        </h1>
        <p className="case-stamps">
          {model ? <VerdictStamp headline={model.verdict.headline} refusal={model.result.refusal?.code} /> : null}
          {done ? (
            <span className={`stamp case-stamp ${c.status === 'published' ? 'is-ok' : 'is-blocked'}`} data-case-stamp={c.status}>
              {c.status === 'published' ? 'Verified' : 'Blocked by the verifier'}
            </span>
          ) : (
            <span className="stamp stamp-pencil case-stamp" data-case-stamp="running">
              Agents working · step {Math.min(shown, c.steps.length)}/{c.steps.length}
            </span>
          )}
          {!s.record && (
            <button type="button" className="btn btn-small case-replay" onClick={() => setRun(true)} disabled={run}>
              {run ? 'Replaying…' : 'Replay'}
            </button>
          )}
        </p>
      </header>

      <ol className="case-lane" data-agent-lane aria-label="The agents, in order">
        {cards.map((k, i) => {
          const lit = shown >= k.first;
          const fin = shown >= k.last;
          const st = fin ? k.state : lit ? 'working' : 'idle';
          return (
            <li key={k.agent} className={`case-card is-${st}`} data-agent-card={k.agent} data-card-state={st}>
              <span className="case-card-glyph" aria-hidden="true">
                {ROMAN[i]}
              </span>
              <span className="case-card-name">{AGENT[k.agent]}</span>
              <span className="case-card-state">{fin ? STATE[k.state] : lit ? 'working…' : '—'}</span>
              <span className="case-card-line">{fin ? k.line : ''}</span>
            </li>
          );
        })}
      </ol>

      {isWatch ? (
        <section className="case-block" aria-labelledby="case-ch-h">
          <Label as="h2">
            <span id="case-ch-h">What changed</span>
          </Label>
          <ul className="case-changes">
            {(c.events ?? [])
              .filter((e) => e.kind === 'real')
              .map((e) => {
                const v = e.items?.find((i) => i.kind === 'verdict');
                const r = e.items?.find((i) => i.kind === 'rules');
                const dr = e.draft != null ? c.drafts[e.draft] : null;
                const open = gate === `letter:${e.pin}`;
                return (
                  <li key={e.pin} className="case-change" data-change-row data-event-pin={e.pin}>
                    <p className="case-change-line">
                      <a href={e.link}>{e.addr}</a>: {v ? `${verdictShort(v.before)} → ${verdictShort(v.after)}` : 'changed'}
                      {r ? <span className="small muted"> · {r.what} signed</span> : null}
                    </p>
                    {dr ? (
                      <>
                        <button type="button" className={`case-pill is-send ${open ? 'is-open' : ''}`} aria-expanded={open} onClick={() => setGate(open ? null : `letter:${e.pin}`)} data-send-pill>
                          <span className="case-pill-kind">send</span> letter drafted · waiting
                        </button>
                        {open ? (
                          <div className="case-open" data-letter>
                            <pre className="case-draft-text pencil-text">{dr.text}</pre>
                            <p className="small muted">Written by {dr.by}; every number traced by the verifier. Not sent: a person decides.</p>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          {(c.events ?? [])
            .filter((e) => e.kind === 'simulated')
            .map((e) => {
              const plan = e.explanation.match(/against a ([\d.]+) ft/)?.[1];
              const who = (e.built ?? []).map((p) => `lot ${Number(p.slice(5, 10))}`).join(' and ');
              const best = e.after?.best;
              return (
                <div key={e.pin} className="case-sim" data-event="simulated">
                  <span className="case-sim-kind">Simulation · not a record</span>
                  <p className="pencil-text">
                    <a href={e.link}>{e.addr}</a>: if {who} is built, at best {best} ft{plan ? ` · ${best != null && best >= Number(plan) ? 'fits' : 'still short of'} ${plan} ft` : ''}
                  </p>
                </div>
              );
            })}
        </section>
      ) : (
        <section className="case-block" aria-labelledby="case-find-h">
          <Label as="h2">
            <span id="case-find-h">What the checks found</span>
          </Label>
          <ul className="case-tiles" data-case-findings>
            {c.findings.map((f, i) => {
              const on = byStep[i] <= shown;
              const st = on ? f.status : f.status === 'not_done' ? 'not_done' : 'pending';
              const open = tile === f.check;
              const chip = st === 'pending' ? 'Free · not run' : st === 'found' ? `Found ⚠${T}` : st === 'nothing' ? 'Nothing ✓' : st === 'couldnt' ? 'Couldn’t check' : 'Paid';
              return (
                <li key={f.check} className={`case-tile is-${st} ${open ? 'is-open' : ''}`} data-finding={f.check} data-finding-status={st}>
                  <button type="button" className="case-tile-btn" aria-expanded={open} onClick={() => setTile(open ? null : f.check)} disabled={!on}>
                    <span className="case-tile-name">{SHORT[f.check] ?? f.title}</span>
                    <span className="case-chip">{chip}</span>
                    <span className="case-tile-fact">{on || f.status === 'not_done' ? fact(f) : ''}</span>
                  </button>
                  {open ? (
                    <div className="case-tile-more small">
                      <p>{f.summary}</p>
                      {f.source ? (
                        <p className="muted">
                          <a href={f.source.url} target="_blank" rel="noreferrer">
                            {host(f.source.url)}
                          </a>{' '}
                          · pulled {f.source.pulled_at.slice(0, 16).replace('T', ' ')} · sha {f.source.sha256.slice(0, 10)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="case-block" aria-label="Waiting on a person">
        <Label as="h2">Waiting on you</Label>
        <div className="case-pills">
          <Pill kind="sign" count={byKind('sign').length} noun="rules" open={gate === 'sign'} onClick={() => setGate(gate === 'sign' ? null : 'sign')} />
          <Pill kind="send" count={byKind('send').length} noun="drafts" open={gate === 'send'} onClick={() => setGate(gate === 'send' ? null : 'send')} />
          <Pill kind="spend" count={byKind('spend').length} noun="studies" open={gate === 'spend'} onClick={() => setGate(gate === 'spend' ? null : 'spend')} />
        </div>
        {gate === 'sign' || gate === 'send' || gate === 'spend' ? (
          <ul className="case-gate-list">
            {byKind(gate).map((g, i) => (
              <li key={i}>{g.what}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <details className="case-log">
        <summary>Show the agents’ log · {c.steps.length} steps, sources, tokens and cost</summary>
        <p className="small muted case-meta">
          {c.model.planned_by === 'model' ? `Planned with ${c.steps.find((x) => x.model)?.model ?? c.model.id}` : `Planned by rule, no model (${c.model.why})`} · {c.tokens.calls} model calls,{' '}
          {n(c.tokens.in)} tokens in and {n(c.tokens.out)} out, ${c.cost.usd_paid_rate.toFixed(4)} at the paid rate · re-run: <code>{c.rerun ?? `npm run steward -- ${c.id}`}</code>
        </p>
        {c.summary ? (
          <p className={`case-summary ${c.summary.by === 'rule template' ? '' : 'pencil-text'}`} data-trust={c.summary.by === 'rule template' ? 'ink' : 'pencil'}>
            {c.summary.text} <span className="small muted">({c.summary.by === 'rule template' ? 'a fixed template' : `written by ${c.summary.by}; every number traced, no person has read it`})</span>
          </p>
        ) : null}
        <ol className="case-steps">
          {steps.map((x) => (
            <li key={x.n} className={`case-step is-${x.action} ${x.ok ? '' : 'is-fail'}`} data-step={x.n} data-agent={x.agent}>
              <span className="case-agent">{AGENT[x.agent] ?? x.agent}</span>
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
        {c.drafts.length ? (
          <>
            <Label as="h3">Drafts · {c.drafts.length}</Label>
            {c.drafts.map((dr, i) => (
              <details key={i} className="case-draft" data-draft={dr.kind}>
                <summary>
                  {dr.subject ?? dr.kind} <span className="small muted">· to {dr.to ?? 'someone'} · {dr.by?.startsWith('engine') ? 'the engine' : dr.by === 'rule template' ? 'a fixed template' : `written by ${dr.by}`}</span>
                </summary>
                <pre className={`case-draft-text ${dr.by && !dr.by.startsWith('engine') && dr.by !== 'rule template' ? 'pencil-text' : ''}`}>{dr.text}</pre>
              </details>
            ))}
          </>
        ) : null}
        {isWatch
          ? (c.events ?? []).map((e, i) => (
              <p key={i} className="small pencil-text">
                <strong>{e.addr}.</strong> {e.explanation}
              </p>
            ))
          : null}
        <p className={`small case-verifier-line ${c.verifier.ok ? '' : 'is-blocked'}`} data-verifier={c.verifier.ok ? 'ok' : 'blocked'}>
          Verifier: {c.verifier.checked.quotes ?? 0} quotes word for word in the saved code · {c.verifier.checked.numbers ?? 0} numbers traced · {c.verifier.checked.findings ?? 0} findings
          sourced · no name or mailing address.{c.verifier.failed.length ? ` Blocked: ${c.verifier.failed.join('; ')}` : ''}
        </p>
        {c.links?.length ? (
          <p className="small">
            {c.links.map((l) => (
              <a key={l.href} className="case-link" href={l.href}>
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </details>
    </main>
  );
}
