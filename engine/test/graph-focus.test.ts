// Focus mode (team review, round 3): the chain behind one decision is a filter over the real graph, never an
// addition. For lot 25 two-unit, focusing the interior side setback keeps the lot, that rule and the
// contextual rule (the width's note), their quotes, the signer, the datasets and neighbours the width and its
// note were read from, and the zoning map; and it keeps the engine's width check as the result (4 ft).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInquiry, buildRuleSet, checkQuote, DEFAULT_SETTINGS, evaluate, moneyFor, siteUnknowns, unlockSearch, withQuoteStatus, type AuditEntry, type Assumption, type Comps, type Hud, type Rule, type TemplateId } from '../src';
import { buildGraph, combineOf, focusGraph, layoutFocus, lettersOf, type LotGraph } from '../src/graph';
import { baseRules, block10K, questions, scen } from './load';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const b = block10K();
const rules = (): Rule[] =>
  withQuoteStatus(
    [...baseRules(), ...J('data/rules/extracted/r1d-h.json').rules, ...J('data/rules/extracted/rm-m.json').rules],
    (f) => {
      try {
        return readFileSync(`data/code/${f.split('/').pop()}`, 'utf8');
      } catch {
        return null;
      }
    },
    checkQuote,
  );
const raw = J('data/money/comps_ward5.json');
const comps: Comps = { ...raw, newest: raw.newest_built, meta: { ...raw.meta, ward: 5 } };
const h = J('data/money/hud_fy2026.json');
const hud: Hud = { area_name: h.hud_area_name, median: h.median_family_income, l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h[`l80_${i}`]), source_url: h.meta.url, pulled: h.meta.pulled };
const assumptions: Assumption[] = J('data/assumptions.json');
const reviews = J('data/rules/reviews.json');
const audit: AuditEntry[] = Array.isArray(reviews) ? reviews : reviews.entries;

function graphFor(type: TemplateId, lots: number[]) {
  const ctx = { block: b, rs: buildRuleSet('RM-M', rules(), questions(), audit), settings: DEFAULT_SETTINGS };
  const s = scen(b, type, lots);
  const result = evaluate(ctx, s);
  const money = moneyFor(result, { comps, hud, assumptions });
  const inq = buildInquiry(result, b, ctx.rs, money, '2026-09-26');
  const g = buildGraph({ result, block: b, rs: ctx.rs, money, site: siteUnknowns(result, b), letters: lettersOf(inq), combine: combineOf(lots.length === 1 ? unlockSearch(ctx, s) : null, result), comps: { source: raw.meta.source, url: raw.meta.url, pulled: raw.meta.pulled } });
  return { g, result };
}
const subset = (sub: LotGraph, g: LotGraph) => {
  const key = (n: object) => JSON.stringify(n);
  for (const n of sub.nodes) expect(g.nodes.map(key)).toContain(key(n));
  for (const e of sub.edges) expect(g.edges.map(key)).toContain(key(e));
};

describe('graph focus: a filter over the real graph', () => {
  const { g, result } = graphFor('two', [25]);
  const C = 'lot:0010K00025000000';

  it('lot 25 two-unit, the interior side setback: parcel → rule → quote → signer, and the width as the result', () => {
    const f = focusGraph(g, result, 'rule:rm-m.side_interior')!;
    expect(f.checks).toEqual(['width', 'contextual']);
    expect(f.graph.nodes.map((n) => n.id).sort()).toEqual(
      [
        C,
        'rule:rm-m.side_interior',
        'quote:rm-m.side_interior',
        'rule:pgh.contextual_side',
        'quote:pgh.contextual_side',
        'person:Sin|Student, team 24×100',
        'source:wprdc_assessments',
        'source:building_footprints',
        'source:zoning',
        'parcel:0010K00024000000',
        'parcel:0010K00026000000',
      ].sort(),
    );
    subset(f.graph, g);
    const w = f.result.find((x) => x.id === 'width')!;
    expect(w).toMatchObject({ status: 'fail', available: 4, required: 16, unit: 'ft' });
    // The signer is the review record's, as recorded (not the image's "Zoning Administrator").
    const sin = f.graph.nodes.find((n) => n.type === 'person')!;
    expect(sin).toMatchObject({ label: 'Sin', sub: 'Student, team 24×100' });
    expect(sin.detail.map((d) => d.v).join(' ')).toMatch(/Signed off on the agent's 20-rule check/);
    expect(f.graph.edges.some((e) => e.from === 'rule:rm-m.side_interior' && e.to === sin.id && e.kind === 'signed by')).toBe(true);
  });

  it('a quote focuses its rule’s decision; a dataset focuses the checks read from it', () => {
    expect(focusGraph(g, result, 'quote:pgh.contextual_side')!.checks).toEqual(['width', 'contextual']);
    const fp = focusGraph(g, result, 'source:building_footprints')!;
    expect(fp.checks).toContain('contextual');
    subset(fp.graph, g);
  });

  it('never adds: every focus of every node is a subset of the graph', () => {
    for (const n of g.nodes) {
      const f = focusGraph(g, result, n.id)!;
      expect(f.graph.nodes.length).toBeGreaterThan(0);
      expect(f.graph.nodes.length).toBeLessThanOrEqual(g.nodes.length);
      subset(f.graph, g);
    }
    expect(focusGraph(g, result, 'rule:not-in-the-graph')).toBeNull();
  });

  it('lays the chain out left to right: records, the lot, the rules, the signer', () => {
    const f = focusGraph(g, result, 'rule:rm-m.side_interior')!;
    const pos = layoutFocus(f.graph, 1000, 560);
    const x = (id: string) => pos.get(id)!.x;
    expect(x('source:wprdc_assessments')).toBeLessThan(x(C));
    expect(x(C)).toBeLessThan(x('rule:rm-m.side_interior'));
    expect(x('rule:rm-m.side_interior')).toBeLessThan(x('person:Sin|Student, team 24×100'));
    for (const n of f.graph.nodes) expect(pos.has(n.id)).toBe(true);
  });
});
