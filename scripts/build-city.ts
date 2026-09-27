// Builds data/city/lots.json, the compact citywide input for the city map, from the pipeline's work
// file (data/city/work/lots_work.json). Edge labels are computed here by the engine's labelEdges(),
// the same code the lot view uses. Lots in loaded block files are taken from the block files so the
// city map and the lot view agree. If the work file is missing, only block lots are written, and the
// meta says so.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { cityLotFromGeometry, openRing, type CityLot } from '../engine/src/index';
import type { BlockFile, Ring, Street } from '../engine/src/types';

interface WorkLot {
  pin: string;
  addr: string;
  addr_street: string | null;
  hood: string;
  ward: number | null;
  zone: string | null;
  city: { status: string; inventory: string | null; status_updated: string | null; class?: string };
  ll: [number, number];
  poly: [number, number][] | [number, number][][];
  neighbors: { pin: string; poly: [number, number][] | [number, number][][]; built: boolean; addr: string }[];
  streets: Street[];
  assess: { lotarea: number | null } | null;
  deed: { front: number; depth: number } | null;
  mapped_area: number;
  slope25: number;
  undermined?: number;
}

const ring = (p: WorkLot['poly']): Ring => (Array.isArray(p[0]?.[0]) ? (p as [number, number][][])[0] : (p as [number, number][])) as Ring;

const blocks: BlockFile[] = readdirSync('data/blocks')
  .filter((f) => f.endsWith('.json') && !f.includes('crosscheck'))
  .map((f) => JSON.parse(readFileSync(`data/blocks/${f}`, 'utf8')));

const out: CityLot[] = [];
const seen = new Set<string>();

// Block lots first (City-owned vacant ones), from the block files.
for (const b of blocks) {
  for (const p of b.parcels) {
    if (!p.city || p.built) continue;
    const neighbors = b.parcels.filter((q) => q.pin !== p.pin).map((q) => ({ pin: q.pin, ring: openRing(q.poly[0]), built: q.built, addr: q.addr, lot: q.lot }));
    const lot = cityLotFromGeometry(
      {
        pin: p.pin,
        addr: p.addr,
        hood: b.meta.neighborhood,
        ward: b.meta.ward ?? null,
        zone: p.zone,
        status: p.city.status,
        status_updated: p.city.status_updated,
        ll: [0, 0],
        deed: p.deed ? { front: p.deed.front, depth: p.deed.depth } : null,
        assessed: p.assess?.lotarea ?? null,
        mapped: Math.round(p.mapped_area),
        slope25: p.slope25,
      },
      p.poly[0],
      neighbors,
      b.streets,
      p.addr_street ?? b.meta.main_street,
    );
    // Local feet → lon/lat for the map (inverse of the block frame).
    const { lat, lon } = b.meta.origin;
    const th = (-b.meta.rotation_deg * Math.PI) / 180;
    const rp = p.rep_point ?? openRing(p.poly[0])[0];
    const x = rp[0] * Math.cos(th) - rp[1] * Math.sin(th);
    const y = rp[0] * Math.sin(th) + rp[1] * Math.cos(th);
    const kx = Math.cos((lat * Math.PI) / 180) * 364000;
    lot.ll = [Math.round((lon + x / kx) * 1e6) / 1e6, Math.round((lat - y / 364000) * 1e6) / 1e6];
    (lot as CityLot & { block?: string; lot_no?: string }).block = b.meta.id;
    out.push(lot);
    seen.add(p.pin);
  }
}

let source = 'block files only (citywide work file not present)';
const work = 'data/city/work/lots_work.json';
let skipped = 0;
if (existsSync(work)) {
  const w = JSON.parse(readFileSync(work, 'utf8')) as { meta: Record<string, unknown>; lots: WorkLot[] };
  source = `citywide work file pulled ${String(w.meta.pulled ?? '')}`;
  for (const l of w.lots) {
    if (seen.has(l.pin)) continue;
    try {
      const lot = cityLotFromGeometry(
        {
          pin: l.pin,
          addr: l.addr,
          hood: l.hood ?? 'Neighborhood not recorded',
          ward: l.ward,
          zone: l.zone,
          status: l.city.status,
          status_updated: l.city.status_updated,
          ll: l.ll,
          deed: l.deed ? { front: l.deed.front, depth: l.deed.depth } : null,
          assessed: l.assess?.lotarea ?? null,
          mapped: Math.round(l.mapped_area),
          slope25: l.slope25 ?? 0,
        },
        ring(l.poly),
        l.neighbors.map((n) => ({ pin: n.pin, ring: openRing(ring(n.poly)), built: n.built, addr: n.addr, lot: null })),
        l.streets,
        l.addr_street,
      );
      out.push(lot);
    } catch (e) {
      skipped++;
      out.push({
        pin: l.pin, addr: l.addr, hood: l.hood ?? 'Neighborhood not recorded', ward: l.ward, zone: l.zone, status: l.city.status, status_updated: l.city.status_updated, ll: l.ll,
        deed: l.deed, assessed: l.assess?.lotarea ?? null, mapped: Math.round(l.mapped_area), front_len: null, flank: [], edges_ok: false,
        edge_note: `Edges not computed: ${String((e as Error).message).slice(0, 80)}`, slope25: l.slope25 ?? 0,
      });
    }
  }
}

out.sort((a, b) => a.pin.localeCompare(b.pin));
mkdirSync('data/city', { recursive: true });
const meta = {
  source,
  pulled: [...new Set(blocks.map((b) => b.meta.pulled.slice(0, 10)))].sort().join(', '),
  count: out.length,
  edges_not_computed: out.filter((l) => !l.edges_ok).length,
  errors: skipped,
  note: 'City-owned vacant parcels. Edge labels by engine/src/edges.ts; classification happens in the browser from the current rule reviews.',
};
// A clean clone (a Vercel build) has no work file: never replace the committed citywide file with the block lots
// alone. Only a fresh pull (the work file here) rewrites it.
if (!existsSync(work) && existsSync('data/city/lots.json')) {
  console.log(`data/city/lots.json kept as committed: ${work} is not here (it comes from \`uv run python -m pipeline all\`)`);
} else {
  writeFileSync('data/city/lots.json', JSON.stringify({ meta, lots: out }) + '\n');
  console.log(`data/city/lots.json: ${out.length} lots (${meta.edges_not_computed} without edges) from ${source}`);
}
