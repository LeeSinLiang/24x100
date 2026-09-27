// Scenario helpers shared by the top bar's building-type switch and the Plan canvas (moved from
// LotView, spec §0.15). They pick which lots a multi-lot type uses; they never compute a number.
import { candidateGroups } from '@engine/index';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, TemplateId } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { lotKey, type LotModel } from './model';
import type { UrlState } from './url';

/** The lot group a multi-lot type uses from the selected lot: three lots if any group of three
 *  works, preferring City lots for sale, then City lots, then the lowest lot number. */
export function defaultGroup(model: LotModel, block: BlockFile, pin: string): string[] {
  const groups = candidateGroups(model.ctx, pin);
  const threes = groups.filter((g) => g.length === 3);
  const pool = threes.length ? threes : groups;
  if (!pool.length) return [pin];
  const score = (g: string[]) => {
    const ps = g.map((x) => block.parcels.find((p) => p.pin === x)!);
    return [ps.filter((p) => p.city?.status === 'Available for Sale').length, ps.filter((p) => p.city).length, -Math.min(...ps.map((p) => p.lot ?? 0))];
  };
  return [...pool].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  })[0];
}

export function lotsLabel(block: BlockFile, pins: string[]): string {
  const lots = pins.map((p) => block.parcels.find((x) => x.pin === p)!.lot ?? 0).sort((a, b) => a - b);
  return lots.length > 1 ? `lots ${lots[0]}–${lots[lots.length - 1]}` : `lot ${lots[0]}`;
}

/** The URL patch that selects a building type on the lot view (multi-lot types take the group). */
export function scenarioPatch(type: TemplateId, block: BlockFile, group: string[]): Partial<UrlState> {
  const lots = TEMPLATES[type].multi_lot ? group.map((pin) => lotKey(block.parcels.find((p) => p.pin === pin)!)) : [];
  return { type, lots, w: undefined, d: undefined, st: undefined, h: undefined };
}

/** The URL patch that tries one of the unlock search's options. */
export function optionPatch(o: UnlockOption, block: BlockFile, selectedLot: string): Partial<UrlState> {
  const lots = o.scenario.pins.length > 1 ? o.scenario.pins.map((pin) => lotKey(block.parcels.find((p) => p.pin === pin)!)) : [];
  return { type: o.scenario.type, lots, lot: selectedLot, w: undefined, d: undefined, st: undefined, h: undefined, drawer: null };
}
