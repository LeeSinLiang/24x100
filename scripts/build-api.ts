// Static JSON API (spec §0.6): written at build time by the same engine the app uses.
//   api/index.json            what's here
//   api/blocks/<id>.json      a block: lots, results per building type, sources
//   api/lots/<pin>.json       one lot: ledger, envelope numbers, sources, verification levels
//   api/city/summary.json     citywide counts per building type, with district coverage
// Rule states come from the committed rule store and data/rules/reviews.json (not a browser).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  BLOCKER_WORDS,
  checkQuote,
  withQuoteStatus,
  DEFAULT_SETTINGS,
  buildRuleSet,
  classifyCityLot,
  evaluate,
  proposalFor,
  summarize,
  type AuditEntry,
  type BlockFile,
  type CityLot,
  type LotResult,
  type Question,
  type Rule,
  type RuleSet,
  type TemplateId,
} from '../engine/src/index';

const OUT = 'web/public/api';
const TYPES: TemplateId[] = ['detached', 'two', 'row', 'three'];
const read = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

const rulesRaw: Rule[] = [
  ...readdirSync('data/rules/base').flatMap((f) => read<Rule[]>(`data/rules/base/${f}`)),
  ...(existsSync('data/rules/extracted') ? readdirSync('data/rules/extracted').filter((f) => f.endsWith('.json') && f !== 'eval.json').flatMap((f) => read<{ rules?: Rule[] }>(`data/rules/extracted/${f}`).rules ?? []) : []),
];
const rules = withQuoteStatus(rulesRaw, (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null), checkQuote);
const questions = read<Question[]>('data/rules/questions.json');
const reviewsRaw = existsSync('data/rules/reviews.json') ? read<{ entries?: AuditEntry[] } | AuditEntry[]>('data/rules/reviews.json') : [];
const audit: AuditEntry[] = Array.isArray(reviewsRaw) ? reviewsRaw : reviewsRaw.entries ?? [];
const rsCache = new Map<string, RuleSet>();
const rsFor = (d: string) => rsCache.get(d) ?? (rsCache.set(d, buildRuleSet(d, rules, questions, audit)), rsCache.get(d)!);

function ruleSummary(rs: RuleSet, ids: string[]) {
  return [...new Set(ids)]
    .map((id) => rs.rules.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({
      id: r!.id,
      section: r!.section,
      value: r!.value,
      quote: r!.quote,
      source_url: r!.source_url,
      trust: r!.state,
      verification: { level: r!.verification.level, reviewer: r!.verification.reviewer, role: r!.verification.role, at: r!.verification.at, ai_checked: r!.ai_checked },
    }));
}

function lotResultJson(r: LotResult, rs: RuleSet) {
  if (r.state !== 'ok') return { state: r.state, refusal: r.refusal };
  return {
    state: r.state,
    trust: r.trust,
    width: { deed: r.width!.deed, mapped: r.width!.mapped, formula: r.width!.formula, trust: r.width!.trust },
    depth: { deed: r.depth!.deed, mapped: r.depth!.mapped, formula: r.depth!.formula, trust: r.depth!.trust },
    units: r.units.map((u) => ({ pin: u.pin, end: u.end, width: u.width.deed, formula: u.width.formula, trust: u.trust })),
    checks: r.checks.map((c) => ({ id: c.id, status: c.status, trust: c.trust, required: c.required, available: c.available, shortfall: c.shortfall, unit: c.unit, text: c.text, rules: ruleSummary(rs, c.rule_ids), records: c.record_ids, alternative: c.alternative ?? null })),
    relief: r.relief,
    approvals: { certain: r.approvals.ink.map((a) => ({ kind: a.kind, weight: a.weight })), open: r.approvals.pencil.map((a) => ({ kind: a.kind, weight: a.weight })) },
    score_heuristic: r.score,
    questions: r.questions,
    not_assessed: r.not_assessed,
    proposal_red: r.scenario.proposal,
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/lots`, { recursive: true });
mkdirSync(`${OUT}/blocks`, { recursive: true });
mkdirSync(`${OUT}/city`, { recursive: true });

const disclaimer = 'Decision support, not legal, financial or zoning advice. The City of Pittsburgh interprets its own code.';
const blocks = readdirSync('data/blocks')
  .filter((f) => f.endsWith('.json') && !f.includes('crosscheck'))
  .map((f) => read<BlockFile>(`data/blocks/${f}`));
const written = new Set<string>();
let lotFiles = 0;
for (const b of blocks) {
  const lots = [];
  for (const p of b.parcels) {
    const rs = rsFor(p.zone ?? '—');
    const results = Object.fromEntries(
      TYPES.filter((t) => t !== 'row' && t !== 'three').map((t) => {
        const ctx = { block: b, rs, settings: DEFAULT_SETTINGS };
        return [t, lotResultJson(evaluate(ctx, { type: t, pins: [p.pin], proposal: proposalFor(t) }), rs)];
      }),
    );
    const lot = {
      pin: p.pin,
      address: p.addr,
      address_source: p.addr_source,
      block: b.meta.id,
      lot: `${p.lot ?? ''}${p.lot_suffix ?? ''}`,
      zone: p.zone,
      records: {
        assessment: p.assess,
        deed: p.deed,
        city: p.city,
        mapped_area_sf: Math.round(p.mapped_area),
        reconciliation: p.recon,
        slope25_share: p.slope25,
        undermined_share: p.undermined,
        built: p.built,
      },
      results_by_type_alone: results,
      sources: b.meta.sources,
      pulled: b.meta.pulled,
      disclaimer,
    };
    writeFileSync(`${OUT}/lots/${p.pin}.json`, JSON.stringify(lot, null, 1));
    written.add(p.pin);
    lotFiles++;
    lots.push({ pin: p.pin, address: p.addr, lot: lot.lot, zone: p.zone, two_unit_width: (results.two as { width?: { deed: number } }).width?.deed ?? null, state: (results.two as { state: string }).state });
  }
  writeFileSync(`${OUT}/blocks/${b.meta.id}.json`, JSON.stringify({ meta: b.meta, lots, disclaimer }, null, 1));
}

// City lots not in a block file: the classification per building type.
let city: { meta: Record<string, unknown>; lots: CityLot[] } = { meta: {}, lots: [] };
if (existsSync('data/city/lots.json')) city = read('data/city/lots.json');
const summaries: Record<string, unknown> = {};
for (const t of TYPES) {
  const cls = city.lots.map((l) => classifyCityLot(l, l.zone ? rsFor(l.zone) : null, t, DEFAULT_SETTINGS));
  summaries[t] = summarize(city.lots, cls, t);
  if (t === 'two') {
    city.lots.forEach((l, i) => {
      if (written.has(l.pin)) return;
      const byType = Object.fromEntries(TYPES.map((tt) => {
        const c = tt === 'two' ? cls[i] : classifyCityLot(l, l.zone ? rsFor(l.zone) : null, tt, DEFAULT_SETTINGS);
        return [tt, { first_blocker: c.blocker, first_blocker_words: BLOCKER_WORDS[c.blocker], all: c.all, width: c.width, depth: c.depth, area: c.area, formula: c.formula, trust: c.trust, note: c.note }];
      }));
      writeFileSync(`${OUT}/lots/${l.pin}.json`, JSON.stringify({ pin: l.pin, address: l.addr, neighborhood: l.hood, zone: l.zone, city_status: l.status, status_updated: l.status_updated, deed: l.deed, assessed_sf: l.assessed, mapped_sf: l.mapped, edges: { computed: l.edges_ok, note: l.edge_note, flank: l.flank }, classification_by_type: byType, disclaimer }, null, 1));
      lotFiles++;
    });
  }
}
writeFileSync(`${OUT}/city/summary.json`, JSON.stringify({ meta: city.meta, by_type: summaries, disclaimer }, null, 1));
writeFileSync(
  `${OUT}/index.json`,
  JSON.stringify(
    {
      name: '24×100 static API',
      built: new Date().toISOString(),
      endpoints: { lot: 'api/lots/<pin>.json', block: 'api/blocks/<id>.json', city: 'api/city/summary.json' },
      blocks: blocks.map((b) => b.meta.id),
      lots: lotFiles,
      rule_states: 'from data/rules (answer key, extracted proposals) and data/rules/reviews.json at build time',
      disclaimer,
    },
    null,
    1,
  ),
);
console.log(`api: ${lotFiles} lot files, ${blocks.length} blocks, city summary for ${city.lots.length} lots → ${OUT}`);
