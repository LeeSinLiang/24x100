// film/facts.json: every number the film says or draws, generated from the engine and the data, each
// with its source. The sketchbook and the voice-over read from this file, so they can't disagree with
// the app. Run: npx tsx scripts/facts.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  buildRuleSet,
  checkQuote,
  classifyCityLot,
  evaluate,
  moneyFor,
  proposalFor,
  summarize,
  withQuoteStatus,
  type AuditEntry,
  type BlockFile,
  type CityLot,
  type Comps,
  type Hud,
  type Question,
  type Rule,
  type Scenario,
  type TemplateId,
} from '../engine/src/index';

const read = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
type Fact = { value: unknown; display: string; source: string; link?: string };
const facts: Record<string, Fact> = {};
const put = (id: string, value: unknown, display: string, source: string, link?: string) => (facts[id] = { value, display, source, ...(link ? { link } : {}) });

const rulesRaw: Rule[] = [
  ...readdirSync('data/rules/base').flatMap((f) => read<Rule[]>(`data/rules/base/${f}`)),
  ...(existsSync('data/rules/extracted') ? readdirSync('data/rules/extracted').filter((f) => f.endsWith('.json') && f !== 'eval.json').flatMap((f) => read<{ rules?: Rule[] }>(`data/rules/extracted/${f}`).rules ?? []) : []),
];
const rules = withQuoteStatus(rulesRaw, (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null), checkQuote);
const questions = read<Question[]>('data/rules/questions.json');
const rv = existsSync('data/rules/reviews.json') ? read<{ entries?: AuditEntry[] } | AuditEntry[]>('data/rules/reviews.json') : [];
const audit = Array.isArray(rv) ? rv : rv.entries ?? [];
const b = read<BlockFile>('data/blocks/10K.json');
const rs = buildRuleSet('RM-M', rules, questions, audit);
const ctx = { block: b, rs, settings: DEFAULT_SETTINGS };
const pin = (lot: number) => b.parcels.find((p) => p.lot === lot && !p.lot_suffix && p.pin.startsWith('0010K'))!.pin;
const sc = (type: TemplateId, lots: number[]): Scenario => ({ type, pins: lots.map(pin), proposal: proposalFor(type) });
const blockSrc = `data/blocks/10K.json (pulled ${b.meta.pulled.slice(0, 10)} from City ArcGIS, WPRDC assessments and City-Owned Properties)`;

// The street. The 14 County lot numbers 21–34 on the Mahon side are the 14 lots of the original plan
// (plan lots 63–76); lot 28 is split into 28 and 28-A, and lot 27's deed names no plan lot.
const byLot = new Map<number, { built: boolean; exact: boolean }>();
for (const p of b.parcels) {
  if (!p.pin.startsWith('0010K') || p.lot == null || p.lot < 21 || p.lot > 34) continue;
  const cur = byLot.get(p.lot) ?? { built: false, exact: true };
  cur.built ||= p.built;
  cur.exact &&= !p.lot_suffix && !!p.deed && p.deed.front === 24 && p.deed.depth === 100 && !p.deed.part;
  byLot.set(p.lot, cur);
}
const empty = [...byLot.values()].filter((x) => !x.built);
put('street_lots_total', byLot.size, `${byLot.size}`, `County lot numbers 21–34 on the Mahon Street side (the original plan lots 63–76; lot 28 is split and lot 27's deed names no plan lot), ${blockSrc}`);
put('street_lots_empty', empty.length, `${empty.length} of ${byLot.size}`, `lots with no building footprint and no built assessment record, ${blockSrc}`);
put('street_lots_exact_2400', empty.filter((x) => x.exact).length, `${empty.filter((x) => x.exact).length}`, `empty lots whose deed reads exactly 24×100 (2,400 sf), not a part lot, ${blockSrc}`);
const lot22 = b.parcels.find((p) => p.pin === pin(22))!;
put('house_year', lot22.assess?.yearbuilt, `${lot22.assess?.yearbuilt}`, `County assessment YEARBLT for 2247 Humber Way (lot 22), as of ${lot22.assess?.asof}`);

// The rule.
const minArea = rs.rules.find((r) => r.id === 'rm-m.min_lot_area')!;
put('rmm_min_lot_area', minArea.value, '2,400 sf', `§${minArea.section}, saved ecode360 text retrieved ${minArea.retrieved}; ${minArea.enacted?.quote}`, minArea.source_url);
put('rmm_side_interior', 10, '10 ft', '§903.03.C, RM Subdistrict interior side setback', rs.rules.find((r) => r.id === 'rm-m.side_interior')!.source_url);
put('contextual_clause', 'If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.', 'quote', '§925.06.C, saved ecode360 text');

// Lot 25.
const two = evaluate(ctx, sc('two', [25]));
put('lot25_address', '2241 Mahon St', '2241 Mahon St', 'City-Owned Properties (address field); the County assessment lists it as 0 MAHON ST');
put('lot25_two_width', two.width!.deed, `${two.width!.deed} ft`, `engine: ${two.width!.formula} (deed 24 × 100; §903.03.C)`);
put('lot25_two_width_mapped', two.width!.mapped, `${two.width!.mapped} ft`, 'engine: envelope measured on the City parcel polygon');
put('lot25_two_proposal', two.scenario.proposal.width, `${two.scenario.proposal.width} ft`, 'the two-unit template (red, editable)');
put('lot25_two_relief', two.relief[0]?.text, two.relief[0]?.text ?? '', 'engine relief for the width check');
put('lot25_score', [two.score!.lo, two.score!.hi], `${two.score!.lo}–${two.score!.hi}`, `engine heuristic: ${two.score!.formula}`);
const det = evaluate(ctx, sc('detached', [25]));
put('lot25_detached_width', det.width!.deed, `${det.width!.deed} ft`, `engine: ${det.width!.formula} (narrow-lot side yards, §925.06.C)`);
const three = evaluate(ctx, sc('three', [25, 26, 27]));
put('lots25_27_three_width', three.width!.deed, `${three.width!.deed} ft`, `engine: ${three.width!.formula}`);
put('lot26_owner', b.parcels.find((p) => p.pin === pin(26))!.assess?.ownercat, 'not City-owned; County owner type Corporation', 'City-Owned Properties (absent) and County assessment OWNERDESC');
const row = evaluate(ctx, sc('row', [25, 26, 27]));
const alt = row.checks.find((c) => c.id === 'width')!.alternative;
put('row_end_units', [row.width!.deed, alt?.available], `${row.width!.deed} ft, or ${alt?.available} ft if the City reads "single-unit house" to include attached houses`, `engine: ${row.width!.formula} / ${alt?.formula}; question for the Zoning Administrator`);
put('depth_24x100', two.depth!.deed, `${two.depth!.deed} ft`, `engine: ${two.depth!.formula}`);
put('lot28_depth', evaluate(ctx, sc('detached', [28])).depth!.deed, '12 ft', 'engine: 62 − 25 − 25 (deed 24 × 62)');
const r22 = evaluate(ctx, sc('two', [22]));
put('lot22_assessed', r22.refusal?.values?.assessed, `${Number(r22.refusal?.values?.assessed).toLocaleString('en-US')} sf`, 'County assessment LOTAREA');
put('lot22_mapped', r22.refusal?.values?.mapped, `${Number(r22.refusal?.values?.mapped).toLocaleString('en-US')} sf`, 'City parcel polygon area (PGHParcels), measured by the pipeline');
put('lot22_ratio', r22.refusal?.values?.ratio, `${r22.refusal?.values?.ratio}×`, 'mapped ÷ assessed; tolerance ±10% (red setting)');
put('lot25_status_updated', b.parcels.find((p) => p.pin === pin(25))!.city?.status_updated, '17 Nov 2016', 'City-Owned Properties last_updated for lot 25');

// Money.
const raw = read<Comps & { newest_built: Comps['newest']; counts: Comps['counts'] & { transfers_all_dates?: number; valid_all_dates?: number } }>('data/money/comps_ward5.json');
const comps: Comps = { ...raw, newest: raw.newest_built };
const h = read<Record<string, unknown> & { meta: { url: string; pulled: string } }>('data/money/hud_fy2026.json');
const hud: Hud = { area_name: String(h.hud_area_name), median: Number(h.median_family_income), l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(h[`l80_${i}`])), source_url: h.meta.url, pulled: h.meta.pulled };
const assumptions = read<never[]>('data/assumptions.json');
const compsSrc = `WPRDC real-estate sales, Ward 5, valid sales ≥ $10,000 since 2023-01-01, 1–2 unit homes; pulled ${String(raw.meta.pulled).slice(0, 10)}`;
put('comps_count', comps.counts.valid_1_2_unit, `${comps.counts.valid_1_2_unit}`, compsSrc);
put('comps_median', comps.median, `$${comps.median.toLocaleString('en-US')}`, compsSrc);
put('comps_iqr', [comps.q1, comps.q3], `$${comps.q1.toLocaleString('en-US')}–$${comps.q3.toLocaleString('en-US')}`, `${compsSrc}; ${raw.quantile_method ?? 'inclusive'} quartiles`);
put('comps_newest', comps.newest[0], `${comps.newest[0].addr}, built ${comps.newest[0].yearbuilt}, $${comps.newest[0].price.toLocaleString('en-US')}, ${comps.newest[0].sqft} sq ft`, compsSrc);
put('ward5_all_time', { transfers: raw.counts.transfers_all_dates, valid: raw.counts.valid_all_dates }, `${raw.counts.transfers_all_dates} transfers, ${raw.counts.valid_all_dates} valid sales since 2012`, 'the whole sales file for Ward 5 (not since 2023)');
put('hud_median', hud.median, `$${hud.median.toLocaleString('en-US')}`, `HUD FY2026 income limits, ${hud.area_name}`, hud.source_url);
put('hud_80_3p', hud.l80[2], `$${hud.l80[2].toLocaleString('en-US')}`, `HUD FY2026 80% limit, 3 people, ${hud.area_name}`, hud.source_url);
for (const [id, r, lots] of [['two', two, 1], ['three', three, 3]] as const) {
  const m = moneyFor(r, lots, true, { comps, hud, assumptions });
  put(`breakeven_${id}`, Math.round(m.break_even_psf.value), `≤ $${Math.round(m.break_even_psf.value)}/sq ft`, `engine (red assumptions): ${m.break_even_psf.formula}`);
  put(`gap_${id}`, [Math.round(m.gap.lo), Math.round(m.gap.hi)], `$${Math.round(m.gap.lo / 1000)}k–$${Math.round(m.gap.hi / 1000)}k per home`, `engine (red assumptions): ${m.gap.formula}; hypothesis H5, not a finding`);
  if (id === 'two') put('affordable_80', Math.round(m.affordable.price), `≈ $${Math.round(m.affordable.price / 1000)}k`, `engine (red assumptions): ${m.affordable.formula}`);
}

// Citywide.
if (existsSync('data/city/lots.json')) {
  const city = read<{ meta: Record<string, unknown>; lots: CityLot[] }>('data/city/lots.json');
  const rsBy = new Map<string, ReturnType<typeof buildRuleSet>>();
  const rsFor = (z: string) => rsBy.get(z) ?? (rsBy.set(z, buildRuleSet(z, rules, questions, audit)), rsBy.get(z)!);
  const cls = city.lots.map((l) => classifyCityLot(l, l.zone ? rsFor(l.zone) : null, 'two', DEFAULT_SETTINGS));
  const s = summarize(city.lots, cls, 'two');
  put('city_lots_total', s.total, s.total.toLocaleString('en-US'), `data/city/lots.json (${String(city.meta.source)})`);
  put('city_lots_computed', s.computed, s.computed.toLocaleString('en-US'), 'lots in districts with checked rules, edges computed, records agreeing');
  put('city_width_not_area', s.widthNotArea, s.widthNotArea.toLocaleString('en-US'), 'two-unit house: lots big enough by area but too narrow (engine classifier)');
  put('city_area_any', s.areaAny, s.areaAny.toLocaleString('en-US'), 'two-unit house: lots under the minimum area (engine classifier)');
  put('city_by_first_blocker', s.byBlocker, JSON.stringify(s.byBlocker), 'two-unit house, first blocker per lot (engine classifier)');
  put('city_districts_computed', s.districts.filter((d) => d.computed).map((d) => d.zone), s.districts.filter((d) => d.computed).map((d) => d.zone).join(', '), 'districts whose rules are at least source-checked');
}

// Extraction.
if (existsSync('data/rules/extracted/eval.json')) {
  const ev = read<Record<string, unknown>>('data/rules/extracted/eval.json');
  put('extraction_eval', ev, 'see docs/eval.md', 'extract/eval.py against the hand-checked answer key');
}

// Held-out lot (set in data/film-heldout.json by the orchestrator once the block exists).
if (existsSync('film/heldout.json')) {
  const hl = read<{ link: string; label: string }>('film/heldout.json');
  put('held_out_link', `?${hl.link}`, hl.label, 'film/heldout.json');
}

mkdirSync('film', { recursive: true });
writeFileSync('film/facts.json', JSON.stringify({ data_pulled: b.meta.pulled, note: 'Generated by scripts/facts.ts from the engine and data. Do not edit by hand.', facts }, null, 1) + '\n');
console.log(`film/facts.json: ${Object.keys(facts).length} facts`);
for (const [k, v] of Object.entries(facts)) console.log(`  ${k}: ${v.display}`);
