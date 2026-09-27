// Engine wiring for the interface. The interface never computes a number itself: it calls the
// engine and renders the result object.
import { useMemo } from 'react';
import {
  buildInquiry,
  siteUnknowns,
  verdictFor,
  type Inquiry,
  type SiteRow,
  type Verdict,
  DEFAULT_SETTINGS,
  distPointPolyline,
  openRing,
  buildRuleSet,
  evaluate,
  moneyFor,
  orderAlongStreet,
  proposalFor,
  unlockSearch,
  type EvalContext,
} from '@engine/index';
import type { AuditEntry, BlockFile, LotResult, MoneyResult, Parcel, Scenario, TemplateId } from '@engine/types';
import { ASSUMPTIONS, COMPS_BY_WARD, HUD, QUESTIONS, RULES, STUCK } from './data';
import type { VarianceContext } from '@engine/verdict';
import type { UrlState } from './url';

export function lotKey(p: Parcel): string {
  return `${p.lot ?? ''}${p.lot_suffix ?? ''}`;
}

export function parcelByLot(block: BlockFile, lot: string): Parcel | undefined {
  return block.parcels.find((p) => lotKey(p) === lot) ?? block.parcels.find((p) => p.pin === lot);
}

/** The lots that front the block's main street (geometrically, within 45 ft of its centerline),
 *  in street order: the row the plate is about. Lot 22 counts even though its address is on Humber Way. */
export function mainRow(block: BlockFile): Parcel[] {
  const lines = block.streets.filter((s) => s.name === block.meta.main_street).map((s) => s.line);
  const near = (p: Parcel) => openRing(p.poly[0]).some((pt) => lines.some((l) => distPointPolyline(pt, l) < 45));
  const row = block.parcels.filter(near);
  return orderAlongStreet(block, row.map((p) => p.pin)).map((pin) => block.parcels.find((p) => p.pin === pin)!);
}

export function contextFor(block: BlockFile, district: string | null, audit: AuditEntry[], tol: number | null): EvalContext {
  const rs = buildRuleSet(district ?? '—', RULES, QUESTIONS, audit);
  return { block, rs, settings: { ...DEFAULT_SETTINGS, recon_tolerance: tol ?? DEFAULT_SETTINGS.recon_tolerance } };
}

export function scenarioFrom(block: BlockFile, s: UrlState): Scenario | null {
  const sel = parcelByLot(block, s.lot);
  if (!sel) return null;
  // The selected lot comes first; lot keys that aren't on the block are passed through so the engine can say so.
  const keys = s.lots.length > 1 ? [s.lot, ...s.lots.filter((l) => l !== s.lot && parcelByLot(block, l)?.pin !== sel.pin)] : [s.lot];
  const found = keys.map((l) => parcelByLot(block, l));
  const group = found.filter((p): p is Parcel => !!p);
  const unknown = keys.filter((_, i) => !found[i]);
  const over: Record<string, number> = {};
  if (s.w != null) over.width = s.w;
  if (s.d != null) over.depth = s.d;
  if (s.st != null) over.stories = s.st;
  if (s.h != null) over.height = s.h;
  return { type: s.type, pins: group.map((p) => p.pin), proposal: proposalFor(s.type, over), ...(unknown.length ? { unknown_lots: unknown } : {}) };
}

export interface LotModel {
  ctx: EvalContext;
  scenario: Scenario;
  result: LotResult;
  row: { parcel: Parcel; result: LotResult }[];
  unlock: ReturnType<typeof unlockSearch>;
  money: MoneyResult | null;
  moneyGap: string | null; // why the money wall is not assessed
  verdict: Verdict;
  site: SiteRow[];
  inquiry: Inquiry;
  vctx: VarianceContext;
}

export function useLotModel(block: BlockFile | undefined, s: UrlState, audit: AuditEntry[]): LotModel | null {
  return useMemo(() => {
    if (!block) return null;
    const scenario = scenarioFrom(block, s);
    if (!scenario) return null;
    const sel = block.parcels.find((p) => p.pin === scenario.pins[0])!;
    const ctx = contextFor(block, sel.zone, audit, s.tol);
    const result = evaluate(ctx, scenario);
    const row = mainRow(block).map((p) => {
      const own: Scenario = { type: s.type, pins: [p.pin], proposal: scenario.proposal };
      const pctx = p.zone === sel.zone ? ctx : contextFor(block, p.zone, audit, s.tol);
      return { parcel: p, result: evaluate(pctx, own) };
    });
    const unlock = unlockSearch(ctx, { ...scenario, pins: [sel.pin], type: scenario.pins.length > 1 ? 'two' : scenario.type, proposal: scenario.pins.length > 1 ? proposalFor('two') : scenario.proposal });
    // Comparable sales are local: use them only for lots in the ward they were pulled for.
    const comps = block.meta.ward != null ? COMPS_BY_WARD[block.meta.ward] : undefined;
    const wards = Object.keys(COMPS_BY_WARD).join(', ');
    const moneyGap = !HUD || !ASSUMPTIONS.length ? 'money data not loaded' : !comps ? `comparable sales are loaded for Ward ${wards || '—'} only; this lot is in Ward ${block.meta.ward ?? 'unknown'}` : null;
    const money = !moneyGap && comps && result.state === 'ok' ? moneyFor(result, { comps, hud: HUD!, assumptions: ASSUMPTIONS }) : null;
    // The variance line's context (team decision, 27 Sep): how many lots on this street fail the same way, and
    // how many City lots citywide are too narrow while big enough (build-time summary).
    const sameZone = row.filter((x) => x.parcel.zone === sel.zone);
    const scored = sameZone.filter((x) => x.result.state === 'ok');
    const vctx: VarianceContext = {
      street: { same: scored.filter((x) => x.result.relief.some((y) => y.check === 'width' && y.text.startsWith('side setbacks'))).length, of: scored.length, unscored: sameZone.length - scored.length },
      stuck: STUCK[s.type] ? { n: STUCK[s.type]!.width_not_area, districts: STUCK[s.type]!.districts } : undefined,
    };
    const verdict = verdictFor(result, money, moneyGap, block, vctx);
    const site = siteUnknowns(result, block);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const inquiry = buildInquiry(result, block, ctx.rs, money, today, ctx.settings, vctx);
    return { ctx, scenario, result, row, unlock, money, moneyGap, verdict, site, inquiry, vctx };
  }, [block, s.lot, s.lots.join(','), s.type, s.w, s.d, s.st, s.h, s.tol, audit]);
}

export const TYPE_ORDER: TemplateId[] = ['detached', 'two', 'row', 'three'];
