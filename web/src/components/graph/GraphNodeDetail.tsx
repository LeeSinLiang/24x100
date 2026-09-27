// What the inspector shows for a node clicked in the Graph view (spec §0.15 P1): its quote, its source
// link and date, its signer, the rest of its record, and what it links to. Every word comes from the
// node and the graph (engine/src/graph.ts); nothing here is looked up or computed anew.
import type { JSX, ReactNode } from 'react';
import { trustWords, type EdgeKind, type GraphNode, type LotGraph } from '@engine/graph';
import { NODE_TYPE_WORDS } from './GraphCanvas';
import '../../styles/graph.css';

const MARK: Record<GraphNode['trust'], string> = { ink: 'ink', pencil: 'pencil', red: 'red', estimate: 'estimate', unknown: 'unknown' };

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Where a node's source is, in words and a link. */
function SourceLine({ n }: { n: GraphNode }): ReactNode {
  const s = n.source;
  const when = s.pulled ? (n.type === 'person' ? `signed ${s.pulled.slice(0, 10)}` : /^\d{4}-\d{2}-\d{2}$/.test(s.pulled) ? `retrieved ${s.pulled}` : `pulled ${s.pulled}`) : null;
  if (s.kind === 'review')
    return (
      <p className="gnd-source">
        Review log entry <code>{s.ref}</code>
        {s.pulled ? ` · ${s.pulled}` : ''}
      </p>
    );
  if (s.kind === 'engine')
    return <p className="gnd-source">From the engine’s result for this lot{n.type === 'office' ? ' (the draft inquiry)' : n.type === 'site' ? ' (site unknowns)' : ''}.</p>;
  if (s.kind === 'estimate') return <p className="gnd-source">From the money screen’s practitioner estimates (data/assumptions.json).</p>;
  return (
    <p className="gnd-source">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer">
          {n.type === 'rule' || n.type === 'quote' ? 'The code text' : n.type === 'person' ? 'The rule record' : 'The dataset'} · {host(s.url)}
        </a>
      ) : n.type === 'person' ? (
        <>Recorded in the rule file’s verification (rule {s.ref})</>
      ) : (
        <>Record {s.ref}</>
      )}
      {when ? ` · ${when}` : ''}
    </p>
  );
}

export function GraphNodeDetail(p: { node: GraphNode; graph: LotGraph; onSelect?: (id: string) => void }): JSX.Element {
  const { node: n, graph } = p;
  const byId = new Map(graph.nodes.map((x) => [x.id, x]));
  const out = graph.edges.filter((e) => e.from === n.id);
  const inn = graph.edges.filter((e) => e.to === n.id);
  const rule = n.type === 'rule' ? n : n.type === 'quote' ? byId.get(inn.find((e) => e.kind === 'cites')?.from ?? '') : undefined;
  const quote = n.type === 'quote' ? n : rule ? byId.get(graph.edges.find((e) => e.kind === 'cites' && e.from === rule.id)?.to ?? '') : undefined;
  const signer = rule ? byId.get(graph.edges.find((e) => e.kind === 'signed by' && e.from === rule.id)?.to ?? '') : undefined;
  const shown = new Set(['Signed']);
  const links: { kind: EdgeKind; dir: 'out' | 'in'; other: GraphNode }[] = [
    ...out.map((e) => ({ kind: e.kind, dir: 'out' as const, other: byId.get(e.to)! })),
    ...inn.map((e) => ({ kind: e.kind, dir: 'in' as const, other: byId.get(e.from)! })),
  ].filter((l) => l.other);

  return (
    <section className={`gnd t-${n.trust}`} data-node={n.id} aria-label={`${NODE_TYPE_WORDS[n.type]}: ${n.label}`}>
      <p className="gnd-kicker">{NODE_TYPE_WORDS[n.type]}</p>
      <h3 className="gnd-title">{n.type === 'quote' && rule ? rule.sub?.split(' · ')[0] ?? 'Quote' : n.label}</h3>
      {n.sub && n.type !== 'quote' && <p className="gnd-sub">{n.sub}</p>}
      {n.status && <p className="gnd-status">{n.status}</p>}
      <p className="gnd-trust">
        <span className={`gnd-mark m-${MARK[n.trust]}`} aria-hidden="true" /> <span>{n.detail.find((d) => d.k === 'State')?.v ?? trustWords(n.trust)}</span>{' '}
        {n.ai && <span className="gnd-ai">{n.type === 'person' ? 'An AI check, not a person' : 'AI-checked · needs a teammate'}</span>}
      </p>

      {quote?.quote && (
        <figure className="gnd-quote-box">
          <blockquote className={`gnd-quote t-${quote.trust}`}>{quote.quote}</blockquote>
          <figcaption className="gnd-cite">{quote.sub}</figcaption>
        </figure>
      )}

      {rule && (
        <div className={`gnd-signer${rule.signed?.ai ? ' is-ai' : ''}`}>
          {rule.signed ? (
            <>
              <p className="gnd-signer-line">
                <span className="gnd-label">Signed by</span> {rule.signed.by} <span className="gnd-muted">({rule.signed.role})</span>
                {rule.signed.at ? <span className="gnd-muted"> · {rule.signed.at.slice(0, 10)}</span> : null}
              </p>
              <p className="gnd-muted gnd-small">
                {rule.signed.ai ? 'An AI check (the research pass), not a person’s review. ' : ''}
                {rule.signed.action === 'city_confirmed' ? 'Recorded a City confirmation' : 'Source-checked'}
                {rule.signed.review ? ', in the review log.' : ', recorded in the rule file.'}
              </p>
            </>
          ) : (
            <p className="gnd-signer-line">
              <span className="gnd-label">Not signed</span> <span className="gnd-muted">Pencil until a person source-checks it.</span>
            </p>
          )}
          {signer && p.onSelect && (
            <button type="button" className="gnd-link" onClick={() => p.onSelect!(signer.id)}>
              Show the signer
            </button>
          )}
        </div>
      )}

      <SourceLine n={n} />

      <table className="gnd-kv">
        <tbody>
          {n.detail
            .filter((d) => !(rule === n && shown.has(d.k)) && d.k !== 'State')
            .map((d, i) => (
              <tr key={`${d.k}-${i}`}>
                <th scope="row">{d.k}</th>
                <td>{/^https?:\/\//.test(d.v) ? <a href={d.v} target="_blank" rel="noreferrer">{d.v}</a> : d.v}</td>
              </tr>
            ))}
        </tbody>
      </table>

      {links.length > 0 && (
        <div className="gnd-links">
          <p className="gnd-label">Links</p>
          <ul>
            {links.map((l, i) => (
              <li key={`${l.kind}-${l.other.id}-${i}`}>
                <span className="gnd-edge">{l.dir === 'out' ? `${l.kind} →` : `← ${l.kind}`}</span>{' '}
                {p.onSelect ? (
                  <button type="button" className="gnd-link" onClick={() => p.onSelect!(l.other.id)}>
                    {l.other.type === 'quote' ? `quote, ${l.other.sub?.split(' · ')[0] ?? ''}` : l.other.label}
                  </button>
                ) : (
                  <span>{l.other.type === 'quote' ? `quote, ${l.other.sub?.split(' · ')[0] ?? ''}` : l.other.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
