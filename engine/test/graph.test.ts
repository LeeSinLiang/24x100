// The Graph view (spec §0.15 P1): every node maps to a real record, rule, review entry, estimate or
// engine output; nothing is invented; the layout is fixed. The resolver below is written here, apart
// from engine/src/graph.ts, so the check does not trust the code it checks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildInquiry,
  buildRuleSet,
  checkQuote,
  DEFAULT_SETTINGS,
  evaluate,
  moneyFor,
  siteUnknowns,
  unlockSearch,
  usd,
  withQuoteStatus,
  type AuditEntry,
  type Assumption,
  type Comps,
  type EvalContext,
  type Hud,
  type Rule,
  type TemplateId,
} from '../src';
import { buildGraph, combineOf, GRAPH_FRAME, layoutGraph, lettersOf, type EdgeKind, type GraphInput, type GraphNode, type LotGraph } from '../src/graph';
import { baseRules, block10K, questions, scen } from './load';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const b = block10K();
/** The rules the app loads: base files plus the extracted districts, each quote checked against the saved code text. */
const allRules = (): Rule[] =>
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

/** The inputs the lot view has (web/src/lib/model.ts), for one scenario. */
function inputs(type: TemplateId, lots: number[], opts: { audit?: AuditEntry[]; money?: boolean; rules?: Rule[] } = {}): GraphInput {
  const ctx: EvalContext = { block: b, rs: buildRuleSet('RM-M', opts.rules ?? allRules(), questions(), opts.audit ?? []), settings: DEFAULT_SETTINGS };
  const s = scen(b, type, lots);
  const result = evaluate(ctx, s);
  const money = opts.money === false ? null : moneyFor(result, { comps, hud, assumptions });
  const inq = buildInquiry(result, b, ctx.rs, money, '2026-09-26');
  const unlock = lots.length === 1 ? unlockSearch(ctx, s) : null;
  return {
    result,
    block: b,
    rs: ctx.rs,
    money,
    site: siteUnknowns(result, b),
    letters: lettersOf(inq),
    combine: combineOf(unlock, result),
    comps: { source: raw.meta.source, url: raw.meta.url, pulled: raw.meta.pulled },
  };
}

/** Everything wrong with a graph against its inputs: a node whose source doesn't resolve, an edge to
 *  nowhere, an edge kind outside the vocabulary. Empty means every node maps to something real. */
function problemsOf(g: LotGraph, inp: GraphInput): string[] {
  const p: string[] = [];
  const { result, block, rs, money, site, letters } = inp;
  const cited = new Set(result.checks.flatMap((c) => c.rule_ids));
  const citedRules = rs.rules.filter((r) => cited.has(r.id));
  for (const n of g.nodes) {
    const s = n.source as GraphNode['source'] | undefined;
    const bad = (why: string) => p.push(`${n.id}: ${why}`);
    if (!s || !s.ref) {
      bad('no source');
      continue;
    }
    switch (n.type) {
      case 'lot':
        if (s.kind !== 'engine' || s.ref !== result.key) bad(`lot source ${s.kind}:${s.ref} is not the result`);
        break;
      case 'neighbor':
        if (s.kind !== 'record' || !block.parcels.some((x) => x.pin === s.ref) || n.id !== `parcel:${s.ref}`) bad(`no parcel ${s.ref} in the block file`);
        break;
      case 'rule': {
        const r = rs.rules.find((x) => x.id === s.ref);
        if (s.kind !== 'rule' || !r || n.id !== `rule:${s.ref}`) bad(`no rule ${s.ref} in the rule set`);
        else if (!cited.has(r.id)) bad('a rule no check cites');
        break;
      }
      case 'quote': {
        const r = rs.rules.find((x) => x.id === s.ref);
        if (s.kind !== 'rule' || !r) bad(`no rule ${s.ref} for this quote`);
        else if (n.quote !== r.quote) bad('the quote is not the rule’s quote, word for word');
        break;
      }
      case 'person': {
        const [by, role] = [n.label, n.sub?.split(' · ')[0]];
        if (s.kind === 'review') {
          const e = citedRules.flatMap((r) => r.history).find((x) => x.id === s.ref);
          if (!e) bad(`no review entry ${s.ref} in the cited rules’ history`);
          else if (e.reviewer !== by || e.role !== role) bad(`signer "${by} (${role})" is not what the review log recorded`);
        } else if (s.kind === 'rule') {
          const r = citedRules.find((x) => x.id === s.ref);
          if (!r) bad(`no cited rule ${s.ref} carries this signature`);
          else if (r.verification.reviewer !== by || r.verification.role !== role) bad(`signer "${by} (${role})" is not the rule file’s verification`);
        } else bad(`a person sourced to ${s.kind}`);
        break;
      }
      case 'source': {
        const src = block.meta.sources.find((x) => x.id === s.ref);
        if (s.kind !== 'record' || !src) bad(`no dataset ${s.ref} in the block file`);
        else if (src.url !== s.url || src.pulled !== s.pulled) bad('url or pull time differs from the block file');
        break;
      }
      case 'estimate':
        if (s.kind !== 'estimate' || !money || !(money.estimates.some((e) => e.id === s.ref) || s.ref === 'site_work')) bad(`no estimate ${s.ref}`);
        break;
      case 'sale':
        if (s.kind !== 'record' || !money?.record_ids.includes(s.ref) || !money.new_build || !n.label.includes(usd(money.new_build.value, 1))) bad('the sale is not the money screen’s new-build sale');
        break;
      case 'site':
        if (s.kind !== 'engine' || !site.some((x) => `site:${x.id}` === s.ref)) bad(`no site row ${s.ref}`);
        break;
      case 'office':
        if (s.kind !== 'engine' || !letters.some((x) => `letter:${x.id}` === s.ref)) bad(`no letter ${s.ref}`);
        break;
      default:
        bad(`unknown type ${String(n.type)}`);
    }
  }
  const ids = new Set(g.nodes.map((n) => n.id));
  if (ids.size !== g.nodes.length) p.push('duplicate node ids');
  const VOCAB: EdgeKind[] = ['needed to fit', 'adjacent to', 'constrained by', 'cites', 'signed by', 'assesses', 'ownership', 'geometry', 'estimates cost', 'comparable sale', 'has condition', 'inquire'];
  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) p.push(`edge ${e.from} → ${e.to} points at no node`);
    if (!VOCAB.includes(e.kind)) p.push(`edge kind "${e.kind}" is outside the vocabulary`);
  }
  return p;
}

const typesOf = (g: LotGraph) => g.nodes.map((n) => `${n.type} ${n.id}`);
const edgesOf = (g: LotGraph) => g.edges.map((e) => `${e.from} --${e.kind}--> ${e.to}`);

const three = inputs('three', [25, 26, 27]);
const g3 = buildGraph(three);
const two = inputs('two', [25]);
const g2 = buildGraph(two);

describe('graph: every node maps to something real', () => {
  it('lots 25–27 three-unit and lot 25 two-unit: every source resolves, every edge lands, every kind is in the vocabulary', () => {
    expect(problemsOf(g3, three)).toEqual([]);
    expect(problemsOf(g2, two)).toEqual([]);
  });

  it('the checker bites: a fake node, a dropped source, a fake parcel, a renamed signer and an off-vocabulary edge are each caught', () => {
    const fake: LotGraph = { ...g3, nodes: [...g3.nodes, { id: 'rule:rm-m.side_setback_10ft', type: 'rule', cluster: 'rules', label: 'A minimum 10 ft side setback is required', trust: 'ink', source: { kind: 'rule', ref: 'rm-m.side_setback_10ft' }, detail: [] }] };
    expect(problemsOf(fake, three).join('\n')).toMatch(/no rule rm-m.side_setback_10ft/);
    const dropped: LotGraph = { ...g3, nodes: g3.nodes.map((n) => (n.id === 'source:city_owned' ? ({ ...n, source: undefined } as unknown as GraphNode) : n)) };
    expect(problemsOf(dropped, three)).toEqual(['source:city_owned: no source']);
    const parcel: LotGraph = { ...g3, nodes: g3.nodes.map((n) => (n.id === 'parcel:0010K00024000000' ? { ...n, id: 'parcel:0024K00025000000', source: { ...n.source, ref: '0024K00025000000' } } : n)) };
    expect(problemsOf(parcel, three).join('\n')).toMatch(/no parcel 0024K00025000000/);
    const person: LotGraph = { ...g3, nodes: g3.nodes.map((n) => (n.type === 'person' ? { ...n, label: 'Sin Liang Lee', sub: 'Zoning Administrator' } : n)) };
    expect(problemsOf(person, three).join('\n')).toMatch(/signer "Sin Liang Lee \(Zoning Administrator\)" is not the rule file’s verification/);
    const sale: LotGraph = { ...g3, nodes: g3.nodes.map((n) => (n.type === 'sale' ? { ...n, label: 'Newest sale $825,000' } : n)) };
    expect(problemsOf(sale, three).join('\n')).toMatch(/not the money screen’s new-build sale/);
    const edge: LotGraph = { ...g3, edges: [...g3.edges, { from: g3.nodes[0].id, to: 'rule:rm-m.front', kind: 'zoned as' as EdgeKind }] };
    expect(problemsOf(edge, three).join('\n')).toMatch(/outside the vocabulary/);
  });

  it('no invented nodes: rules are in the rule set, neighbors in the block file, signers in the review record', () => {
    for (const [g, inp] of [
      [g3, three],
      [g2, two],
    ] as const) {
      for (const n of g.nodes.filter((x) => x.type === 'rule')) expect(inp.rs.rules.map((r) => `rule:${r.id}`)).toContain(n.id);
      for (const n of g.nodes.filter((x) => x.type === 'neighbor')) expect(inp.block.parcels.map((p) => `parcel:${p.pin}`)).toContain(n.id);
      const signed = inp.rs.rules.flatMap((r) => [...r.history.map((e) => `${e.reviewer}|${e.role}`), `${r.verification.reviewer}|${r.verification.role}`]);
      for (const n of g.nodes.filter((x) => x.type === 'person')) expect(signed).toContain(`${n.label}|${n.sub?.split(' · ')[0]}`);
      // Nothing from the AI-generated concept image.
      expect(JSON.stringify(g)).not.toMatch(/825,000|Sin Liang Lee|minimum 10 ft side setback is required|0024-K-|People 118|Site work \(soft costs\)/i);
      // No score, and no owner names: owner type only.
      expect(JSON.stringify(g)).not.toMatch(/\bscore/i);
      for (const n of g.nodes.filter((x) => x.type === 'neighbor')) {
        const p = inp.block.parcels.find((x) => `parcel:${x.pin}` === n.id)!;
        expect(n.label).toBe(`Lot ${p.lot}${p.lot_suffix ?? ''} · ${p.city ? 'City-owned' : p.assess!.ownercat!.charAt(0) + p.assess!.ownercat!.slice(1).toLowerCase()}`);
        expect(n.sub).toBe(`${p.city ? p.city.status : 'County owner type'} · ${p.built ? 'built' : 'vacant'}`);
      }
    }
  });
});

describe('graph: lots 25–27 three-unit on Block 10‑K (hand-checked)', () => {
  it('node ids and types', () => {
    const C = 'lot:0010K00027000000+0010K00026000000+0010K00025000000';
    expect(typesOf(g3)).toEqual([
      `lot ${C}`,
      // The combined lots (needed to fit), then the lots that share a lot line with the group.
      'neighbor parcel:0010K00025000000',
      'neighbor parcel:0010K00026000000',
      'neighbor parcel:0010K00027000000',
      'neighbor parcel:0010K00024000000',
      'neighbor parcel:0010K00028000000',
      'neighbor parcel:0010K00028000A00',
      // Every rule the checks cite, in check order (width, depth, area, height, use, parking, slope,
      // contextual), each with its quote; the research pass signs the seven base rules.
      'rule rule:rm-m.side_interior',
      'quote quote:rm-m.side_interior',
      'person person:Claude (research pass)|AI agent',
      'rule rule:rm-m.front',
      'quote quote:rm-m.front',
      'rule rule:rm-m.rear',
      'quote quote:rm-m.rear',
      'rule rule:rm-m.min_lot_area',
      'quote quote:rm-m.min_lot_area',
      'rule rule:rm-m.max_height',
      'quote quote:rm-m.max_height',
      'rule rule:rm-m.max_stories',
      'quote quote:rm-m.max_stories',
      'rule rule:rm-m.x.use_three',
      'quote quote:rm-m.x.use_three',
      'rule rule:rm-m.x.parking_three',
      'quote quote:rm-m.x.parking_three',
      'rule rule:rm-m.x.grading_review',
      'quote quote:rm-m.x.grading_review',
      'rule rule:pgh.contextual_side',
      'quote quote:pgh.contextual_side',
      // The block datasets the result used, in the block file's order.
      'source source:pgh_parcels',
      'source source:wprdc_assessments',
      'source source:city_owned',
      'source source:building_footprints',
      'source source:zoning',
      'source source:zoning_overlays',
      'source source:slope25',
      'source source:undermined',
      'source source:osm_streets',
      'source source:hist_zoning_1927',
      'estimate estimate:A',
      'estimate estimate:prod',
      'estimate estimate:site_work',
      'sale sale:newest',
      'site site:undermining',
      'site site:environmental',
      'site site:fill',
      'site site:soil',
      'site site:water',
      'office office:real_estate',
      'office office:zoning',
      'office office:ura',
      'office office:rco',
    ]);
  });

  it('edges', () => {
    const C = 'lot:0010K00027000000+0010K00026000000+0010K00025000000';
    const AI = 'person:Claude (research pass)|AI agent';
    expect(edgesOf(g3)).toEqual([
      `parcel:0010K00025000000 --needed to fit--> ${C}`,
      `parcel:0010K00026000000 --needed to fit--> ${C}`,
      `parcel:0010K00027000000 --needed to fit--> ${C}`,
      `parcel:0010K00024000000 --adjacent to--> ${C}`,
      `parcel:0010K00028000000 --adjacent to--> ${C}`,
      `parcel:0010K00028000A00 --adjacent to--> ${C}`,
      'rule:rm-m.side_interior --cites--> quote:rm-m.side_interior',
      `rule:rm-m.side_interior --signed by--> ${AI}`,
      'rule:rm-m.front --cites--> quote:rm-m.front',
      `rule:rm-m.front --signed by--> ${AI}`,
      'rule:rm-m.rear --cites--> quote:rm-m.rear',
      `rule:rm-m.rear --signed by--> ${AI}`,
      'rule:rm-m.min_lot_area --cites--> quote:rm-m.min_lot_area',
      `rule:rm-m.min_lot_area --signed by--> ${AI}`,
      'rule:rm-m.max_height --cites--> quote:rm-m.max_height',
      `rule:rm-m.max_height --signed by--> ${AI}`,
      'rule:rm-m.max_stories --cites--> quote:rm-m.max_stories',
      `rule:rm-m.max_stories --signed by--> ${AI}`,
      // Use, parking and slope are open (pencil rules, unsigned): the lot is constrained by them.
      `${C} --constrained by--> rule:rm-m.x.use_three`,
      'rule:rm-m.x.use_three --cites--> quote:rm-m.x.use_three',
      `${C} --constrained by--> rule:rm-m.x.parking_three`,
      'rule:rm-m.x.parking_three --cites--> quote:rm-m.x.parking_three',
      `${C} --constrained by--> rule:rm-m.x.grading_review`,
      'rule:rm-m.x.grading_review --cites--> quote:rm-m.x.grading_review',
      'rule:pgh.contextual_side --cites--> quote:pgh.contextual_side',
      `rule:pgh.contextual_side --signed by--> ${AI}`,
      `source:pgh_parcels --geometry--> ${C}`,
      `source:wprdc_assessments --assesses--> ${C}`,
      // The contextual check read whether lots 24, 28 and 28A are built.
      'source:wprdc_assessments --assesses--> parcel:0010K00024000000',
      'source:wprdc_assessments --assesses--> parcel:0010K00028000000',
      'source:wprdc_assessments --assesses--> parcel:0010K00028000A00',
      `source:city_owned --ownership--> ${C}`,
      'source:building_footprints --geometry--> parcel:0010K00024000000',
      'source:building_footprints --geometry--> parcel:0010K00028000000',
      'source:building_footprints --geometry--> parcel:0010K00028000A00',
      `source:zoning --geometry--> ${C}`,
      `source:zoning_overlays --geometry--> ${C}`,
      `source:slope25 --geometry--> ${C}`,
      `source:undermined --geometry--> ${C}`,
      `source:osm_streets --geometry--> ${C}`,
      `source:hist_zoning_1927 --geometry--> ${C}`,
      `estimate:A --estimates cost--> ${C}`,
      `estimate:prod --estimates cost--> ${C}`,
      `estimate:site_work --estimates cost--> ${C}`,
      `sale:newest --comparable sale--> ${C}`,
      `${C} --has condition--> site:undermining`,
      `${C} --has condition--> site:environmental`,
      `${C} --has condition--> site:fill`,
      `${C} --has condition--> site:soil`,
      `${C} --has condition--> site:water`,
      `${C} --inquire--> office:real_estate`,
      `${C} --inquire--> office:zoning`,
      `${C} --inquire--> office:ura`,
      `${C} --inquire--> office:rco`,
    ]);
    expect([g3.nodes.length, g3.edges.length]).toEqual([51, 54]);
  });

  it('what the nodes say: owner type and status, the AI research pass, pencil rules, attributed estimates', () => {
    const n = (id: string) => g3.nodes.find((x) => x.id === id)!;
    expect(n('lot:0010K00027000000+0010K00026000000+0010K00025000000')).toMatchObject({ label: 'Lots 25, 26 and 27', sub: 'combined · Three-unit house · RM-M', status: 'Use, Parking and Slope open', trust: 'ink' });
    expect(n('parcel:0010K00025000000')).toMatchObject({ label: 'Lot 25 · City-owned', sub: 'Available for Sale · vacant', city: 'for_sale' });
    expect(n('parcel:0010K00026000000')).toMatchObject({ label: 'Lot 26 · Corporation', sub: 'County owner type · vacant' });
    expect(n('parcel:0010K00026000000').city).toBeUndefined();
    // The pre-seeded rules are signed exactly as recorded, and marked as an AI check.
    expect(n('person:Claude (research pass)|AI agent')).toMatchObject({ label: 'Claude (research pass)', sub: 'AI agent · an AI check, not a person', ai: true, source: { kind: 'rule' } });
    expect(n('rule:rm-m.side_interior')).toMatchObject({ trust: 'ink', ai: true, signed: { by: 'Claude (research pass)', role: 'AI agent', ai: true, review: false } });
    // Unsigned, model-proposed rules are pencil and have no signer.
    for (const id of ['rule:rm-m.x.use_three', 'rule:rm-m.x.parking_three', 'rule:rm-m.x.grading_review']) {
      expect(n(id).trust).toBe('pencil');
      expect(n(id).signed).toBeUndefined();
      expect(g3.edges.some((e) => e.from === id && e.kind === 'signed by')).toBe(false);
    }
    // Practitioner estimates are violet and attributed; the sale is a record (ink).
    expect(n('estimate:A')).toMatchObject({ trust: 'estimate', label: 'Build $200–$250/sf' });
    expect(n('estimate:A').detail.find((d) => d.k === 'Supplied by')!.v).toMatch(/^a practitioner at the hackathon/);
    expect(n('estimate:site_work').detail.find((d) => d.k === 'Supplied by')!.v).toMatch(/^another practitioner at the hackathon/);
    expect(n('sale:newest')).toMatchObject({ trust: 'ink', label: 'Newest new build $240,000', sub: '2125 Rose St (2025, 1,442 sf)' });
    // Site rows are never assessed.
    for (const s of g3.nodes.filter((x) => x.type === 'site')) expect(s.trust).toBe('unknown');
  });
});

describe('graph: other shapes', () => {
  it('lot 25 two-unit: width fails on the interior side setback; the engine’s combine option makes lot 24 needed to fit', () => {
    const C = 'lot:0010K00025000000';
    expect(g2.nodes[0]).toMatchObject({ id: C, label: 'Lot 25 · 2241 Mahon St', status: 'Width fails · Use, Parking and Slope open' });
    expect(two.combine).toEqual({ pins: ['0010K00025000000', '0010K00024000000'], label: 'Two-unit house on lots 24–25' });
    expect(edgesOf(g2).filter((e) => e.includes('constrained by'))).toEqual([
      `${C} --constrained by--> rule:rm-m.side_interior`,
      `${C} --constrained by--> rule:rm-m.x.use_two`,
      `${C} --constrained by--> rule:rm-m.x.parking_two`,
      `${C} --constrained by--> rule:rm-m.x.grading_review`,
    ]);
    expect(edgesOf(g2).filter((e) => e.startsWith('parcel:'))).toEqual([`parcel:0010K00024000000 --needed to fit--> ${C}`, `parcel:0010K00026000000 --adjacent to--> ${C}`]);
  });

  it('constrained by goes only to rules whose check fails or is open', () => {
    for (const [g, inp] of [
      [g3, three],
      [g2, two],
    ] as const) {
      const holding = new Set(inp.result.checks.filter((c) => ['fail', 'open', 'needs_survey'].includes(c.status)).flatMap((c) => c.rule_ids.map((id) => `rule:${id}`)));
      const constrained = g.edges.filter((e) => e.kind === 'constrained by').map((e) => e.to);
      expect(new Set(constrained)).toEqual(new Set([...holding].filter((id) => g.nodes.some((n) => n.id === id))));
    }
  });

  it('a person’s signature in the review log: the signer node is that entry, exactly as recorded, and the rule turns ink', () => {
    const sign: AuditEntry = { id: 'rv-test-1', rule_id: 'rm-m.x.use_three', question_id: null, at: '2026-09-26T22:00:00Z', reviewer: 'A. Teammate', role: 'Housing lead', action: 'source_checked', quote: '', decision: 'matches', reason: 'compared with the §911.02 table', choice: null, reference: null };
    const inp = inputs('three', [25, 26, 27], { audit: [sign] });
    const g = buildGraph(inp);
    expect(problemsOf(g, inp)).toEqual([]);
    const p = g.nodes.find((n) => n.id === 'person:A. Teammate|Housing lead')!;
    expect(p).toMatchObject({ label: 'A. Teammate', sub: 'Housing lead', source: { kind: 'review', ref: 'rv-test-1' } });
    expect(p.ai).toBeUndefined();
    expect(g.nodes.find((n) => n.id === 'rule:rm-m.x.use_three')).toMatchObject({ trust: 'ink', signed: { by: 'A. Teammate', review: true } });
    expect(g.edges).toContainEqual({ from: 'rule:rm-m.x.use_three', to: 'person:A. Teammate|Housing lead', kind: 'signed by' });
  });

  it('only the model’s proposed rules (no answer key): every cited rule is pencil and none has a signer', () => {
    const inp = inputs('three', [25, 26, 27], { rules: allRules().filter((r) => r.origin === 'extracted') });
    const g = buildGraph(inp);
    expect(problemsOf(g, inp)).toEqual([]);
    const rules = g.nodes.filter((n) => n.type === 'rule');
    expect(rules.length).toBeGreaterThan(5);
    expect(rules.some((n) => inp.rs.rules.find((r) => `rule:${r.id}` === n.id)!.dagger === false)).toBe(true);
    for (const n of rules) expect(n).toMatchObject({ trust: 'pencil' });
    for (const n of rules) expect(n.signed).toBeUndefined();
    expect(g.nodes.filter((n) => n.type === 'person')).toEqual([]);
  });

  it('no money: the money cluster is empty; lot, neighbors, rules, sources and site are unchanged', () => {
    const inp = inputs('three', [25, 26, 27], { money: false });
    const g = buildGraph(inp);
    expect(problemsOf(g, inp)).toEqual([]);
    expect(g.nodes.filter((n) => n.cluster === 'money')).toEqual([]);
    // The letters follow the inquiry, which drops the URA (gap financing) letter without a money screen.
    const keep = (x: LotGraph) => x.nodes.filter((n) => n.cluster !== 'money' && n.cluster !== 'next').map((n) => n.id);
    expect(keep(g)).toEqual(keep(g3));
    expect(g.nodes.filter((n) => n.cluster === 'next').map((n) => n.id)).toEqual(inp.letters.map((l) => `office:${l.id}`));
  });

  it('a refused scenario still maps: lots that don’t share lot lines', () => {
    const inp = inputs('three', [25, 27]);
    expect(inp.result.state).toBe('refused');
    const g = buildGraph(inp);
    expect(problemsOf(g, inp)).toEqual([]);
    expect(g.nodes[0]).toMatchObject({ trust: 'unknown' });
    expect(g.nodes[0].status).toMatch(/^Can't tell: /);
  });
});

describe('graph layout: fixed clusters', () => {
  it('deterministic: two builds and two layouts give identical positions', () => {
    const a = layoutGraph(buildGraph(inputs('three', [25, 26, 27])), 900, 560);
    const b2 = layoutGraph(buildGraph(inputs('three', [25, 26, 27])), 900, 560);
    expect([...a.entries()]).toEqual([...b2.entries()]);
    expect([...layoutGraph(g3, 900, 560).entries()]).toEqual([...a.entries()]);
  });

  it('every node is placed inside the canvas, and no two nodes share a spot', () => {
    for (const g of [g3, g2]) {
      for (const [w, hh] of [
        [900, 560],
        [GRAPH_FRAME.min.w, GRAPH_FRAME.min.h],
        [1300, 760],
      ]) {
        const pos = layoutGraph(g, w, hh);
        expect(pos.size).toBe(g.nodes.length);
        const pts = [...pos.values()];
        for (const q of pts) {
          expect(q.x).toBeGreaterThan(0);
          expect(q.x).toBeLessThan(w);
          expect(q.y).toBeGreaterThan(0);
          expect(q.y).toBeLessThan(hh);
        }
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(18);
      }
    }
  });

  it('clusters keep their places: neighbors and sources left of the lot, rules to its right, money below it', () => {
    const pos = layoutGraph(g3, 900, 560);
    const c = pos.get(g3.nodes[0].id)!;
    const at = (cl: string) => g3.nodes.filter((n) => n.cluster === cl).map((n) => pos.get(n.id)!);
    for (const q of [...at('neighbors'), ...at('sources')]) expect(q.x).toBeLessThan(c.x);
    for (const q of at('rules')) expect(q.x).toBeGreaterThan(c.x);
    for (const q of at('money')) expect(q.y).toBeGreaterThan(c.y);
  });
});
