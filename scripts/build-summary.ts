// Citywide counts the lot view needs without loading every lot (spec decision 2, 27 Sep): for each building
// type, the City-owned lots big enough but too narrow ("stuck the same way" by the side setbacks), with the
// districts they were computed in. Written at build time from data/city/lots.json and the committed rules.
//   npx tsx scripts/build-summary.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { classifyCityLot, summarize, type CityLot } from '../engine/src/city';
import { buildRuleSet, DEFAULT_SETTINGS, type TemplateId } from '../engine/src/index';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const lots: CityLot[] = J('data/city/lots.json').lots;
// Every stored rule, as the app loads them (answer key, and every extracted district's proposals).
export const RULE_FILES = [
  ...readdirSync('data/rules/base').map((f) => `data/rules/base/${f}`),
  ...(existsSync('data/rules/extracted') ? readdirSync('data/rules/extracted').filter((f) => f.endsWith('.json') && f !== 'eval.json').map((f) => `data/rules/extracted/${f}`) : []),
];
if (process.argv[1]?.endsWith('build-summary.ts')) {
  const rules = RULE_FILES.flatMap((f) => (f.includes('/base/') ? J(f) : J(f).rules ?? []));
  const questions = J('data/rules/questions.json');
  let reviews: unknown[] = [];
  try {
    const r = J('data/rules/reviews.json');
    reviews = Array.isArray(r) ? r : r.entries ?? [];
  } catch {
    /* no published reviews yet */
  }
  const rsBy = new Map<string, ReturnType<typeof buildRuleSet>>();
  const rsFor = (z: string) => rsBy.get(z) ?? (rsBy.set(z, buildRuleSet(z, rules, questions, reviews as never)), rsBy.get(z)!);
  const by_type: Record<string, { width_not_area: number; ink: number; context: number; mapped: number; districts: string[] }> = {};
  for (const t of ['detached', 'two', 'row', 'three'] as TemplateId[]) {
    const cls = lots.map((l) => classifyCityLot(l, l.zone ? rsFor(l.zone) : null, t, DEFAULT_SETTINGS));
    const s = summarize(lots, cls, t);
    by_type[t] = { width_not_area: s.widthNotArea, ink: s.widthNotAreaInk, context: s.widthNotAreaContext, mapped: s.widthNotAreaMapped, districts: s.districts.filter((d) => d.computed).map((d) => d.zone) };
  }
  writeFileSync('data/city/summary.json', JSON.stringify({ note: 'City-owned lots big enough but too narrow for each building type (engine classifier). Written by scripts/build-summary.ts.', by_type }, null, 1) + '\n');
  console.log('summary:', JSON.stringify(by_type));
}
