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
  leftWords,
  moneyFor,
  siteUnknowns,
  verdictFor,
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
const inputs = { comps: { ...comps, meta: { ...comps.meta, ward: 5 } }, hud, assumptions };
const k = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
function moneyFacts(tag: string, r: ReturnType<typeof evaluate>, blk: BlockFile, inp: typeof inputs, where: string) {
  const m = moneyFor(r, inp);
  const v = verdictFor(r, m, null, blk);
  put(`home_sqft_${tag}`, m.sqft, `${m.sqft.toLocaleString('en-US')} sq ft per home`, `template (red, editable); ${where}`);
  put(`new_build_value_${tag}`, m.new_build?.value ?? null, m.new_build ? `${k(m.new_build.value)} (${m.new_build.label.replace(/^Newest new build: /, '')})` : 'none', `${m.new_build?.label ?? 'no recent new build'}: ${m.new_build?.note ?? ''}; WPRDC sales, Ward ${inp.comps.meta.ward}`);
  for (const e of m.estimates) {
    const sfx = e.id === 'A' ? '' : `_${e.id}`;
    put(`vertical_cost_${tag}${sfx}`, e.vertical, e.vertical[0] === e.vertical[1] ? `${k(e.vertical[0])} per home` : `${k(e.vertical[0])}–${k(e.vertical[1])} per home`, `engine: ${e.formula.split(';')[0]}; ${e.label}, ${e.supplied_by} (practitioner estimate${e.speculative ? ', speculative' : ''})`);
    put(`left_after_building_${tag}${sfx}`, e.left, e.left[0] === e.left[1] ? `${k(e.left[0])} left` : `${leftWords(e.left)} (${k(e.left[0])} to ${k(e.left[1])})`, `engine: new-build sale minus vertical construction, per home, ${e.label}; left for site work, soft costs and land`);
  }
  put(`cost_range_spread_${tag}`, m.swing, `${k(m.swing)} per home across the $${m.estimates[0].psf[0]}–$${m.estimates[0].psf[1]}/sf range`, 'engine: high minus low vertical cost at the practitioner estimate');
  put(`verdict_${tag}`, { headline: v.headline, words: v.words, money: m.money_verdict, chips: v.chips.map((c) => ({ id: c.id, state: c.state, words: c.words })) }, v.words, `engine verdictFor(); money verdict ${m.money_verdict}; ${where}`);
  return m;
}
const m3 = moneyFacts('three', three, b, inputs, 'three-unit on lots 25–27, Mahon St');
moneyFacts('two', two, b, inputs, 'two-unit on lot 25 alone, 2241 Mahon St');
put('site_work_single_unit', [m3.site_work.lo, m3.site_work.hi], `${k(m3.site_work.lo)}–${k(m3.site_work.hi)} typical, not a cap`, `${m3.site_work.supplied_by}; ${m3.site_work.note}`);
for (const c of m3.context) put(`value_context_${c.id}`, c.value, k(c.value), `${c.label}: ${c.note}`);
put('affordable_80', Math.round(m3.affordable.price), `≈ ${k(m3.affordable.price)}`, `engine (red mortgage assumptions), a ceiling for an affordable sale: ${m3.affordable.formula}`);
put('cost_estimates_psf', m3.estimates.map((e) => ({ id: e.id, psf: e.psf, label: e.label, supplied_by: e.supplied_by, speculative: e.speculative })), m3.estimates.map((e) => `${e.label}: ${e.psf[0] === e.psf[1] ? `~$${e.psf[0]}` : `$${e.psf[0]}–$${e.psf[1]}`}/sf`).join('; '), 'data/assumptions.json (practitioner estimates from the hackathon Slack, 26 Sep 2026; never averaged)');
const v25 = verdictFor(two, moneyFor(two, inputs), null, b);
put('verdict_lot25_two', v25.words, v25.words, 'engine verdictFor() for 2241 Mahon St, two-unit house on the lot alone');
// Larimer (held-out, Ward 12).
if (existsSync('data/blocks/0124P.json') && existsSync('data/money/comps_ward12.json')) {
  const lb = read<BlockFile>('data/blocks/0124P.json');
  const lrs = buildRuleSet('R1D-H', rules, questions, audit);
  const lr = evaluate({ block: lb, rs: lrs, settings: DEFAULT_SETTINGS }, { type: 'detached', pins: ['0124P00203000000'], proposal: proposalFor('detached') });
  const r12 = read<Comps & { newest_built: Comps['newest'] }>('data/money/comps_ward12.json');
  moneyFacts('larimer', lr, lb, { comps: { ...r12, newest: r12.newest_built, meta: { ...r12.meta, ward: 12 } }, hud, assumptions }, 'detached house on 511 Lowell St, Larimer (R1D-H rules are unreviewed pencil)');
}
const site = siteUnknowns(three, b);
put('site_soil_slopes_25_27', site[0].signals[0], site[0].signals[0], 'City slope layer (PGHWebSlope25) shares, per lot');
put('site_environmental_1927', b.hist_zoning?.['1927'], String(b.hist_zoning?.['1927']), 'WPRDC 1927 zoning map at the block centroid');

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
writeFileSync('film/facts.json', JSON.stringify({ data_pulled: b.meta.pulled, superseded: { 'gap_lower_bound_*': 'removed by spec §0.13 C11: the headline is now what a new-build sale leaves after building', '*_B': 'the $325–$375/sf estimate was superseded (team decision, spec §0.13: its author deferred to the other practitioner for local construction cost)', 'vertical_psf': 'replaced by cost_estimates_psf (two practitioners, never averaged)', 'value_signal_*': 'replaced by new_build_value_* and value_context_*' }, note: 'Generated by scripts/facts.ts from the engine and data. Do not edit by hand.', facts }, null, 1) + '\n');
console.log(`film/facts.json: ${Object.keys(facts).length} facts`);
for (const [k, v] of Object.entries(facts)) console.log(`  ${k}: ${v.display}`);
