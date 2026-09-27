// Development Ease (Track 1's "Development Ease Score", Sin's call on 27 Sep over spec §0.12 C1): a range out of 100,
// never a lone number, built from six parts a person can check. It starts at 100; a known step (a variance, a City sale,
// a subsidy gap) takes its weight off both ends; an unknown (water and sewer, unpriced steep ground, an open approval)
// takes its weight off the bottom end only. So an unknown widens the range downward, and a lot that is mostly unknown
// says "can't score yet" rather than a hopeful number. The weights are our assumptions, shown with the result.
import type { CityClass, CityLot } from './city';
import type { Approval, ApprovalKind, CheckId, LotResult, MoneyResult, Parcel, Settings } from './types';

export type EaseState = 'clear' | 'blocks' | 'unknown';
export type EaseId = 'zoning' | 'approvals' | 'ownership' | 'site' | 'infrastructure' | 'money';
export interface EasePart {
  id: EaseId;
  label: string;
  state: EaseState;
  minus: [number, number]; // taken off the top end, and off the bottom end
  words: string;
  source: string; // where the part comes from, or who to ask
}
export interface Ease {
  scored: boolean;
  lo: number;
  hi: number;
  parts: EasePart[];
  unknowns: number;
  formula: string;
  why: string | null; // why it can't be scored
}

/** Our assumptions, beside the approval weights in DEFAULT_SETTINGS.weights (templates.ts). */
export const EASE_WEIGHTS = {
  steep: 15, // share of the lot in the City's 25%+ slope layer at or above the flag threshold: grading and walls unpriced
  mines: 20, // any overlap with the City's mapped undermined areas: a subsidence or geotechnical question
  infrastructure: 20, // water and sewer: not modelled; ask PWSA and ALCOSAN
  money: 20, // a subsidy gap at full cost, before land
  unassessed_approvals: 20, // approvals the map can't see (parking, grading) on a lot without block detail
};
// Water and sewer is unknown for every lot (nothing here models it), so "mostly unknown" is counted over the other five:
// four or more of those five unknown and the lot can't be scored yet.
const MAX_UNKNOWN_ASSESSABLE = 3;

export const EASE_IDS: EaseId[] = ['zoning', 'approvals', 'ownership', 'site', 'infrastructure', 'money'];
export const EASE_LABEL: Record<EaseId, string> = {
  zoning: 'Zoning fit',
  approvals: 'Approvals needed',
  ownership: 'Ownership and assembly',
  site: 'Site (slope, mapped mines)',
  infrastructure: 'Water and sewer',
  money: 'Money at full cost',
};
const ZONING: ApprovalKind[] = ['variance', 'use_variance'];
const OTHER: ApprovalKind[] = ['special_exception', 'administrator_exception', 'grading_review', 'parking_relief'];
const OWNERSHIP: ApprovalKind[] = ['city_public_sale', 'other_owner', 'lot_consolidation'];
const DIMENSIONS: CheckId[] = ['width', 'depth', 'area'];

const sum = (as: Approval[]) => as.reduce((s, a) => s + a.weight, 0);
// The lot card's short money (web kFmt): one decimal under $100k, so the parts read as the sentence does ($57.2k, $150k).
const k = (n: number) => {
  const v = Math.abs(n) >= 100_000 ? Math.round(n / 1000) : Math.round(n / 100) / 10;
  return `$${v.toLocaleString('en-US')}k`;
};

function part(id: EaseId, state: EaseState, minus: [number, number], words: string, source: string): EasePart {
  return { id, label: EASE_LABEL[id], state, minus, words, source };
}

function fromApprovals(id: EaseId, kinds: ApprovalKind[], ink: Approval[], pencil: Approval[], clearWords: string, source: string, blocksIfInk = true): EasePart {
  const i = ink.filter((a) => kinds.includes(a.kind));
  const p = pencil.filter((a) => kinds.includes(a.kind));
  const names = (as: Approval[]) => as.map((a) => `${a.label.replace(/\s*\(.*$/, '')} (−${a.weight})`).join(', ');
  if (!i.length && !p.length) return part(id, 'clear', [0, 0], clearWords, source);
  const state: EaseState = i.length ? (blocksIfInk ? 'blocks' : 'clear') : 'unknown';
  const words = [i.length ? names(i) : '', p.length ? `open: ${names(p)}` : ''].filter(Boolean).join('; ');
  return part(id, state, [sum(i), sum(i) + sum(p)], words, source);
}

function site(slope: number, mines: number, threshold: number): EasePart {
  const steep = slope >= threshold;
  const pct = (x: number) => `${Math.max(1, Math.round(x * 100))}%`;
  const words = [
    slope > 0 ? `${pct(slope)} of lot mapped ≥25% slope${steep ? ': grading and walls unpriced' : ''}` : 'none of the lot in the 25%+ slope layer',
    mines > 0 ? `${pct(mines)} overlaps mapped mines: a subsidence question` : 'no overlap with mapped mines',
  ].join('; ');
  const minus: [number, number] = [0, (steep ? EASE_WEIGHTS.steep : 0) + (mines > 0 ? EASE_WEIGHTS.mines : 0)];
  return part('site', minus[1] ? 'unknown' : 'clear', minus, words, "City layers (25%+ slope, undermined areas); a geotechnical report or a mine subsidence inspection settles it");
}

const INFRA = part('infrastructure', 'unknown', [0, EASE_WEIGHTS.infrastructure], 'not modelled: service, capacity and connection cost unknown', 'ask PWSA (water, sewer laterals) and ALCOSAN');

function money(m: MoneyResult | null, why: string): EasePart {
  const src = 'the money screen: building × (1 + soft costs + financing) + site work − the newest new-build sale, per home, before land';
  if (!m || m.money_verdict === 'no_new_build' || !m.gap) return part('money', 'unknown', [0, EASE_WEIGHTS.money], `not assessed: ${why}`, 'a builder’s price and a sale comparison for this ward');
  const by = m.quote ? 'at your quote' : "at the practitioner's estimate";
  if (m.money_verdict === 'only_with_subsidy') return part('money', 'blocks', [EASE_WEIGHTS.money, EASE_WEIGHTS.money], `needs ${k(m.gap.lo)}–${k(m.gap.hi)} a home of subsidy (${by})`, src);
  if (m.money_verdict === 'depends_on_builder') return part('money', 'unknown', [0, EASE_WEIGHTS.money], `gap from nothing to ${k(m.gap.hi)} a home: a builder's price decides (${by})`, src);
  return part('money', 'clear', [0, 0], `the sale covers full cost (${by})`, src);
}

function total(parts: EasePart[], cantWhy: string | null): Ease {
  const top = parts.reduce((s, p) => s + p.minus[0], 0);
  const bottom = parts.reduce((s, p) => s + p.minus[1], 0);
  const hi = Math.max(0, 100 - top);
  const lo = Math.max(0, 100 - bottom);
  const unknowns = parts.filter((p) => p.state === 'unknown').length;
  const assessable = parts.filter((p) => p.id !== 'infrastructure');
  const unknownAssessable = assessable.filter((p) => p.state === 'unknown').length;
  const known = parts.filter((p) => p.minus[0]).map((p) => ` − ${p.minus[0]} ${p.id}`).join('');
  const open = parts.filter((p) => p.minus[1] > p.minus[0]).map((p) => ` − ${p.minus[1] - p.minus[0]} ${p.id}`).join('');
  const formula = `100${known} = ${hi} at best${open ? `; unknowns${open} = ${lo} at worst` : ''}`;
  const why = cantWhy ?? (unknownAssessable > MAX_UNKNOWN_ASSESSABLE ? `${unknownAssessable} of the ${assessable.length} parts we can assess are unknown` : null);
  return { scored: !why, lo, hi, parts, unknowns, formula, why };
}

/** A lot or lot group with block detail, read by the lot engine. */
export function easeForLot(r: LotResult, m: MoneyResult | null, parcels: Parcel[], settings: Settings, moneyWhy = 'no money data'): Ease {
  const ink = r.approvals.ink;
  const pencil = r.approvals.pencil;
  const slope = Math.max(0, ...parcels.map((p) => p.slope25 ?? 0));
  const mines = Math.max(0, ...parcels.map((p) => p.undermined ?? 0));
  const refused = r.state !== 'ok';
  const zoning = refused
    ? part('zoning', 'unknown', [0, settings.weights.variance], `can't tell: ${r.refusal?.reason ?? 'not scored'}`, 'settle the records or load the rules first')
    : fromApprovals('zoning', ZONING, ink, pencil, 'fits as of right on dimensions and use', `the zoning code (${r.district}), as signed`);
  // A fit that rests on pencil (no deed dimensions, an open reading) or on your own assumption (red) isn't established:
  // the zoning part is unknown, not clear, so an unchecked fit never reads as an easy lot.
  const soft = refused || zoning.state !== 'clear' ? [] : r.checks.filter((c) => DIMENSIONS.includes(c.id) && c.status !== 'fail' && c.trust !== 'ink');
  const zoningPart = soft.length
    ? part(
        'zoning',
        'unknown',
        [0, settings.weights.variance],
        `fits on paper, not yet established (${soft.map((c) => `${c.label.toLowerCase()}: ${c.trust === 'red' ? 'your assumption' : 'pencil'}`).join('; ')})`,
        `the zoning code (${r.district}); ${soft.some((c) => c.trust === 'red') ? 'the City confirms an assumption' : 'deed dimensions, a survey or the Zoning Administrator settle it'}`,
      )
    : zoning;
  const parts = [
    zoningPart,
    fromApprovals('approvals', OTHER, ink, pencil, 'no other approval found', 'the zoning code; the Zoning Administrator settles open readings'),
    fromApprovals('ownership', OWNERSHIP, ink, pencil, 'no purchase step', 'City-Owned Properties and County assessment (owner type only)', false),
    site(slope, mines, settings.slope_flag_threshold),
    INFRA,
    money(m, moneyWhy),
  ];
  // Needing a lot another owner holds is a real hurdle, not a routine step.
  const own = parts[2];
  if (ink.some((a) => a.kind === 'other_owner')) own.state = 'blocks';
  return total(parts, refused ? `the lot can't be scored: ${r.refusal?.reason ?? 'refused'}` : null);
}

/** Any City lot, read by the citywide classifier (no block detail: no plan, no money screen, no parking or grading). */
export function easeForCity(c: CityClass, l: CityLot, settings: Settings): Ease {
  const b = c.blocker;
  if (b === 'rules' || b === 'records' || b === 'edges')
    return total([part('zoning', 'unknown', [0, settings.weights.variance], c.note, 'the zoning code')], `can't be scored from the map: ${c.note}`);
  // The citywide reading's trust (city.ts): pencil without deed dimensions, when a built neighbour's setback could change
  // the width, when the records fall on both sides of the minimum, or on rules a model read. A pencil fit or a pencil
  // shortfall is unknown, not clear and not a known variance.
  const dimTrust = b === 'width' ? c.widthTrust : b === 'area' ? c.areaTrust : c.trust;
  const mapped = !l.deed; // no deed dimensions: the mapped frontage and area, pencil
  const why = (c.widthTrust !== 'ink' ? c.widthNote : null) ?? (c.areaTrust !== 'ink' ? c.note : null);
  const settle = mapped ? 'deed dimensions or a survey settle it' : (why ?? 'rules a model read, not yet checked by a person');
  const w = b === 'width' && c.formula ? `too narrow, ${c.formula} ft` : `the lot's ${b}`;
  const zoning =
    b === 'use'
      ? part('zoning', 'blocks', [settings.weights.use_variance, settings.weights.use_variance], c.note, `the use table (${l.zone})`)
      : b === 'width' || b === 'area' || b === 'depth'
        ? dimTrust === 'ink'
          ? part('zoning', 'blocks', [settings.weights.variance, settings.weights.variance], `a variance: ${w}`, `the zoning code (${l.zone}), as signed`)
          : part('zoning', 'unknown', [0, settings.weights.variance], `may need a variance (pencil): ${w}; ${settle}`, `the zoning code (${l.zone}); ${mapped ? 'a deed or survey' : 'the Zoning Administrator'} settles it`)
        : c.trust === 'ink'
          ? part('zoning', 'clear', [0, 0], `fits as of right${c.formula ? `: ${c.formula} ft` : ''}`, `the zoning code (${l.zone}), as signed`)
          : part(
              'zoning',
              'unknown',
              [0, settings.weights.variance],
              mapped ? `fits on the mapped lines (pencil)${c.formula ? `: ${c.formula} ft` : ''}; deed dimensions or a survey settle it` : `fits on paper (pencil)${c.formula ? `: ${c.formula} ft` : ''}; ${settle}`,
              `the zoning code (${l.zone}); ${mapped ? 'a deed or survey' : 'the Zoning Administrator'} settles it`,
            );
  const forSale = l.status === 'Available for Sale';
  const parts = [
    zoning,
    part('approvals', 'unknown', [0, EASE_WEIGHTS.unassessed_approvals], 'parking and grading not assessed from the map', 'open the lot, or ask the Zoning Administrator'),
    part('ownership', 'clear', [settings.weights.city_public_sale, settings.weights.city_public_sale], forSale ? 'City-owned, listed for sale (−5)' : 'City-owned, not listed: ask City Real Estate (−5)', 'City-Owned Properties'),
    site(l.slope25 ?? 0, l.undermined ?? 0, settings.slope_flag_threshold),
    INFRA,
    part('money', 'unknown', [0, EASE_WEIGHTS.money], 'money not modelled for map-only lots (no plan yet)', 'open a lot with block detail for its plan and money screen'),
  ];
  return total(parts, null);
}
