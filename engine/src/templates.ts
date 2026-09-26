// Building templates and settings. Every value here is RED: the user's proposal or preference,
// editable in the UI, never a fact about the lot.
import type { ApprovalKind, Proposal, Settings, TemplateId } from './types';

export interface Template {
  id: TemplateId;
  name: string;
  short: string;
  single_unit: boolean; // "single-unit house" in §925.06 (detached: yes; row units: the open question)
  proposal: Proposal;
  multi_lot: boolean; // normally built across a group of lots
}

export const TEMPLATES: Record<TemplateId, Template> = {
  detached: {
    id: 'detached',
    name: 'Detached house',
    short: 'Detached',
    single_unit: true,
    multi_lot: false,
    proposal: { width: 16, depth: 36, stories: 2, height: 28, units: 1, home_sqft: 1152 },
  },
  two: {
    id: 'two',
    name: 'Two-unit house',
    short: 'Two-unit',
    single_unit: false,
    multi_lot: false,
    proposal: { width: 16, depth: 45, stories: 3, height: 36, units: 2, home_sqft: 1080 },
  },
  row: {
    id: 'row',
    name: 'Rowhouses',
    short: 'Rowhouses',
    single_unit: false,
    multi_lot: true,
    proposal: { width: 16, depth: 40, stories: 2, height: 28, units: 3, home_sqft: 1280 },
  },
  three: {
    id: 'three',
    name: 'Three-unit house',
    short: 'Three-unit',
    single_unit: false,
    multi_lot: true,
    proposal: { width: 30, depth: 45, stories: 3, height: 36, units: 3, home_sqft: 1350 },
  },
};

export const APPROVAL_LABEL: Record<ApprovalKind, string> = {
  variance: 'Variance (Zoning Board of Adjustment)',
  grading_review: 'Grading review',
  administrator_exception: 'Administrator exception',
  city_public_sale: 'City public sale',
  other_owner: 'Buy from another owner',
  parking_relief: 'Parking relief',
};

export const DISCRETIONARY: ApprovalKind[] = ['variance', 'grading_review', 'administrator_exception', 'parking_relief'];

export const DEFAULT_SETTINGS: Settings = {
  recon_tolerance: 0.1,
  weights: {
    variance: 35,
    grading_review: 20,
    administrator_exception: 10,
    city_public_sale: 5,
    other_owner: 15,
    parking_relief: 10,
  },
  slope_flag_threshold: 0.05,
  min_rowhouse_unit_width: 16,
};

/** Finished floor area per home implied by a proposal (red). */
export function homeSqft(p: Proposal, type: TemplateId): number {
  if (type === 'row') return Math.round(p.width * p.depth * p.stories);
  return Math.round((p.width * p.depth * p.stories) / Math.max(1, p.units));
}

export function proposalFor(type: TemplateId, overrides: Partial<Proposal> = {}): Proposal {
  const base = { ...TEMPLATES[type].proposal, ...overrides };
  if (overrides.home_sqft === undefined) base.home_sqft = homeSqft(base, type);
  return base;
}
