// C15 (spec §0.14): the citywide assembly finder. Reads the citywide lots (data/city/lots.json) and the
// assembly work file (data/city/work/assembly_work.json, from `uv run python -m pipeline.assembly`), finds
// runs of 2–3 contiguous lots on each candidate's block face that fit as of right when the candidate alone
// doesn't, and writes data/city/assemblies.json. Owner type only; never names.
//   npx tsx scripts/build-assemblies.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runsFor, type AsmParcel, type AssemblyRun, type PartnerSkip } from '../engine/src/assembly';
import { classifyCityLot, type CityLot } from '../engine/src/city';
import { buildRuleSet, DEFAULT_SETTINGS, type BlockFile, type Pt, type Street, type TemplateId } from '../engine/src/index';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const WORK = 'data/city/work/assembly_work.json';
const OUT = 'data/city/assemblies.json';
const DISTRICT = 'RM-M';
const TYPES: TemplateId[] = ['three', 'two'];
const FT_PER_DEG = 364000; // pipeline/geo.py LocalFrame

export interface AssemblyFile {
  meta: {
    note: string;
    district: string;
    candidates: number;
    skipped: Record<string, number>;
    partners_ruled_out: Record<string, number>;
    corners: string;
    built_neighbours: string;
    by_type: Record<string, { runs: number; all_city: number; candidates_covered: number; pencil: number }>;
    sources: unknown;
    pulled: string;
  };
  runs: (AssemblyRun & { candidates: string[]; block: string | null; lot_key: string | null; lots_param: string | null })[];
}

export function assemblyFacts(f: AssemblyFile) {
  const three = f.meta.by_type.three;
  return {
    assemblies_citywide: { value: three.runs, display: `${three.runs} lot groups of 2–3 side-by-side lots (some share lots), touching ${three.candidates_covered} City lots, fit a three-unit house as of right when combined`, source: `data/city/assemblies.json (${f.meta.district}, ${f.meta.candidates} City-owned vacant lots checked)` },
    assemblies_all_city_owned: { value: three.all_city, display: `${three.all_city} of those lot groups are all City-owned`, source: 'data/city/assemblies.json' },
  };
}

function main() {
  if (!existsSync(WORK)) throw new Error(`${WORK} missing: run \`uv run python -m pipeline.assembly --pins data/city/work/assembly_candidates.json\` first`);
  const work = J(WORK);
  const cityLots: CityLot[] = J('data/city/lots.json').lots;
  const rs = buildRuleSet(DISTRICT, [...J('data/rules/base/rm-m.json'), ...J('data/rules/base/pgh.json')], J('data/rules/questions.json'), []);
  const settings = DEFAULT_SETTINGS;

  // Detailed blocks, for deep links into the lot view.
  const blocks: BlockFile[] = readdirSync('data/blocks').filter((f) => /^[0-9A-Z]+\.json$/.test(f)).map((f) => J(`data/blocks/${f}`));
  const blockOf = new Map<string, { id: string; key: string }>();
  for (const b of blocks) for (const p of b.parcels) blockOf.set(p.pin, { id: b.meta.id, key: `${p.lot ?? p.pin}${p.lot_suffix ?? ''}` });

  const raw: Record<string, any> = work.parcels;
  const streetsLL: { name: string; line_ll: [number, number][] }[] = work.streets;

  const candidates = cityLots.filter((l) => l.zone === DISTRICT);
  const skipped: Record<string, number> = {};
  const usable: CityLot[] = [];
  for (const l of candidates) {
    const c = classifyCityLot(l, rs, 'three', settings);
    if (c.blocker === 'records' || c.blocker === 'edges' || c.blocker === 'rules') skipped[c.blocker] = (skipped[c.blocker] ?? 0) + 1;
    else if (!raw[l.pin]) skipped.no_work_geometry = (skipped.no_work_geometry ?? 0) + 1;
    else usable.push(l);
  }

  const partnerSkips = new Map<string, PartnerSkip>();
  const byKey = new Map<string, AssemblyFile['runs'][number]>();
  for (const cand of usable) {
    const [lon0, lat0] = cand.ll;
    const kx = Math.cos((lat0 * Math.PI) / 180) * FT_PER_DEG;
    const proj = (lon: number, lat: number): Pt => [(lon - lon0) * kx, (lat - lat0) * FT_PER_DEG];
    // Parcels within three hops of the candidate, in its frame.
    const near = new Map<string, AsmParcel>();
    let frontier = [cand.pin];
    const seen = new Set(frontier);
    for (let h = 0; h <= 3 && frontier.length; h++) {
      const next: string[] = [];
      for (const pin of frontier) {
        const r = raw[pin];
        if (!r) continue;
        near.set(pin, {
          pin,
          addr: r.addr,
          zone: r.zone,
          built: !!r.built,
          multipolygon: r.multipolygon,
          deed: r.deed ? { front: r.deed.front, depth: r.deed.depth } : null,
          assessed: r.assess?.lotarea ?? null,
          mapped: r.mapped_area,
          ring: (r.ring_ll as [number, number][]).map(([lon, lat]) => proj(lon, lat)),
          nbrs: r.nbrs,
          city: r.city ? { status: r.city.status, status_updated: r.city.status_updated } : null,
          assess: r.assess ? { class: r.assess.class ?? null, ownercat: r.assess.ownercat ?? null, use: r.assess.use ?? null } : null,
          lot: r.lot,
          lot_suffix: r.lot_suffix,
        });
        if (h < 3) for (const n of r.nbrs as string[]) if (!seen.has(n)) (seen.add(n), next.push(n));
      }
      frontier = next;
    }
    const streets: Street[] = streetsLL
      .map((s) => ({ name: s.name, line: s.line_ll.map(([lon, lat]) => proj(lon, lat)) }))
      .filter((s) => s.line.some(([x, y]) => Math.abs(x) < 600 && Math.abs(y) < 600));
    for (const type of TYPES) {
      for (const run of runsFor(cand, near, streets, rs, type, settings, partnerSkips)) {
        const key = `${type}|${[...run.pins].sort().join('+')}`;
        const prev = byKey.get(key);
        if (prev) {
          if (!prev.candidates.includes(cand.pin)) prev.candidates.push(cand.pin);
          continue;
        }
        const bl = run.pins.map((p) => blockOf.get(p));
        const sameBlock = bl.every((x) => x && x.id === bl[0]!.id) ? bl[0]!.id : null;
        byKey.set(key, {
          ...run,
          candidates: [cand.pin],
          block: sameBlock,
          lot_key: sameBlock ? blockOf.get(cand.pin)!.key : null,
          lots_param: sameBlock ? run.pins.map((p) => blockOf.get(p)!.key).join(',') : null,
        });
      }
    }
  }

  const runs = [...byKey.values()].sort((a, b) => a.type.localeCompare(b.type) || a.non_city - b.non_city || b.width - a.width || a.pins[0].localeCompare(b.pins[0]));
  const by_type: AssemblyFile['meta']['by_type'] = {};
  for (const t of TYPES) {
    const rt = runs.filter((r) => r.type === t);
    by_type[t] = { runs: rt.length, all_city: rt.filter((r) => r.non_city === 0).length, candidates_covered: new Set(rt.flatMap((r) => r.candidates)).size, pencil: rt.filter((r) => r.trust === 'pencil').length };
  }
  const ruledOut: Record<string, number> = {};
  for (const why of partnerSkips.values()) ruledOut[why] = (ruledOut[why] ?? 0) + 1;
  const file: AssemblyFile = {
    meta: {
      note: "Runs of 2–3 contiguous lots on one block face that fit the dimensional rules as of right when combined, where the City lot alone doesn't. Combining lots needs a lot consolidation and the owners' agreement; this is not an offer, and it hasn't been checked with the City. Owner type only; never names.",
      district: DISTRICT,
      candidates: usable.length,
      skipped,
      partners_ruled_out: ruledOut,
      corners: 'handled: an outer side on a street takes the exterior side setback, as the citywide classifier does',
      built_neighbours: 'not partners (buying or demolishing a home is a different decision); an open question, not a silent exclusion',
      by_type,
      sources: work.meta.sources,
      pulled: work.meta.pulled,
    },
    runs,
  };
  writeFileSync(OUT, JSON.stringify(file) + '\n');
  console.log(`assemblies: ${usable.length} candidates (skipped ${JSON.stringify(skipped)}); partners ruled out ${JSON.stringify(ruledOut)}`);
  for (const t of TYPES) console.log(`  ${t}: ${JSON.stringify(by_type[t])}`);
  const mahon = runs.find((r) => r.type === 'three' && [...r.pins].sort().join('+') === ['0010K00025000000', '0010K00026000000', '0010K00027000000'].join('+'));
  console.log('  Mahon 25–27:', mahon ? `${mahon.width} ft (${mahon.formula}), ${mahon.non_city} non-City, ${mahon.trust}` : 'not found');
  console.log(`→ ${OUT}`);
}

if (process.argv[1]?.endsWith('build-assemblies.ts')) main();
