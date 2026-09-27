// The bottom tray (spec §0.15), collapsible: What to check next (the route, cheapest first, each step
// opening its question and linking to its letter), the evidence timeline (real events only: data
// pulls, rule signatures and checks, the last refresh) and what changed on the last refresh.
import { useState, type ReactNode } from 'react';
import type { AuditEntry, EffectiveRule, RuleSet } from '@engine/types';
import type { InquiryLetter } from '@engine/inquiry';
import { DISCLAIMER, dateFmt } from '../ui';
import { REFRESH, type RefreshChange } from '../../lib/data';
import type { TrayTab, UrlState } from '../../lib/url';
import { when, type SourceRow } from './Sources';

export interface Step {
  tag: string | null; // FREE, FREE OR CHEAP, LOW COST, PAID (from the step's own words)
  head: string; // the step's first phrase
  text: string; // the whole step
  trust?: 'ink' | 'pencil' | 'red';
  links: { href: string; label: string }[];
  letters?: boolean; // the links are draft letters, labelled by office
  action?: ReactNode;
}

/** Split an inquiry "next" item ("Free or cheap, and decisive: a builder's price …") into its cost tag
 *  and its first phrase. The tag is the step's own words before the colon, up to the first comma. */
export function stepFromText(text: string, letters: InquiryLetter[], letterHref: (office: string) => string): Step {
  const i = text.indexOf(': ');
  const tag = i > 0 && i < 48 ? text.slice(0, i).split(',')[0].trim().toUpperCase() : null;
  const rest = i > 0 && i < 48 ? text.slice(i + 2) : text;
  const cut = rest.search(/[.,;?](\s|$)/);
  const head = (cut > 0 ? rest.slice(0, cut) : rest).trim();
  // A step links to every letter whose office it names (the letter's own tab name, e.g. "City Real Estate").
  const links = letters.filter((l) => text.includes(l.tab)).map((l) => ({ href: letterHref(l.office), label: l.tab }));
  return { tag, head: head.charAt(0).toUpperCase() + head.slice(1), text, links, letters: true };
}

export interface TimelineEvent {
  at: string; // ISO time (or date)
  label: string;
  detail: string;
  kind: 'pull' | 'rule' | 'review' | 'refresh' | 'code';
  trust?: 'ink' | 'pencil' | 'red';
}

/** Records pulled at the same minute are one event (a pipeline run pulls a dozen files in seconds). */
export function pullEvents(rows: SourceRow[], where: string): TimelineEvent[] {
  const by = new Map<string, SourceRow[]>();
  for (const r of rows) {
    if (!r.pulled) continue;
    const k = r.pulled.length > 16 ? r.pulled.slice(0, 16) : r.pulled;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].map(([, rs]) => ({
    at: rs.map((r) => r.pulled!).sort()[0],
    label: rs.length === 1 ? `${rs[0].name} pulled` : `${rs.length} records pulled${where ? ` · ${where}` : ''}`,
    detail: rs.map((r) => r.name).join('; '),
    kind: 'pull' as const,
  }));
}

/** Rule checks and signatures: each rule's verification (grouped by who, when and level), then every
 *  entry in the review log. Assumptions set by a page link are not events and are left out. */
export function ruleEvents(sets: RuleSet[], audit: AuditEntry[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const by = new Map<string, EffectiveRule[]>();
  for (const rs of sets)
    for (const r of rs.rules) {
      const v = r.verification;
      if (!v.at || !v.reviewer) continue;
      const k = `${v.at}|${v.reviewer}|${v.role}|${v.level}`;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
  for (const [k, rules] of by) {
    const [at, reviewer, role, level] = k.split('|');
    const districts = [...new Set(rules.map((r) => (r.district === '*' ? 'citywide' : r.district)))].join(' and ');
    out.push({
      at,
      label: `${rules.length} ${districts.replace(/-/g, '‑')} rule${rules.length === 1 ? '' : 's'} ${level.replace(/_/g, '-')}`,
      detail: `${reviewer}${role && role !== 'null' ? `, ${role}` : ''}: ${rules.map((r) => `§${r.section}`).filter((x, i, a) => a.indexOf(x) === i).join(', ')}`,
      kind: 'rule',
      trust: rules.every((r) => r.state === 'ink') ? 'ink' : 'pencil',
    });
  }
  const retrieved = new Map<string, EffectiveRule[]>();
  for (const rs of sets) for (const r of rs.rules) if (r.retrieved) retrieved.set(r.retrieved, [...(retrieved.get(r.retrieved) ?? []), r]);
  for (const [d, rules] of retrieved) {
    const hosts = [...new Set(rules.map((r) => (r.source_url ? r.source_url.replace(/^https?:\/\//, '').split('/')[0] : 'the code')))].join(', ');
    out.push({ at: d, label: 'Code text saved', detail: `${rules.length} rule quotes matched to text saved from ${hosts}`, kind: 'code' });
  }
  for (const e of audit) {
    if (e.id.startsWith('link-')) continue;
    out.push({
      at: e.at,
      label: `${e.action.replace(/_/g, ' ')}${e.rule_id ? ` · ${e.rule_id}` : e.question_id ? ` · ${e.question_id}` : ''}`,
      detail: `${e.reviewer}, ${e.role}${e.decision ? `: ${e.decision}` : ''}`,
      kind: 'review',
      trust: e.action === 'source_checked' || e.action === 'city_confirmed' ? 'ink' : e.action === 'assumed' ? 'red' : 'pencil',
    });
  }
  return out;
}

interface RefreshMeta {
  run_at?: string;
  from?: string;
  to?: string;
  failed?: string[];
  datasets?: { id: string; changed: boolean | null }[];
}

export function refreshEvent(): TimelineEvent[] {
  const m = REFRESH?.meta as RefreshMeta | undefined;
  if (!m?.run_at) return [];
  const sets = m.datasets ?? [];
  return [
    {
      at: m.run_at,
      label: `Refresh: ${(REFRESH?.changes ?? []).length} values changed`,
      detail: `${sets.filter((d) => d.changed).length} of ${sets.length} datasets changed in content${m.failed?.length ? `; not re-pulled: ${m.failed.map((f) => f.replace(/^fetch /, '')).join(', ')}` : ''}`,
      kind: 'refresh',
    },
  ];
}

function ChangesPane({ pins }: { pins: string[] }) {
  const m = REFRESH?.meta as RefreshMeta | undefined;
  const changes: RefreshChange[] = REFRESH?.changes ?? [];
  if (!REFRESH || !m?.run_at) return <p className="small muted">No refresh has run yet: nothing to compare.</p>;
  const sets = m.datasets ?? [];
  const pulled = sets.filter((d) => d.changed != null);
  const changedSets = sets.filter((d) => d.changed);
  const byField = new Map<string, { n: number; scopes: Set<string> }>();
  for (const c of changes) {
    const cur = byField.get(c.field) ?? { n: 0, scopes: new Set<string>() };
    cur.n++;
    cur.scopes.add(c.scope);
    byField.set(c.field, cur);
  }
  const mine = changes.filter((c) => pins.includes(c.pin));
  const words = (f: string) => f.replace(/[_.]/g, ' ');
  return (
    <div className="ws-changes">
      <p>
        The last refresh ran {when(m.run_at)}. It re-pulled {pulled.length} of {sets.length} datasets; {changedSets.length} changed in content ({changedSets.map((d) => d.id).join(', ') || 'none'}). {changes.length} values changed
        {byField.size ? `: ${[...byField.entries()].map(([f, v]) => `${v.n} in ${words(f)} (${[...v.scopes].join(', ')} lots)`).join('; ')}` : ''}.{' '}
        {m.failed?.length ? `Not re-pulled (the fetch failed): ${m.failed.map((f) => f.replace(/^fetch /, '')).join(', ')}; their data stays as it was. ` : ''}A refresh never changes a rule or a review.
      </p>
      <p className="small">{pins.length ? (mine.length ? `This selection: ${mine.length} change${mine.length === 1 ? '' : 's'}, shown in pencil until someone checks it.` : 'This selection: no change on the last refresh.') : null}</p>
      <details className="small">
        <summary>Details</summary>
        <table className="lots-table">
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={i} data-trust="pencil" className="pencil-text">
                <td>{c.addr}</td>
                <td>{c.field}</td>
                <td>{JSON.stringify(c.before)}</td>
                <td>{JSON.stringify(c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <a href="?view=changes">All changes, datasets and the digest preview</a>
        </p>
      </details>
    </div>
  );
}

const TABS: { id: Exclude<TrayTab, 'closed'>; words: string }[] = [
  { id: 'next', words: 'What to check next' },
  { id: 'timeline', words: 'Evidence timeline' },
  { id: 'changes', words: 'Changes' },
];

export function Tray({ s, update, steps, stepsNote, events, pins, disclaimer }: { s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; steps: Step[]; stepsNote?: ReactNode; events: TimelineEvent[]; pins: string[]; disclaimer: boolean }) {
  const tab = s.tray ?? 'next';
  const open = tab !== 'closed';
  const [last, setLast] = useState<Exclude<TrayTab, 'closed'>>(tab === 'closed' ? 'next' : tab);
  const [step, setStep] = useState<number | null>(null);
  const cur = open ? (tab as Exclude<TrayTab, 'closed'>) : last;
  // Times come with different offsets ("…Z", "…-04:00") and some are bare dates: compare instants.
  const t = (x: string) => new Date(x.length <= 10 ? `${x}T00:00:00Z` : x).getTime() || 0;
  const sorted = [...events].sort((a, b) => t(a.at) - t(b.at));
  return (
    <section className={`ws-tray ${open ? 'is-open' : 'is-closed'}`} aria-label="Tray: what to check next, evidence and changes">
      <div className="ws-tray-bar">
        <div role="tablist" aria-label="Tray" className="ws-tray-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={open && cur === t.id}
              className={`ws-tray-tab ${open && cur === t.id ? 'is-on' : ''}`}
              data-tray={t.id}
              onClick={() => {
                setLast(t.id);
                update({ tray: t.id === 'next' ? null : t.id });
              }}
            >
              {t.words}
            </button>
          ))}
        </div>
        {disclaimer && <p className="ws-disclaimer">{DISCLAIMER}</p>}
        <button type="button" className="ws-tray-toggle" aria-expanded={open} onClick={() => update({ tray: open ? 'closed' : last === 'next' ? null : last })}>
          {open ? 'Hide' : 'Show'}
          <span aria-hidden="true">{open ? ' ▾' : ' ▴'}</span>
        </button>
      </div>
      {open && (
        <div className="ws-tray-body" role="tabpanel">
          {cur === 'next' ? (
            <>
              {stepsNote}
              {steps.length > 0 && (
                <ol className="ws-route">
                  {steps.map((st, i) => (
                    <li key={i} className={`ws-step ${step === i ? 'is-open' : ''}`} data-step={i + 1}>
                      <button type="button" className="ws-step-pick" aria-expanded={step === i} onClick={() => setStep(step === i ? null : i)} title={st.text}>
                        <span className="ws-step-n" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className="ws-step-head">{st.head}</span>
                      </button>
                      {st.tag && <span className={`ws-step-tag tag-${st.tag.split(' ')[0].toLowerCase()}`}>{st.tag}</span>}
                      {st.links.length > 0 && (
                        <span className="ws-step-links">
                          {st.letters ? 'Letter: ' : null}
                          {st.links.map((l, j) => (
                            <span key={l.href}>
                              {j ? ' · ' : ''}
                              <a className="ws-step-link" href={l.href} aria-label={st.letters ? `Letter to ${l.label}` : undefined}>
                                {l.label}
                              </a>
                            </span>
                          ))}
                        </span>
                      )}
                      {st.action}
                    </li>
                  ))}
                </ol>
              )}
              {step != null && steps[step] && (
                <p className={`ws-step-text small ${steps[step].trust === 'pencil' ? 'pencil-text' : ''}`} data-trust={steps[step].trust ?? 'pencil'}>
                  <strong>{step + 1}.</strong> {steps[step].text}
                </p>
              )}
            </>
          ) : cur === 'timeline' ? (
            sorted.length ? (
              <ol className="ws-timeline">
                {sorted.map((e, i) => (
                  <li key={i} className={`ws-ev ws-ev-${e.kind}`} data-trust={e.trust} title={e.detail}>
                    <span className="ws-ev-dot" aria-hidden="true" />
                    <span className="ws-ev-label">{e.label}</span>
                    <span className="ws-ev-when">{e.at.length <= 10 ? dateFmt(e.at) : when(e.at)}</span>
                    <span className="ws-ev-detail">{e.detail}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small muted">No recorded events for this selection.</p>
            )
          ) : (
            <ChangesPane pins={pins} />
          )}
        </div>
      )}
    </section>
  );
}


