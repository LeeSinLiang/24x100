// The Sources tab (spec §0.15): the records with their pull times and URLs, the money inputs with who
// supplied them, and the rules with their verbatim quotes. Everything here is read from the files.
import { useState } from 'react';
import type { Comps, RuleSet } from '@engine/types';
import { fieldName } from '../Drawer';
import { Chip, dateFmt, Label } from '../ui';
import { ASSUMPTIONS, COMPS_RAW_BY_WARD, HUD } from '../../lib/data';
import { EstimateMark } from '../Panels';
import { Gloss } from './plain';

export interface SourceRow {
  id?: string;
  name: string;
  pulled?: string | null;
  url?: string | null;
  sha256?: string | null;
  note?: string | null;
}

/** "26 Sep 2026, 5:18 PM" in Pittsburgh time; a bare date stays a date. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length <= 10) return dateFmt(iso);
  return `${dateFmt(iso)}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
}

/** Who publishes a record, from its own name (or its link's host when the name doesn't say). */
export function publisherOf(r: SourceRow): string {
  if (/^City of Pittsburgh\b/.test(r.name)) return 'City of Pittsburgh';
  if (/^WPRDC\b/.test(r.name)) return 'WPRDC (Allegheny County)';
  if (/^OpenStreetMap\b/.test(r.name)) return 'OpenStreetMap';
  if (/^HUD\b/.test(r.name)) return 'HUD';
  return r.url ? hostOf(r.url) : 'Other';
}
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}
/** The record's name without the publisher the group heading already says. */
function shortName(r: SourceRow, pub: string): string {
  const cut = pub === 'City of Pittsburgh' ? /^City of Pittsburgh\s+/ : pub.startsWith('WPRDC') ? /^WPRDC\s+/ : null;
  return cut ? r.name.replace(cut, '') : r.name;
}

/** The records, grouped by who publishes them (team review, round 3: a long flat table). A group's pull time is
 *  said once when all its records were pulled in the same minute; otherwise each record keeps its own. */
export function RecordList({ rows, title }: { rows: SourceRow[]; title: string }) {
  if (!rows.length) return null;
  const groups = new Map<string, SourceRow[]>();
  for (const r of rows) groups.set(publisherOf(r), [...(groups.get(publisherOf(r)) ?? []), r]);
  return (
    <section className="ws-src" aria-label={title}>
      <Label as="h3">{title}</Label>
      <div className="ws-src-groups">
        {[...groups.entries()].map(([pub, rs]) => {
          const minutes = new Set(rs.map((r) => (r.pulled ?? '').slice(0, 16)));
          const once = minutes.size === 1 && rs[0].pulled ? rs[0].pulled : null;
          return (
            <section key={pub} className="ws-src-group" data-publisher={pub} aria-label={`${pub}: ${rs.length} ${rs.length === 1 ? 'record' : 'records'}`}>
              <p className="ws-src-group-head">
                <strong>{pub}</strong>{' '}
                <span className="muted">
                  · {rs.length} {rs.length === 1 ? 'record' : 'records'}
                  {once ? ` · pulled ${when(once)}` : ''}
                </span>
              </p>
              <ul className="ws-src-rows">
                {rs.map((r) => (
                  <li key={(r.id ?? '') + r.name} data-source={r.id}>
                    <span className="ws-src-name">{shortName(r, pub)}</span>
                    {r.note ? <span className="ws-src-note">{r.note}</span> : null}
                    <span className="ws-src-meta">
                      {!once && r.pulled ? <span className="nowrap">pulled {when(r.pulled)} · </span> : null}
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" title={r.url}>
                          {hostOf(r.url)}
                        </a>
                      ) : (
                        <span className="muted">no link</span>
                      )}
                      {r.sha256 ? (
                        <span className="ws-src-sha" title={`sha256 ${r.sha256}`}>
                          {' '}
                          · {r.sha256.slice(0, 8)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/** Money inputs: the sales file, HUD income limits, and every assumption with who supplied it. */
export function MoneySources({ comps }: { comps: Comps | null }) {
  const rows: SourceRow[] = [
    ...(comps
      ? [{ id: 'comps', name: `${comps.meta.source} (Ward ${comps.meta.ward ?? '—'})`, pulled: comps.meta.pulled, url: comps.meta.ward != null ? String(COMPS_RAW_BY_WARD[comps.meta.ward]?.meta.url ?? '') || null : null }]
      : []),
    ...(HUD ? [{ id: 'hud', name: `HUD FY2026 Income Limits: ${HUD.area_name}`, pulled: HUD.pulled, url: HUD.source_url }] : []),
  ];
  return (
    <>
      <RecordList rows={rows} title="Money records" />
      <section className="ws-src" aria-label="Money inputs">
        <Label as="h3">Money inputs</Label>
        <ul className="ws-src-inputs">
          {ASSUMPTIONS.map((a) => {
            const est = /practitioner/.test(a.supplied_by ?? '');
            return (
              <li key={a.key} className={est ? 'is-est' : 'is-red'} data-trust={est ? 'estimate' : 'red'}>
                {est ? <EstimateMark /> : <span className="mark mark-red" role="img" aria-label="your assumption" />} <span className={est ? 'est' : 'red'}>{a.label}</span>{' '}
                <span className="muted">
                  · {Array.isArray(a.value) ? a.value.join('–') : String(a.value)} · {est ? 'practitioner estimate' : 'your assumption'}, {a.supplied_by}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/** The rules used, each a line that opens its verbatim quote, state and source: one at a time (team review,
 *  round 3: every quote open at once made a wall of text). The section chip still opens the evidence drawer. */
export function RuleSources({ rs }: { rs: RuleSet }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rs.rules.length) return <p className="na">— no rules loaded for {rs.district}.</p>;
  return (
    <section className="ws-src" aria-label="Rules">
      <Label as="h3">
        Rules · <Gloss k="district">{rs.district.replace(/-/g, '‑')}</Gloss> · <Gloss k="trust">ink, pencil, struck</Gloss>
      </Label>
      <ul className="ws-rules">
        {rs.rules.map((r) => {
          const on = open === r.id;
          const stateWords = r.state === 'ink' ? (r.sealed ? 'City-confirmed' : r.ai_checked ? 'ink · AI-checked, needs a teammate' : 'ink') : r.state;
          return (
            <li key={r.id} data-trust={r.state === 'ink' ? 'ink' : r.state} data-rule-id={r.id} className={on ? 'is-open' : ''}>
              <p className="ws-rule-head">
                <Chip refId={`rule:${r.id}`} trust={r.state === 'ink' ? 'ink' : 'pencil'}>
                  §{r.section}
                </Chip>{' '}
                <button type="button" className="ws-rule-toggle" aria-expanded={on} aria-controls={`ws-rq-${r.id}`} onClick={() => setOpen(on ? null : r.id)}>
                  <span className={r.state === 'ink' ? 'ws-rule-name' : r.state === 'struck' ? 'ws-rule-name ev-struck' : 'ws-rule-name pencil-text'}>{fieldName(r.field)}</span>
                  <span className="muted small"> · {stateWords}</span>
                  <span className="ws-rule-caret" aria-hidden="true">
                    {on ? '▾' : '▸'}
                  </span>
                </button>
              </p>
              {on && (
                <div id={`ws-rq-${r.id}`} className="ws-rule-body">
                  <blockquote className={`ws-quote ${r.state === 'ink' ? '' : 'is-pencil'}`}>“{r.quote}”</blockquote>
                  {/* Who proposed it and who checked it, as the rule record says (the model for an extracted rule). */}
                  <p className="small muted" data-rule-origin={r.origin}>
                    {r.origin === 'extracted' && r.model ? (
                      <span data-rule-model={r.model}>
                        Proposed by {r.model}
                        {r.prompt_sha ? ` (prompt ${String(r.prompt_sha).slice(0, 8)})` : ''}
                      </span>
                    ) : (
                      'From the team’s research notes (the answer key)'
                    )}
                    {r.verification.reviewer && r.verification.level !== 'unreviewed' ? ` · checked by ${r.verification.reviewer}${r.verification.role ? ` (${r.verification.role})` : ''}` : ' · not checked by a person yet'}
                  </p>
                  {r.source_url ? (
                    <p className="small muted">
                      <a href={r.source_url} target="_blank" rel="noreferrer">
                        {r.source_url.replace(/^https?:\/\//, '')}
                      </a>
                      {r.retrieved ? ` · saved ${dateFmt(r.retrieved)}` : ''}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
