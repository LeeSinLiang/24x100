// The Graph canvas slot (spec §0.15 P1). The graph view (engine/src/graph.ts, components/graph/*) is
// being built separately; until it lands this slot says so plainly and does not pretend to be done.
export function GraphSlot() {
  return (
    <div className="ws-graph-slot" role="status" data-slot="graph">
      <p className="label">Graph</p>
      <p>The graph view is being added.</p>
      <p className="small muted">It will link this selection to its rules, records, estimates and offices, from real objects only. Map, Plan and Table show the same selection now.</p>
    </div>
  );
}
