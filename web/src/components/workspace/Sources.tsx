// The Sources tab (spec §0.15): the records with their pull times and URLs, the money inputs with who
// supplied them, and the rules with their verbatim quotes. Everything here is read from the files.
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

export function RecordList({ rows, title }: { rows: SourceRow[]; title: string }) {
  if (!rows.length) return null;
  return (
    <section className="ws-src" aria-label={title}>
      <Label as="h3">{title}</Label>
      <table className="ws-src-table">
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Pulled</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={(r.id ?? '') + r.name} data-source={r.id}>
              <th scope="row">
                {r.name}
                {r.note ? <span className="ws-src-note">{r.note}</span> : null}
              </th>
              <td className="nowrap">{when(r.pulled)}</td>
              <td className="ws-src-url">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" title={r.url}>
                    {(() => {
                      try {
                        return new URL(r.url).hostname.replace(/^www\./, '');
                      } catch {
                        return 'link';
                      }
                    })()}
                  </a>
                ) : (
                  '—'
                )}
                {r.sha256 ? (
                  <span className="ws-src-sha" title={`sha256 ${r.sha256}`}>
                    {' '}
                    · {r.sha256.slice(0, 8)}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

/** The rules used, with their verbatim quotes, state and source. Each section opens its evidence. */
export function RuleSources({ rs }: { rs: RuleSet }) {
  if (!rs.rules.length) return <p className="na">— no rules loaded for {rs.district}.</p>;
  return (
    <section className="ws-src" aria-label="Rules">
      <Label as="h3">
        Rules · <Gloss k="district">{rs.district.replace(/-/g, '‑')}</Gloss> · <Gloss k="trust">ink, pencil, struck</Gloss>
      </Label>
      <ul className="ws-rules">
        {rs.rules.map((r) => (
          <li key={r.id} data-trust={r.state === 'ink' ? 'ink' : r.state} data-rule-id={r.id}>
            <p className="ws-rule-head">
              <Chip refId={`rule:${r.id}`} trust={r.state === 'ink' ? 'ink' : 'pencil'}>
                §{r.section}
              </Chip>{' '}
              <strong className={r.state === 'ink' ? '' : r.state === 'struck' ? 'ev-struck' : 'pencil-text'}>{fieldName(r.field)}</strong>
              <span className="muted small"> · {r.state === 'ink' ? (r.sealed ? 'City-confirmed' : r.ai_checked ? 'ink · AI-checked, needs a teammate' : 'ink') : r.state}</span>
            </p>
            <blockquote className={`ws-quote ${r.state === 'ink' ? '' : 'is-pencil'}`}>“{r.quote}”</blockquote>
            {r.source_url ? (
              <p className="small muted">
                <a href={r.source_url} target="_blank" rel="noreferrer">
                  {r.source_url.replace(/^https?:\/\//, '')}
                </a>
                {r.retrieved ? ` · saved ${dateFmt(r.retrieved)}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
