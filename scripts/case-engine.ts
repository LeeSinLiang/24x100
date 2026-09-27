// The engine, for the agents (agents/, Python): every number a case file shows comes from here, never from a model.
//   npx tsx scripts/case-engine.ts lot <pin> [--type two]              the lot's reading: blockers, width, money, route, letters
//   npx tsx scripts/case-engine.ts simulate <pin> --built <pin> [--type two]   the same lot if a neighbour were built (SIMULATED)
//   npx tsx scripts/case-engine.ts watch [--baseline <git ref>]        the watched lots' changes (scripts/digest.ts), with the math
// Prints one JSON object on stdout. Deterministic: the same files give the same output.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  buildInquiry,
  buildRuleSet,
  checkQuote,
  cityLotOfParcel,
  classifyCityLot,
  DEFAULT_SETTINGS,
  distPointPolyline,
  evaluate,
  headline,
  moneyFor,
  nextStep,
  openRing,
  orderAlongStreet,
  proposalFor,
  TEMPLATES,
  unlockSearch,
  verdictFor,
  withQuoteStatus,
  type AuditEntry,
  type BlockFile,
  type Comps,
  type Hud,
  type LotResult,
  type Parcel,
  type Question,
  type Rule,
  type Scenario,
  type TemplateId,
} from '../engine/src/index';
import { diffStates, verdictWords, type WatchSnapshot } from '../engine/src/digest';
import { pick } from '../engine/src/rules';
import { snapshot } from './digest';

const read = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const rulesRaw: Rule[] = [
  ...readdirSync('data/rules/base').flatMap((f) => read<Rule[]>(`data/rules/base/${f}`)),
  ...readdirSync('data/rules/extracted').filter((f) => f.endsWith('.json') && f !== 'eval.json').flatMap((f) => read<{ rules?: Rule[] }>(`data/rules/extracted/${f}`).rules ?? []),
];
const RULES = withQuoteStatus(rulesRaw, (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null), checkQuote);
const QUESTIONS = read<Question[]>('data/rules/questions.json');
const rv = read<{ entries?: AuditEntry[] } | AuditEntry[]>('data/rules/reviews.json');
const AUDIT = Array.isArray(rv) ? rv : rv.entries ?? [];
const CITY_LL = new Map(read<{ lots: { pin: string; ll: [number, number] }[] }>('data/city/lots.json').lots.map((l) => [l.pin, l.ll]));
const BLOCKS: BlockFile[] = readdirSync('data/blocks')
  .filter((f) => /^[0-9A-Z]+\.json$/.test(f))
  .map((f) => read<BlockFile>(`data/blocks/${f}`));

function money() {
  const comps: Record<number, Comps> = {};
  for (const f of readdirSync('data/money')) {
    const w = f.match(/^comps_ward(\d+)\.json$/)?.[1];
    if (!w) continue;
    const raw = read<Comps & { newest_built: Comps['newest'] }>(`data/money/${f}`);
    comps[Number(w)] = { ...raw, newest: raw.newest_built ?? raw.newest, meta: { ...raw.meta, ward: Number(w) } } as Comps;
  }
  const h = read<Record<string, unknown> & { meta: { url: string; pulled: string } }>('data/money/hud_fy2026.json');
  const hud: Hud = { area_name: String(h.hud_area_name), median: Number(h.median_family_income), l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(h[`l80_${i}`])), source_url: h.meta.url, pulled: h.meta.pulled };
  return { comps, hud, assumptions: read<never[]>('data/assumptions.json') };
}

/** The street the block is drawn along (web/src/lib/model.ts mainRow). */
function mainRow(block: BlockFile): Parcel[] {
  const lines = block.streets.filter((s) => s.name === block.meta.main_street).map((s) => s.line);
  const near = (p: Parcel) => openRing(p.poly[0]).some((pt) => lines.some((l) => distPointPolyline(pt, l) < 45));
  const row = block.parcels.filter(near);
  return orderAlongStreet(block, row.map((p) => p.pin)).map((pin) => block.parcels.find((p) => p.pin === pin)!);
}

const text = (segs: { t: string }[]) => segs.map((s) => s.t).join('');
const lotNo = (p: Parcel) => `${p.lot ?? p.pin}${p.lot_suffix ?? ''}`;

/** A lot with block detail, read by the lot engine exactly as the lot page reads it. */
function lotReading(pin: string, type: TemplateId, builtOverride?: string[]) {
  const block0 = BLOCKS.find((b) => b.parcels.some((p) => p.pin === pin));
  if (!block0) return null;
  const block: BlockFile = builtOverride ? { ...block0, parcels: block0.parcels.map((p) => (builtOverride.includes(p.pin) ? { ...p, built: true, built_basis: 'SIMULATED: a building permit issued (not a record)' } : p)) } : block0;
  const sel = block.parcels.find((p) => p.pin === pin)!;
  const rs = buildRuleSet(sel.zone ?? '—', RULES, QUESTIONS, AUDIT);
  const ctx = { block, rs, settings: DEFAULT_SETTINGS };
  const scenario: Scenario = { type, pins: [pin], proposal: proposalFor(type) };
  const r: LotResult = evaluate(ctx, scenario);
  const M = money();
  const comps = block.meta.ward != null ? M.comps[block.meta.ward] : undefined;
  const m = comps && r.state === 'ok' ? moneyFor(r, { comps, hud: M.hud, assumptions: M.assumptions }) : null;
  const moneyGap = comps ? null : `comparable sales aren't loaded for Ward ${block.meta.ward ?? 'unknown'}`;
  const row = mainRow(block).filter((p) => p.zone === sel.zone);
  const rows = row.map((p) => evaluate({ ...ctx, rs: buildRuleSet(p.zone ?? '—', RULES, QUESTIONS, AUDIT) }, { type, pins: [p.pin], proposal: proposalFor(type) }));
  const scored = rows.filter((x) => x.state === 'ok');
  const vctx = { street: { same: scored.filter((x) => x.relief.some((y) => y.check === 'width' && y.text.startsWith('side setbacks'))).length, of: scored.length, unscored: rows.length - scored.length } };
  const verdict = verdictFor(r, m, moneyGap, block, vctx);
  const unlock = unlockSearch(ctx, scenario);
  const next = nextStep(unlock, block);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const inq = buildInquiry(r, block, rs, m, today, ctx.settings, vctx);
  const used = new Set(r.checks.flatMap((c) => c.rule_ids));
  const rules = rs.rules
    .filter((x) => used.has(x.id))
    .map((x) => ({ id: x.id, field: x.field, value: x.value, section: x.section, quote: x.quote, source_file: x.source_file, state: x.state, signed_by: x.verification.level !== 'unreviewed' ? x.verification.reviewer : null }));
  const failing = r.checks.filter((c) => c.status === 'fail' || c.status === 'open');
  const neighbours = mainRow(block).map((p) => p.pin);
  const at = neighbours.indexOf(pin);
  // The citywide classifier's reading of the same lot: next to a built lot it gives the contextual best case (§925.06.C,
  // down to the rule's minimum), pencil because it depends on that building's actual setback.
  const cc = classifyCityLot(cityLotOfParcel(block, sel), rs, type, DEFAULT_SETTINGS);
  const contextual = { neighbors: cc.context?.neighbors ?? null, minimum: cc.context?.minimum ?? null, best: cc.context?.best ?? null, formula: cc.context?.formula ?? null, trust: cc.context?.best != null ? 'pencil' : null, note: r.checks.find((c) => c.id === 'contextual')?.text ?? null };
  return {
    kind: 'lot',
    simulated: builtOverride ? { built: builtOverride, note: 'SIMULATED: treated as built (a building permit issued). Not a record.' } : null,
    contextual,
    lot: {
      pin,
      addr: sel.addr.replace(/\s*\(no number\)$/, ''),
      lot: lotNo(sel),
      block: block.meta.id,
      block_name: block.meta.name,
      hood: block.meta.neighborhood,
      ward: block.meta.ward,
      zone: sel.zone,
      city: sel.city ? { status: sel.city.status, status_updated: sel.city.status_updated } : null,
      owner_type: sel.city ? 'City of Pittsburgh' : sel.assess?.ownercat ?? null, // owner TYPE only, never a name
      deed: sel.deed ? { front: sel.deed.front, depth: sel.deed.depth } : null,
      slope25: sel.slope25,
      undermined: sel.undermined,
      overlays: sel.overlays,
      ll: CITY_LL.get(pin) ?? null, // [lon, lat], from the citywide file
      pulled: block.meta.pulled,
      neighbours: { left: at > 0 ? neighbours[at - 1] : null, right: at >= 0 && at < neighbours.length - 1 ? neighbours[at + 1] : null },
      link: `?view=lot&block=${block.meta.id}&lot=${lotNo(sel)}&type=${type}`,
    },
    type,
    type_name: TEMPLATES[type].name.toLowerCase(),
    state: r.state,
    refusal: r.refusal ? { code: r.refusal.code, reason: r.refusal.reason } : null,
    width: r.width ? { deed: r.width.deed, mapped: r.width.mapped, formula: r.width.formula } : null,
    proposal_width: r.scenario.proposal.width,
    headline: text(headline(r, block, rs)),
    verdict: { headline: verdict.headline, words: verdict.words, detail: verdict.detail },
    blockers: failing.map((c) => ({ id: c.id, label: c.label, status: c.status, trust: c.trust, text: c.text, required: c.required, available: c.available, rule_ids: c.rule_ids })),
    first_blocker: failing[0] ? { id: failing[0].id, label: failing[0].label, is_rule: failing[0].rule_ids.length > 0 } : null,
    rules,
    money: m
      ? {
          verdict: m.money_verdict,
          new_build: m.new_build ? { value: m.new_build.value, label: m.new_build.label } : null,
          estimates: m.estimates.map((e) => ({ label: e.label, psf: e.psf, vertical: e.vertical, left: e.left, supplied_by: e.supplied_by, formula: e.formula })),
          site_work: { lo: m.site_work.lo, hi: m.site_work.hi },
        }
      : null,
    way_forward: next.primary ? { label: next.primary.label, width: next.primary.result.width?.deed ?? null } : null,
    route: (inq.sections.find((x) => x.id === 'next')?.items ?? []).map((it) => ({ text: it.text, trust: it.trust })),
    letters: inq.letters.map((l) => ({ office: l.office, tab: l.tab, to: l.to, subject: l.subject, about: l.about, markdown: l.markdown, numbers_ok: l.check.ok, numbers_checked: l.check.checked })),
    number_check: inq.check,
  };
}

function watch(baseline?: string) {
  const watchlist = read<{ watch?: { label: string; pins: string[]; type?: TemplateId }[] }>('data/watchlist.json').watch ?? [];
  const at = new Date().toISOString();
  const now = snapshot(watchlist, undefined, 'now', at).snap;
  let before: WatchSnapshot | null = null;
  if (baseline) before = snapshot(watchlist, baseline, `git ${baseline}`, at).snap;
  else if (existsSync('data/digest/last.json')) before = read<WatchSnapshot>('data/digest/last.json');
  return { kind: 'watch', compared_with: before?.label ?? null, changes: diffStates(before, now, []) };
}

/** Every City-owned vacant lot, read by the citywide classifier (the map's own reading, signed rules only): the lots
 *  where this building fits today, listed for sale ("fits") or City-owned and not listed ("ownership"). */
function shortlistCandidates(type: TemplateId) {
  const lots = read<{ lots: (import('../engine/src/city').CityLot & { block?: string; lot_no?: string })[] }>('data/city/lots.json').lots;
  const rsBy = new Map<string, ReturnType<typeof buildRuleSet>>();
  const rsFor = (z: string) => rsBy.get(z) ?? (rsBy.set(z, buildRuleSet(z, RULES, QUESTIONS, AUDIT)), rsBy.get(z)!);
  const blockOf = new Map<string, { id: string; lot: string }>();
  for (const b of BLOCKS) for (const p of b.parcels) blockOf.set(p.pin, { id: b.meta.id, lot: `${p.lot ?? p.pin}${p.lot_suffix ?? ''}` });
  const counts: Record<string, number> = {};
  const out = [];
  for (const l of lots) {
    const c = classifyCityLot(l, l.zone ? rsFor(l.zone) : null, type, DEFAULT_SETTINGS);
    counts[c.blocker] = (counts[c.blocker] ?? 0) + 1;
    if (c.blocker !== 'fits' && c.blocker !== 'ownership') continue;
    const b = blockOf.get(l.pin);
    out.push({
      pin: l.pin,
      address: l.addr.replace(/\s*\(no number\)$/, ''),
      district: l.zone,
      hood: l.hood,
      ward: l.ward,
      ll: l.ll,
      for_sale: c.blocker === 'fits',
      status: l.status,
      verdict: { blocker: c.blocker, width: c.width, formula: c.formula, trust: c.trust, note: c.note },
      slope25: l.slope25,
      undermined: l.undermined ?? 0,
      link: b ? `?view=lot&block=${b.id}&lot=${b.lot}&type=${type}` : `?view=city&type=${type}&pin=${l.pin}`,
    });
  }
  return { kind: 'shortlist', type, type_name: TEMPLATES[type].name.toLowerCase(), lots_total: lots.length, counts, candidates: out, pins: lots.map((l) => l.pin) };
}

/** A City lot with no block detail, read by the citywide classifier (the map's reading): no plan, no money screen and no
 *  per-office letters (those need the block's geometry and the ward's sales), but the verdict, the rules it rests on and
 *  the lot's records, in the same shape as lotReading so the agents can work it. */
function cityReading(pin: string, type: TemplateId) {
  const file = read<{ meta: { pulled?: string; source?: string }; lots: import('../engine/src/city').CityLot[] }>('data/city/lots.json');
  const l = file.lots.find((x) => x.pin === pin);
  if (!l || !l.zone) return null;
  const rs = buildRuleSet(l.zone, RULES, QUESTIONS, AUDIT);
  const c = classifyCityLot(l, rs, type, DEFAULT_SETTINGS);
  const fields = ['min_lot_area', 'front_setback', 'rear_setback', 'side_setback_interior', ...(l.flank.includes('exterior') ? ['side_setback_exterior'] : []), 'narrow_lot_side_table', 'contextual_side', `use_${type}`];
  const rules = [...new Map(fields.map((f) => pick(rs, f as never)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.id, r])).values()].map((x) => ({
    id: x.id, field: x.field, value: x.value, section: x.section, quote: x.quote, source_file: x.source_file, state: x.state, signed_by: x.verification.level !== 'unreviewed' ? x.verification.reviewer : null,
  }));
  const v = { blocker: c.blocker, width: c.width, formula: c.formula, trust: c.trust };
  const words = verdictWords(v, type);
  const fits = c.blocker === 'fits' || c.blocker === 'ownership';
  return {
    kind: 'lot',
    source: 'citywide',
    simulated: null,
    contextual: null,
    lot: {
      pin, addr: l.addr.replace(/\s*\(no number\)$/, ''), lot: null, block: null, block_name: null, hood: l.hood, ward: l.ward, zone: l.zone,
      city: { status: l.status, status_updated: l.status_updated }, owner_type: 'City of Pittsburgh', deed: l.deed, slope25: l.slope25, undermined: l.undermined ?? 0,
      overlays: [], ll: l.ll, pulled: file.meta.pulled ?? null, neighbours: { left: null, right: null }, link: `?view=city&type=${type}&pin=${pin}`,
    },
    type,
    type_name: TEMPLATES[type].name.toLowerCase(),
    state: 'ok',
    refusal: null,
    width: c.width != null ? { deed: c.width, mapped: c.width, formula: c.formula } : null,
    proposal_width: TEMPLATES[type].proposal.width,
    headline: `${l.addr.replace(/\s*\(no number\)$/, '')}, ${l.hood}, zoned ${l.zone}: ${words}${c.formula ? `, ${c.formula} ft` : ''}.`,
    verdict: { headline: fits ? 'fits' : c.blocker, words, detail: c.note },
    blockers: fits ? [] : [{ id: c.blocker, label: c.blocker, status: 'fail', trust: c.trust, text: c.note, required: null, available: null, rule_ids: [] }],
    first_blocker: fits ? null : { id: c.blocker, label: c.blocker, is_rule: false },
    rules,
    money: null,
    way_forward: null,
    route: [],
    letters: [],
    number_check: { ok: true, unknown: [], checked: 0 },
  };
}

const [cmd, pin] = args;
const type = (arg('type') ?? 'two') as TemplateId;
let out: unknown;
if (cmd === 'lot') out = lotReading(pin, type) ?? cityReading(pin, type) ?? { kind: 'none', pin, why: 'not a City-owned vacant lot on the map' };
else if (cmd === 'simulate') out = lotReading(pin, type, (arg('built') ?? '').split(',').filter(Boolean)) ?? { kind: 'none', pin };
else if (cmd === 'watch') out = watch(arg('baseline'));
else if (cmd === 'shortlist') out = shortlistCandidates(type);
else {
  console.error('usage: case-engine.ts lot <pin> [--type two] | simulate <pin> --built <pin> | watch [--baseline <ref>]');
  process.exit(2);
}
process.stdout.write(JSON.stringify(out) + '\n');
