// What changed since the last pull. Differences are pencil: they are what the new pull says, not yet
// checked by a person. A refresh never touches a rule or a review; signatures are listed from the
// audit log as they stand. The watchlist digest is shown as a dry run and is never sent from here.
import type { ReactNode } from 'react';
import type { AuditEntry } from '@engine/types';
import { fieldName } from '../components/Drawer';
import { Label, dateFmt } from '../components/ui';
import { BLOCKS, RULES } from '../lib/data';
import { lotKey } from '../lib/model';
import type { ViewProps } from './types';
import '../styles/changes.css';

interface Dataset {
  id: string;
  rows_before: number | null;
  rows_after: number | null;
  sha_before: string | null;
  sha_after: string | null;
  changed: boolean;
}
interface Change {
  pin: string;
  addr: string;
  block: string | null;
  scope: string;
  field: string;
  before: unknown;
  after: unknown;
  kind: string;
}
interface RefreshFile {
  meta: { run_at: string; from: string; to: string; datasets: Dataset[] };
  changes: Change[];
  code: { file: string; changed: boolean; note: string }[];
  summary: unknown;
}

type Glob<T> = Record<string, T>;
const latestFiles = import.meta.glob('../../../data/refresh/latest.json', { eager: true, import: 'default' }) as Glob<RefreshFile>;
const fixtureFiles = import.meta.glob('../../../data/refresh/vs-research-fixture.json', { eager: true, import: 'default' }) as Glob<RefreshFile>;
const digestFiles = import.meta.glob('../../../data/refresh/digest-preview.md', { eager: true, query: '?raw', import: 'default' }) as Glob<string>;

const LATEST: RefreshFile | null = Object.values(latestFiles)[0] ?? null;
const VS_FIXTURE: RefreshFile | null = Object.values(fixtureFiles)[0] ?? null;
const DIGEST: string | null = Object.values(digestFiles)[0] ?? null;

/** Dataset ids → the names the block files give them (with their pull dates). */
const SOURCE_NAMES: Map<string, string> = new Map(Object.values(BLOCKS).flatMap((b) => b.meta.sources.map((x) => [x.id, x.name] as const)));

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length <= 10) return dateFmt(iso);
  return `${dateFmt(iso)}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
}

function val(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? dateFmt(v) : v;
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return JSON.stringify(v);
}

/** A list that changed, in words: "added Children's Way" rather than two arrays. */
function listDiff(before: unknown, after: unknown): string | null {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const b = new Set(before.map(String));
  const a = new Set(after.map(String));
  const added = [...a].filter((x) => !b.has(x));
  const removed = [...b].filter((x) => !a.has(x));
  const parts = [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : ''].filter(Boolean);
  return parts.length ? parts.join('; ') : 'reordered';
}

const FIELD_WORDS: Record<string, string> = { 'streets.names': 'street names nearby (OpenStreetMap)', city: 'City-owned lot' };
function words(s: string): string {
  return FIELD_WORDS[s] ?? s.replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim();
}

function blockLot(c: Change): { href: string; label: string } | null {
  const b = c.block ? BLOCKS[c.block] : Object.values(BLOCKS).find((x) => x.parcels.some((p) => p.pin === c.pin));
  const p = b?.parcels.find((x) => x.pin === c.pin);
  if (!b || !p) return null;
  return { href: `?view=lot&block=${b.meta.id}&lot=${lotKey(p)}`, label: `lot ${lotKey(p)}, ${b.meta.name.replace(/-/g, '‑')}` };
}

/** A small, safe Markdown reader for the digest preview: headings, lists, quotes, paragraphs and
 *  inline bold, italic, code and links. No HTML is ever injected. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      const safe = /^(https?:|\?|\.|\/)/.test(mm[2]) ? mm[2] : undefined;
      out.push(
        <a key={k++} href={safe}>
          {mm[1]}
        </a>,
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
    para = [];
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      blocks.push(lvl === 1 ? <h3 key={blocks.length}>{inline(h[2])}</h3> : <h4 key={blocks.length}>{inline(h[2])}</h4>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) flush();
      list.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (/^>\s?/.test(line)) {
      flush();
      blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^>\s?/, ''))}</blockquote>);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={blocks.length} />);
    } else if (!line.trim()) flush();
    else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <>{blocks}</>;
}

function Summary({ s }: { s: unknown }) {
  if (s == null) return null;
  if (typeof s === 'string') return <p className="chg-summary">{s}</p>;
  if (typeof s === 'object')
    return (
      <p className="chg-summary">
        {Object.entries(s as Record<string, unknown>)
          .map(([k, v]) => `${words(k)}: ${val(v)}`)
          .join(' · ')}
      </p>
    );
  return <p className="chg-summary">{String(s)}</p>;
}

function Differences({ f, idPrefix }: { f: RefreshFile; idPrefix: string }) {
  const groups = new Map<string, Change[]>();
  for (const c of f.changes ?? []) groups.set(c.kind, [...(groups.get(c.kind) ?? []), c]);
  const changedSets = (f.meta.datasets ?? []).filter((d) => d.changed).length;
  return (
    <>
      <section className="chg-section" aria-labelledby={`${idPrefix}-moved`}>
        <Label as="h2">
          <span id={`${idPrefix}-moved`}>What moved · {(f.changes ?? []).length}</span>
        </Label>
        {(f.changes ?? []).length === 0 ? (
          <p className="muted">No differences in the lots we watch.</p>
        ) : (
          [...groups.entries()].map(([kind, cs]) => (
            <div key={kind} className="chg-group">
              <h3 className="chg-kind">
                {words(kind)} · {cs.length}
              </h3>
              <ul className="chg-list">
                {cs.map((c, i) => {
                  const bl = blockLot(c);
                  return (
                    <li key={`${c.pin}-${c.field}-${i}`}>
                      <span className="chg-where">
                        {bl ? <a href={bl.href}>{c.addr}</a> : c.addr}
                        <span className="small muted"> · {bl ? bl.label : words(c.scope)}</span>
                      </span>
                      <span className="chg-line">
                        {words(c.field)}:{' '}
                        {c.before == null || c.before === '' ? (
                          <>{val(c.after)} (new)</>
                        ) : c.after == null || c.after === '' ? (
                          <>{val(c.before)} (gone)</>
                        ) : listDiff(c.before, c.after) ? (
                          <span title={`${val(c.before)} → ${val(c.after)}`}>{listDiff(c.before, c.after)}</span>
                        ) : (
                          <>
                            {val(c.before)} <span aria-label="became">→</span> {val(c.after)}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="chg-section" aria-labelledby={`${idPrefix}-sets`}>
        <Label as="h2">
          <span id={`${idPrefix}-sets`}>
            Datasets · {changedSets} of {(f.meta.datasets ?? []).length} changed
          </span>
        </Label>
        <table className="lots-table chg-sets">
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col" className="num">
                Rows before
              </th>
              <th scope="col" className="num">
                Rows after
              </th>
              <th scope="col">Result</th>
              <th scope="col">Fingerprint</th>
            </tr>
          </thead>
          <tbody>
            {(f.meta.datasets ?? []).map((d) => (
              <tr key={d.id} className={d.changed ? 'is-changed' : ''}>
                <td>
                  {SOURCE_NAMES.get(d.id) ?? words(d.id)}
                  {SOURCE_NAMES.has(d.id) ? <span className="small muted"> · {d.id}</span> : null}
                </td>
                <td className="num">{val(d.rows_before)}</td>
                <td className="num">{val(d.rows_after)}</td>
                <td>{d.changed ? <span className="chg-pencil">changed</span> : 'unchanged'}</td>
                <td className="chg-sha">
                  {(d.sha_before ?? '—').slice(0, 8)}
                  {d.changed ? ` → ${(d.sha_after ?? '—').slice(0, 8)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(f.code ?? []).length > 0 && (
          <ul className="chg-code small">
            {f.code.map((c) => (
              <li key={c.file}>
                Saved code text <span className="nowrap">{c.file.split('/').pop()}</span>: {c.changed ? <span className="chg-pencil">changed</span> : 'unchanged'}
                {c.note ? <span className="muted"> · {c.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const SIGN_WORDS: Record<string, string> = {
  source_checked: 'signed as source-checked',
  city_confirmed: 'recorded a City confirmation',
  struck: 'struck',
  reopened: 'reopened',
};

function Signatures({ audit, since }: { audit: AuditEntry[]; since: string | null }) {
  const rows = audit
    .filter((e) => e.rule_id && SIGN_WORDS[e.action] && !e.id.startsWith('link-'))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className="chg-section" aria-labelledby="chg-signed">
      <Label as="h2">
        <span id="chg-signed">Rules signed or struck · newest first</span>
      </Label>
      <p className="chg-note">A refresh never overwrites a person’s review. It re-pulls public data and lists what moved; every rule and signature stays exactly as it was.</p>
      {rows.length === 0 ? (
        <p className="small muted">
          No one has signed a rule yet. Signatures made on the <a href="?view=review&district=RM-M">rules screen</a> appear here with who, role and when.
        </p>
      ) : (
        <ol className="chg-signs">
          {rows.slice(0, 12).map((e) => {
            const r = RULES.find((x) => x.id === e.rule_id);
            const fresh = since && Date.parse(e.at) > Date.parse(since);
            return (
              <li key={e.id}>
                <span className="chg-who">
                  <strong>{e.reviewer}</strong> <span className="muted">({e.role})</span> {SIGN_WORDS[e.action]}
                </span>
                <span className="chg-rule">
                  {r ? (
                    <>
                      §{r.section} · {fieldName(r.field)} · {r.district.replace(/-/g, '‑')}
                    </>
                  ) : (
                    e.rule_id
                  )}
                </span>
                <span className="small muted">
                  {when(e.at)}
                  {fresh ? <span className="chg-fresh"> · since the last refresh</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Digest() {
  return (
    <section className="chg-digest" aria-labelledby="chg-digest-h">
      <header className="chg-digest-head">
        <Label as="h2">
          <span id="chg-digest-h">Watchlist digest · preview</span>
        </Label>
        <span className="stamp stamp-refuse chg-stamp">DRY RUN · NOT SENT</span>
      </header>
      <div className="chg-digest-body">{DIGEST ? <Markdown text={DIGEST} /> : <p className="muted">No digest preview yet.</p>}</div>
      <footer className="chg-digest-foot small">
        <p>
          Preview it with <code>uv run python -m pipeline digest --dry-run</code>.
        </p>
        <p>Sending needs a Slack webhook or SMTP credentials that you supply, and it is off by default. Inquiries are never sent automatically: they are drafts, and you send them.</p>
      </footer>
    </section>
  );
}

export function ChangesView({ audit }: ViewProps) {
  const f = LATEST;
  return (
    <main className="changes-view" id="main">
      <header className="chg-head">
        <h1 className="chg-title">What changed</h1>
        {f ? (
          <p className="chg-sub">
            Last refresh {when(f.meta.run_at)} · compared the pull of {when(f.meta.from)} with {when(f.meta.to)}. Differences are in pencil: they are what the new pull says, not yet checked by a person.
          </p>
        ) : (
          <p className="chg-sub">
            No refresh has run yet. Run <code>npm run refresh</code>.
          </p>
        )}
        {f && <Summary s={f.summary} />}
      </header>

      <div className="chg-cols">
        <div className="chg-main">
          {f ? (
            <Differences f={f} idPrefix="latest" />
          ) : (
            <section className="chg-section na">
              <p>
                Nothing to compare yet. A refresh re-pulls the public datasets, compares them with the last snapshot and writes the differences here, in pencil. It changes no rule and no review.
              </p>
            </section>
          )}
          {VS_FIXTURE && (
            <details className="chg-fixture">
              <summary>
                vs the pre-kickoff research pull · {(VS_FIXTURE.changes ?? []).length} {(VS_FIXTURE.changes ?? []).length === 1 ? 'difference' : 'differences'}
              </summary>
              <p className="small muted">The same comparison against the research fixture pulled before the hackathon began.</p>
              <Summary s={VS_FIXTURE.summary} />
              <Differences f={VS_FIXTURE} idPrefix="fixture" />
            </details>
          )}
        </div>
        <div className="chg-side">
          <Digest />
          <Signatures audit={audit} since={f?.meta.run_at ?? null} />
        </div>
      </div>
    </main>
  );
}
