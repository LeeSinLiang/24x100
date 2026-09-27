// The block with no lot selected (view=block): every lot's envelope for the chosen building type,
// each lot alone. Moved from BlockView (spec §0.15); every number is the engine's.
import { useMemo } from 'react';
import { evaluate, proposalFor } from '@engine/index';
import type { AuditEntry, BlockFile, LotResult, Parcel, TemplateId } from '@engine/types';
import { contextFor, mainRow } from './model';

export function byLot(a: Parcel, b: Parcel): number {
  return (a.lot ?? 0) - (b.lot ?? 0) || (a.lot_suffix ?? '').localeCompare(b.lot_suffix ?? '');
}

export interface BlockModel {
  row: Parcel[];
  zone: string | null;
  results: Map<string, LotResult>;
  plateRow: { parcel: Parcel; result: LotResult }[];
  rest: Parcel[];
}

export function useBlockModel(block: BlockFile | undefined, type: TemplateId, audit: AuditEntry[], tol: number | null): BlockModel | null {
  return useMemo(() => {
    if (!block) return null;
    const row = mainRow(block);
    const zoneCount = new Map<string, number>();
    for (const p of row) zoneCount.set(p.zone ?? '—', (zoneCount.get(p.zone ?? '—') ?? 0) + 1);
    const zone = [...zoneCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ctxs = new Map<string, ReturnType<typeof contextFor>>();
    const ctx = (z: string | null) => {
      const k = z ?? '—';
      if (!ctxs.has(k)) ctxs.set(k, contextFor(block, z, audit, tol));
      return ctxs.get(k)!;
    };
    const proposal = proposalFor(type);
    const results = new Map<string, LotResult>();
    for (const p of block.parcels) results.set(p.pin, evaluate(ctx(p.zone), { type, pins: [p.pin], proposal }));
    const plateRow = row.filter((p) => p.zone === zone).map((p) => ({ parcel: p, result: results.get(p.pin)! }));
    const rest = block.parcels.filter((p) => !row.includes(p)).sort(byLot);
    return { row, zone, results, plateRow, rest };
  }, [block, type, audit, tol]);
}

/** Fits, short, refused on the block's main row (for the block sentence and tiles). */
export function blockCounts(m: BlockModel) {
  const scored = m.plateRow.filter((x) => x.result.state === 'ok');
  const fits = scored.filter((x) => x.result.checks.find((c) => c.id === 'width')?.status === 'pass');
  const short = scored.filter((x) => x.result.checks.find((c) => c.id === 'width')?.status === 'fail');
  const refused = m.plateRow.filter((x) => x.result.state !== 'ok');
  const widths = [...new Set(short.map((x) => x.result.width?.deed ?? x.result.width?.mapped ?? 0))];
  return { scored, fits, short, refused, widths };
}
