// Static data shipped with the app. Everything here was produced by the pipeline or the rule store;
// nothing is typed in by the interface.
import { withQuoteStatus } from '@engine/rules';
import { checkQuote } from '@engine/source';
import type { Assumption, BlockFile, Comps, Hud, Question, Rule } from '@engine/types';

const blockFiles = import.meta.glob('../../../data/blocks/*.json', { eager: true, import: 'default' }) as Record<string, BlockFile>;
const baseRuleFiles = import.meta.glob('../../../data/rules/base/*.json', { eager: true, import: 'default' }) as Record<string, Rule[]>;
const extractedFiles = import.meta.glob('../../../data/rules/extracted/*.json', { eager: true, import: 'default' }) as Record<string, { meta?: Record<string, unknown>; rules?: Rule[] }>;
const questionFiles = import.meta.glob('../../../data/rules/questions.json', { eager: true, import: 'default' }) as Record<string, Question[]>;
const reviewFiles = import.meta.glob('../../../data/rules/reviews.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const moneyFiles = import.meta.glob('../../../data/money/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const assumptionFiles = import.meta.glob('../../../data/assumptions.json', { eager: true, import: 'default' }) as Record<string, Assumption[]>;
export const codeText = import.meta.glob('../../../data/code/*.txt', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const base = (p: string) => p.split('/').pop()!.replace(/\.json$/, '');

export const BLOCKS: Record<string, BlockFile> = Object.fromEntries(
  Object.entries(blockFiles)
    .filter(([p]) => !p.includes('crosscheck'))
    .map(([p, b]) => [base(p), b]),
);

export const EXTRACTED = Object.fromEntries(Object.entries(extractedFiles).map(([p, f]) => [base(p), f]));

export const RULES: Rule[] = withQuoteStatus(
  [...Object.values(baseRuleFiles).flat(), ...Object.values(extractedFiles).flatMap((f) => f.rules ?? [])],
  (file) => codeText[`../../../data/code/${file.split('/').pop()}`] ?? null,
  checkQuote,
);

export const QUESTIONS: Question[] = Object.values(questionFiles).flat();

export const SEED_REVIEWS: unknown = Object.values(reviewFiles)[0] ?? [];

export const COMPS_RAW = moneyFiles['../../../data/money/comps_ward5.json'] as
  | (Omit<Comps, 'newest' | 'meta'> & { newest: Comps['newest'][number]; newest_built: Comps['newest']; meta: Record<string, unknown>; sales: { addr: string; price: number; saledate: string; use: string; yearbuilt: number | null; sqft: number | null }[] })
  | undefined;
type CompsRaw = NonNullable<typeof COMPS_RAW>;
function toComps(raw: CompsRaw, ward: number): Comps {
  return {
    ...raw,
    meta: { source: String(raw.meta.source), resource_id: String(raw.meta.resource_id), pulled: String(raw.meta.pulled), filters: JSON.stringify(raw.meta.filters), ward },
    newest: raw.newest_built ?? [raw.newest],
  };
}
/** Comparable sales by ward (data/money/comps_ward<N>.json). */
export const COMPS_BY_WARD: Record<number, Comps> = Object.fromEntries(
  Object.entries(moneyFiles)
    .map(([p, v]) => [p.match(/comps_ward(\d+)\.json$/)?.[1], v] as const)
    .filter(([w]) => w)
    .map(([w, v]) => [Number(w), toComps(v as CompsRaw, Number(w))]),
);
export const COMPS_RAW_BY_WARD: Record<number, CompsRaw> = Object.fromEntries(
  Object.entries(moneyFiles)
    .map(([p, v]) => [p.match(/comps_ward(\d+)\.json$/)?.[1], v] as const)
    .filter(([w]) => w)
    .map(([w, v]) => [Number(w), v as CompsRaw]),
);
export const COMPS: Comps | null = COMPS_BY_WARD[5] ?? null;
export const HUD: Hud | null = (() => {
  const h = moneyFiles['../../../data/money/hud_fy2026.json'] as Record<string, unknown> | undefined;
  if (!h) return null;
  const l80 = Array.isArray(h.l80) ? (h.l80 as number[]) : [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(h[`l80_${i}`]));
  return {
    area_name: String(h.area_name ?? h.hud_area_name ?? 'Pittsburgh, PA HUD Metro FMR Area'),
    median: Number(h.median ?? h.median2026 ?? h.median_family_income),
    l80,
    source_url: String((h.meta as Record<string, unknown>)?.url ?? h.source_url ?? ''),
    pulled: String((h.meta as Record<string, unknown>)?.pulled ?? h.pulled ?? ''),
  };
})();
export const ASSUMPTIONS: Assumption[] = Object.values(assumptionFiles)[0] ?? [];

export function codeFor(sourceFile: string): string | null {
  const name = sourceFile.split('/').pop()!;
  return codeText[`../../../data/code/${name}`] ?? null;
}

export interface RefreshChange {
  pin: string;
  addr: string;
  block: string | null;
  scope: string;
  field: string;
  before: unknown;
  after: unknown;
  kind: 'changed' | 'added' | 'removed';
}
const refreshFiles = import.meta.glob('../../../data/refresh/latest.json', { eager: true, import: 'default' }) as Record<string, { meta?: { run_at?: string }; changes?: RefreshChange[] }>;
export const REFRESH = Object.values(refreshFiles)[0] ?? null;
export function refreshChangesFor(pins: string[]): RefreshChange[] {
  return (REFRESH?.changes ?? []).filter((c) => pins.includes(c.pin));
}

// City-owned lots too narrow while big enough, per building type (scripts/build-summary.ts; build time).
const summaryFiles = import.meta.glob('../../../data/city/summary.json', { eager: true, import: 'default' }) as Record<string, { by_type?: Record<string, { width_not_area: number; districts: string[] }> }>;
export const STUCK: Record<string, { width_not_area: number; districts: string[] } | undefined> = Object.values(summaryFiles)[0]?.by_type ?? {};

// Rule what-ifs (spec §0.16; scripts/build-scenarios.ts, build time): City lots each clause change would open.
export interface WhatIfType {
  opens: number;
  for_sale: number;
  pencil: number;
  was_width: number;
  by_hood: [string, number][];
  by_district: [string, number][];
  pins: string[];
}
export interface WhatIfScenario {
  id: 'S1' | 'S2' | 'S3';
  name: string;
  section: string;
  quote: string;
  rule: string;
  source_file: string;
  change: string;
  strike: string;
  insert: string | null;
  by_type: Partial<Record<string, WhatIfType>>;
}
const scenarioFiles = import.meta.glob('../../../data/city/scenarios.json', { eager: true, import: 'default' }) as Record<string, { meta?: { note: string; districts: string[] }; scenarios?: WhatIfScenario[] }>;
export const WHATIF = Object.values(scenarioFiles)[0] ?? { scenarios: [] };

// Questions the policy agent answered (agents/policy; committed runs, data/policy/q*.json). A counted one has the same
// fields as a rule what-if (quote, strike, insert, by_type) plus the agent's steps and its memo; a refused one keeps the reason.
export interface PolicyStep {
  n: number;
  action: 'plan' | 'tool' | 'draft' | 'verify';
  tool?: string;
  summary: string;
  ok: boolean;
  t: string;
  sources: { file?: string; url?: string; sha256: string }[];
}
export interface PolicyRun {
  id: string;
  status: 'counted' | 'refused';
  question: string;
  building: string;
  name: string;
  reason?: string;
  section?: string;
  quote?: string;
  source_file?: string;
  change?: string;
  strike?: string;
  insert?: string | null;
  by_type?: Partial<Record<string, WhatIfType>>;
  caveats?: string[];
  labels: string[];
  verified?: boolean;
  memo_md?: string;
  steps: PolicyStep[];
  model: { name?: string | null; planned_by: 'model' | 'hand'; note?: string; fallbacks?: { model: string }[]; cost?: { usd: number | null } };
  usage?: { tokens_in: number; tokens_out: number; calls: number };
}
const policyFiles = import.meta.glob('../../../data/policy/q*.json', { eager: true, import: 'default' }) as Record<string, PolicyRun>;
export const POLICY: PolicyRun[] = Object.values(policyFiles).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
/** A rule what-if (S1–S3) or a question the policy agent counted, by id: what the map lights. */
export const whatIfById = (id: string | null): { by_type?: Partial<Record<string, WhatIfType>> } | undefined =>
  id ? ((WHATIF.scenarios ?? []).find((x) => x.id === id) ?? POLICY.find((x) => x.id === id && x.status === 'counted')) : undefined;
