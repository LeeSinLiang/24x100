// The Graph canvas (spec §0.15 P1), mounted in the workspace: engine/src/graph.ts builds the nodes from
// real records only; GraphCanvas draws the fixed cluster layout; a clicked node's details go to the
// inspector (GraphNodeDetail). The rail's node-type filters hide types without moving the rest.
import { useMemo, type ReactNode } from 'react';
import { buildGraph, combineOf, lettersOf, type GraphFocus, type LotGraph, type NodeType } from '@engine/graph';
import type { BlockFile } from '@engine/types';
import { GraphCanvas, NODE_TYPE_WORDS } from '../graph/GraphCanvas';
import { GraphNodeDetail } from '../graph/GraphNodeDetail';
import { COMPS_RAW_BY_WARD } from '../../lib/data';
import type { LotModel } from '../../lib/model';
import type { UrlState } from '../../lib/url';
import { Label } from '../ui';

export function useLotGraph(model: LotModel | null | undefined, block: BlockFile | undefined): LotGraph | null {
  return useMemo(() => {
    if (!model || !block) return null;
    const raw = block.meta.ward != null ? COMPS_RAW_BY_WARD[block.meta.ward] : undefined;
    return buildGraph({
      result: model.result,
      block: model.ctx.block,
      rs: model.ctx.rs,
      money: model.money,
      site: model.site,
      letters: lettersOf(model.inquiry),
      combine: combineOf(model.unlock, model.result),
      comps: raw ? { source: String(raw.meta.source), url: raw.meta.url ? String(raw.meta.url) : undefined, pulled: String(raw.meta.pulled) } : null,
    });
  }, [model, block]);
}

type Update = (p: Partial<UrlState>, o?: { push?: boolean }) => void;

export function GraphCanvasBody({ graph, focus, s, update, controls }: { graph: LotGraph | null; focus?: GraphFocus | null; s: UrlState; update: Update; controls?: ReactNode }) {
  const hidden = useMemo(() => new Set(s.ghide as NodeType[]), [s.ghide.join(',')]);
  if (!graph)
    return (
      <div className="ws-canvas-body ws-graph-slot" role="status">
        <p className="label">Graph</p>
        <p>The graph is drawn for one lot or a combined group on a block with lot detail. Pick a lot on the map or search for one.</p>
      </div>
    );
  return (
    <div className="ws-canvas-body is-graph">
      <GraphCanvas
        graph={graph}
        focus={focus ?? null}
        selected={s.node}
        onSelect={(id) => update({ node: id }, { push: true })}
        onFocus={(id) => update({ focus: id }, { push: true })}
        hidden={hidden}
        controls={controls}
      />
    </div>
  );
}

export function GraphRailFilters({ graph, s, update }: { graph: LotGraph | null; s: UrlState; update: Update }) {
  const counts = useMemo(() => {
    const m = new Map<NodeType, number>();
    for (const n of graph?.nodes ?? []) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return m;
  }, [graph]);
  const hidden = new Set(s.ghide);
  const types = (Object.keys(NODE_TYPE_WORDS) as NodeType[]).filter((t) => t !== 'lot' && counts.get(t));
  return (
    <section className="ws-rail-sec" data-slot="graph-filters">
      <Label as="h2">Node types</Label>
      {!graph ? (
        <p className="small muted">Pick a lot to draw its graph.</p>
      ) : (
        <div className="ws-layers">
          {types.map((t) => (
            <label key={t} className="ws-layer" data-node-type={t}>
              <input
                type="checkbox"
                checked={!hidden.has(t)}
                onChange={(e) => update({ ghide: e.target.checked ? s.ghide.filter((x) => x !== t) : [...s.ghide, t] })}
              />
              <span className="ws-layer-pad" aria-hidden="true" />
              <span className="ws-layer-name">{NODE_TYPE_WORDS[t]}</span>
              <span className="ws-layer-n">{counts.get(t)}</span>
            </label>
          ))}
        </div>
      )}
      {s.focus && graph ? (
        <p className="small" data-graph-focus-note>
          Focus: only the chain behind one decision is drawn; these filters apply when the whole graph is shown.{' '}
          <button type="button" className="link" onClick={() => update({ focus: null }, { push: true })}>
            Show all
          </button>
        </p>
      ) : null}
      <p className="small muted">Every node is a real record: a parcel, a rule and its quote, a signature, a dataset, an estimate, a sale, a site check or an office.</p>
    </section>
  );
}

export function GraphInspector({ graph, s, update }: { graph: LotGraph; s: UrlState; update: Update }) {
  const node = graph.nodes.find((n) => n.id === s.node);
  if (!node) return null;
  return (
    <aside className="ws-inspector ws-graph-inspector" aria-label="Selected node">
      <p className="gnd-actions">
        <button className="link small" onClick={() => update({ node: null }, { push: true })}>
          ← Back to the lot
        </button>
        {node.cluster !== 'center' && s.focus !== node.id ? (
          <button type="button" className="btn btn-small" data-graph-control="focus-node" onClick={() => update({ focus: node.id }, { push: true })} title="Show only the chain behind this node's decision">
            Focus on this chain
          </button>
        ) : s.focus ? (
          <button type="button" className="btn btn-small" onClick={() => update({ focus: null }, { push: true })}>
            Show the whole graph
          </button>
        ) : null}
      </p>
      <GraphNodeDetail node={node} graph={graph} onSelect={(id: string | null) => update({ node: id }, { push: true })} />
    </aside>
  );
}
