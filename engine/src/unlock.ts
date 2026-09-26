// Unlock search over a FIXED list of levers (spec §8). It re-runs the engine for every candidate and
// ranks them: fewest discretionary approvals, then ownership difficulty, then smallest change. The
// answer is "the smallest change within these levers", never a global optimum.
import { labelEdges } from './edges';
import { evaluate, orderAlongStreet, parcelByPin, type EvalContext, NARROW_Q } from './evaluate';
import { openRing } from './geom';
import { DISCRETIONARY, TEMPLATES, proposalFor } from './templates';
import type { LotResult, QuestionState, Scenario, TemplateId } from './types';

export type Lever = 'type' | 'combine' | 'interpretation' | 'pending_policy' | 'variance';

export interface UnlockOption {
  id: string;
  lever: Lever;
  label: string;
  scenario: Scenario;
  result: LotResult;
  hypothetical: string | null; // e.g. "if the City reads … as yes" (pencil)
  pending: boolean;
  homes: number;
  fits: boolean; // width, depth, area and height pass (any trust)
  discretionary: number; // distinct discretionary approvals certainly needed
  discretionary_possible: number; // ... plus those that open questions could add
  ownership_rank: number; // 0 City lots for sale · 1 a City lot not listed for sale · 2 another owner
  change_size: number;
  rank: number;
}

/** Lots that share an interior side with `pin` (same block, same district). */
export function adjacentLots(ctx: EvalContext, pin: string): string[] {
  const p = parcelByPin(ctx.block, pin);
  if (!p) return [];
  const others = ctx.block.parcels
    .filter((q) => q.pin !== pin)
    .map((q) => ({ pin: q.pin, ring: openRing(q.poly[0]), built: q.built, addr: q.addr, lot: q.lot }));
  const lab = labelEdges(openRing(p.poly[0]), others, ctx.block.streets, p.addr_street ?? ctx.block.meta.main_street);
  if (!lab.ok) return [];
  return [
    ...new Set(
      lab.sides
        .filter((s) => s.kind === 'side_interior')
        .flatMap((s) => s.neighbors.map((n) => n.pin))
        .filter((q) => parcelByPin(ctx.block, q)?.zone === p.zone),
    ),
  ];
}

/** Candidate groups of 2–3 adjacent lots on the same frontage that include `pin`. */
export function candidateGroups(ctx: EvalContext, pin: string): string[][] {
  const adj = adjacentLots(ctx, pin);
  const groups: string[][] = [];
  for (const a of adj) {
    groups.push([pin, a]);
    for (const b of adjacentLots(ctx, a)) if (b !== pin && !adj.includes(b)) groups.push([pin, a, b]);
  }
  if (adj.length === 2) groups.push([adj[0], pin, adj[1]]);
  const seen = new Set<string>();
  return groups
    .map((g) => orderAlongStreet(ctx.block, g))
    .filter((g) => {
      const k = g.join('+');
      return seen.has(k) ? false : (seen.add(k), true);
    });
}

function ownershipRank(ctx: EvalContext, pins: string[]): number {
  let r = 0;
  for (const pin of pins) {
    const p = parcelByPin(ctx.block, pin)!;
    if (!p.city) r = Math.max(r, 2);
    else if (p.city.status !== 'Available for Sale') r = Math.max(r, 1);
  }
  return r;
}

function lotLabel(ctx: EvalContext, pins: string[]): string {
  const lots = pins.map((pin) => parcelByPin(ctx.block, pin)!.lot).filter((x): x is number => x != null);
  if (lots.length === pins.length && lots.length > 1) {
    const sorted = [...lots].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    return contiguous ? `lots ${sorted[0]}–${sorted[sorted.length - 1]}` : `lots ${sorted.join(', ')}`;
  }
  return lots.length === 1 ? `lot ${lots[0]}` : pins.join(', ');
}

function homesOf(r: LotResult): number {
  return r.scenario.type === 'row' ? r.units.length : r.scenario.proposal.units;
}

function withQuestion(ctx: EvalContext, choice: 'yes' | 'no'): EvalContext {
  const questions: QuestionState[] = ctx.rs.questions.map((q) =>
    q.question.id === NARROW_Q
      ? { ...q, status: 'city_confirmed', choice, by: 'hypothetical', role: 'hypothetical', at: null, reference: { text: 'hypothetical outcome', date: '', who: '' } }
      : q,
  );
  return { ...ctx, rs: { ...ctx.rs, questions } };
}

export function unlockSearch(ctx: EvalContext, base: Scenario): { baseline: LotResult; options: UnlockOption[]; recommended: UnlockOption | null } {
  const baseline = evaluate(ctx, base);
  const pin = base.pins[0];
  const opts: Omit<UnlockOption, 'rank' | 'discretionary' | 'discretionary_possible' | 'fits' | 'homes' | 'ownership_rank'>[] = [];
  const mk = (type: TemplateId, pins: string[], extra: Partial<Scenario> = {}): Scenario => ({
    type,
    pins,
    proposal: type === base.type ? base.proposal : proposalFor(type),
    ...extra,
  });

  // Lever 1: building type on the lot alone.
  if (base.pins.length === 1) {
    for (const t of ['detached', 'two'] as TemplateId[]) {
      if (t === base.type) continue;
      const s = mk(t, [pin]);
      opts.push({ id: `type:${t}`, lever: 'type', label: `${TEMPLATES[t].name} on ${lotLabel(ctx, [pin])} alone`, scenario: s, result: evaluate(ctx, s), hypothetical: null, pending: false, change_size: 1 });
    }
  }
  // Lever 2: combine with 1–2 adjacent lots.
  for (const g of candidateGroups(ctx, pin)) {
    const types: TemplateId[] = g.length === 2 ? ['two', 'three', 'row'] : ['three', 'row'];
    for (const t of types) {
      const s = mk(t, g);
      if (t === base.type && g.join('+') === base.pins.join('+')) continue;
      const r = evaluate(ctx, s);
      opts.push({ id: `combine:${t}:${g.join('+')}`, lever: 'combine', label: `${TEMPLATES[t].name}${t === 'row' ? ` ×${g.length}` : ''} on ${lotLabel(ctx, g)}`, scenario: s, result: r, hypothetical: null, pending: false, change_size: 1 + g.length });
      // Lever 3: resolve a pencil interpretation (show both outcomes).
      if (t === 'row' && r.questions.some((q) => q.id === NARROW_Q)) {
        for (const choice of ['yes', 'no'] as const) {
          const rr = evaluate(withQuestion(ctx, choice), s);
          opts.push({
            id: `interp:${choice}:${g.join('+')}`,
            lever: 'interpretation',
            label: `Rowhouses ×${g.length} on ${lotLabel(ctx, g)}, if the City says ${choice === 'yes' ? '"single-unit house" includes attached houses' : 'it does not'}`,
            scenario: s,
            result: rr,
            hypothetical: `if the Zoning Administrator answers ${choice}`,
            pending: false,
            change_size: 1 + g.length,
          });
        }
      }
    }
  }
  // Lever 4: a pending policy (labeled pending).
  if (baseline.checks.some((c) => c.id === 'parking' && c.approvals.length)) {
    const s = { ...base, pending_parking_repeal: true };
    opts.push({ id: 'pending:parking', lever: 'pending_policy', label: 'If Bill 2025-1545 passes (pending): no parking minimum', scenario: s, result: evaluate(ctx, s), hypothetical: 'pending in Council', pending: true, change_size: 1 });
  }
  // Lever 5: variance. Always available; always costs the most.
  opts.push({ id: 'variance', lever: 'variance', label: baseline.relief.length ? `Ask for a variance: ${baseline.relief.map((r) => r.text).join('; ')}` : 'Ask for a variance', scenario: base, result: baseline, hypothetical: null, pending: false, change_size: 0 });

  const scored = opts.map((o) => {
    const r = o.result;
    const refused = r.state !== 'ok';
    const disc = refused ? 99 : r.approvals.ink.filter((a) => DISCRETIONARY.includes(a.kind)).length;
    const discP = refused ? 99 : disc + r.approvals.pencil.filter((a) => DISCRETIONARY.includes(a.kind)).length;
    const fits = !refused && ['width', 'depth', 'area', 'height'].every((id) => r.checks.find((c) => c.id === id)?.status === 'pass');
    return { ...o, homes: homesOf(r), fits, discretionary: o.lever === 'variance' ? Math.max(1, disc) : disc, discretionary_possible: discP, ownership_rank: ownershipRank(ctx, o.scenario.pins) };
  });
  scored.sort(
    (a, b) =>
      a.discretionary - b.discretionary ||
      (a.fits ? 0 : 1) - (b.fits ? 0 : 1) ||
      a.ownership_rank - b.ownership_rank ||
      a.change_size - b.change_size ||
      (a.hypothetical ? 1 : 0) - (b.hypothetical ? 1 : 0) ||
      b.homes - a.homes ||
      a.id.localeCompare(b.id),
  );
  const options = scored.map((o, i) => ({ ...o, rank: i + 1 }));
  const baseHomes = homesOf(baseline);
  // Headline recommendation: the best-ranked option that fits, needs no certain discretionary approval,
  // isn't hypothetical or pending, and keeps at least the proposal's number of homes.
  const recommended =
    options.find((o) => o.fits && o.discretionary === 0 && !o.hypothetical && !o.pending && o.homes >= baseHomes && o.result.trust !== 'red') ?? null;
  return { baseline, options, recommended };
}
