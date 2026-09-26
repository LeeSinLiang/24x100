// Static data shipped with the app. Everything here was produced by the pipeline or the rule store;
// nothing is typed in by the interface.
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

export const RULES: Rule[] = [
  ...Object.values(baseRuleFiles).flat(),
  ...Object.values(extractedFiles).flatMap((f) => f.rules ?? []),
];

export const QUESTIONS: Question[] = Object.values(questionFiles).flat();

export const SEED_REVIEWS: unknown = Object.values(reviewFiles)[0] ?? [];

export const COMPS_RAW = moneyFiles['../../../data/money/comps_ward5.json'] as
  | (Omit<Comps, 'newest' | 'meta'> & { newest: Comps['newest'][number]; newest_built: Comps['newest']; meta: Record<string, unknown>; sales: { addr: string; price: number; saledate: string; use: string; yearbuilt: number | null; sqft: number | null }[] })
  | undefined;
export const COMPS: Comps | null = COMPS_RAW
  ? {
      ...COMPS_RAW,
      meta: { source: String(COMPS_RAW.meta.source), resource_id: String(COMPS_RAW.meta.resource_id), pulled: String(COMPS_RAW.meta.pulled), filters: JSON.stringify(COMPS_RAW.meta.filters), ward: 5 },
      newest: COMPS_RAW.newest_built ?? [COMPS_RAW.newest],
    }
  : null;
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
