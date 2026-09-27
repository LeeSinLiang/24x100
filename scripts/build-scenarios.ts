// Rule what-ifs (spec §0.16): which sentence of the code blocks the most City land, and how many City-owned lots
// would a change open? The citywide classifier (engine/src/city.ts, the same code as build-summary.ts) re-runs
// with one override at a time: a clause read differently (WhatIf) or one rule's value changed on the rule set.
// Nothing else changes. Writes data/city/scenarios.json. What-ifs are not the law.
//   npx tsx scripts/build-scenarios.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyCityLot, summarize, type CityClass, type CityLot, type WhatIf } from '../engine/src/city';
import { buildRuleSet, DEFAULT_SETTINGS, type Rule, type TemplateId } from '../engine/src/index';
import { RULE_FILES } from './build-summary';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface Scenario {
  id: 'S1' | 'S2' | 'S3';
  name: string;
  /** The sentence (or cell) that changes, verbatim from the saved code text. */
  section: string;
  quote: string;
  rule: string; // the stored rule that carries it
  source_file: string;
  change: string; // what the what-if does, in words
  /** How the page marks up the quote: the words struck (a substring of the quote) and what replaces them, if anything. */
  strike: string;
  insert: string | null;
  what?: WhatIf;
  /** A value change on stored rules: [district, field, new value]. */
  value?: { district: string; field: string; to: number };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    name: 'Vacant neighbours',
    section: '925.06.C',
    quote: 'If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.',
    rule: 'pgh.contextual_side',
    source_file: 'data/code/ch925.txt',
    change: 'Struck: a side facing a vacant lot may take the contextual minimum (3 ft), as a side facing a built lot may.',
    strike: 'If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.',
    insert: null,
    what: { vacantSidesContextual: true },
  },
  {
    id: 'S2',
    name: 'Narrow-lot side yards for two- and three-unit houses',
    section: '925.06.C',
    quote: 'for any single-unit house on a recorded zoning lot that is less than sixty (60) feet in width, the side yards may be reduced according to the following:',
    rule: 'pgh.narrow_lot_side',
    source_file: 'data/code/ch925.txt',
    change: 'Read as "for any single-, two- or three-unit house": the narrow-lot table (3 ft interior sides at 37 ft and below) applies to them too.',
    strike: 'single-unit house',
    insert: 'single-, two- or three-unit house',
    what: { narrowTableFor: ['two', 'three'] },
  },
  {
    id: 'S3',
    name: 'RM interior side setback 10 → 5 ft',
    section: '903.03.C',
    quote: 'RM Subdistrict | 10 ft.',
    rule: 'rm-m.side_interior',
    source_file: 'data/code/ch903.txt',
    change: 'The RM Subdistrict’s minimum interior side setback, 10 ft, read as 5 ft. A plain dimension change, for comparison.',
    strike: '10 ft.',
    insert: '5 ft.',
    value: { district: 'RM-M', field: 'side_setback_interior', to: 5 },
  },
];
export const TYPES: TemplateId[] = ['two', 'three'];

/** Dimensionally fits: past the grey checks, permitted, and no area, width or depth failure (sale status aside). */
export const fitsDim = (c: CityClass) => !['rules', 'records', 'edges', 'use'].includes(c.blocker) && !c.all.some((b) => b === 'area' || b === 'width' || b === 'depth');

export function loadInputs() {
  const lots: CityLot[] = J('data/city/lots.json').lots;
  const rules: Rule[] = RULE_FILES.flatMap((f) => (f.includes('/base/') ? J(f) : J(f).rules ?? []));
  const questions = J('data/rules/questions.json');
  let reviews: unknown[] = [];
  try {
    const r = J('data/rules/reviews.json');
    reviews = Array.isArray(r) ? r : r.entries ?? [];
  } catch {
    /* no published reviews */
  }
  return { lots, rules, questions, reviews };
}

type Inputs = ReturnType<typeof loadInputs>;

/** Classify every lot for one type under one scenario (null: today). */
export function classifyAll(inp: Inputs, type: TemplateId, sc: Scenario | null): CityClass[] {
  const rules = sc?.value ? inp.rules.map((r) => (r.district === sc.value!.district && r.field === sc.value!.field ? { ...r, value: sc.value!.to } : r)) : inp.rules;
  const rsBy = new Map<string, ReturnType<typeof buildRuleSet>>();
  const rsFor = (z: string) => rsBy.get(z) ?? (rsBy.set(z, buildRuleSet(z, rules, inp.questions, inp.reviews as never)), rsBy.get(z)!);
  return inp.lots.map((l) => classifyCityLot(l, l.zone ? rsFor(l.zone) : null, type, DEFAULT_SETTINGS, undefined, sc?.what ?? {}));
}

export function build(inp: Inputs = loadInputs()) {
  const base = new Map(TYPES.map((t) => [t, classifyAll(inp, t, null)]));
  const today = Object.fromEntries(TYPES.map((t) => [t, summarize(inp.lots, base.get(t)!, t)]));
  const out = SCENARIOS.map((sc) => {
    const text = norm(readFileSync(sc.source_file, 'utf8'));
    if (!text.includes(norm(sc.quote))) throw new Error(`${sc.id}: the quote is not verbatim in ${sc.source_file}`);
    if (!sc.quote.includes(sc.strike)) throw new Error(`${sc.id}: the struck words are not in the quote`);
    const by_type = Object.fromEntries(
      TYPES.map((t) => {
        const was = base.get(t)!;
        const now = classifyAll(inp, t, sc);
        const idx = inp.lots.map((_, i) => i).filter((i) => !fitsDim(was[i]) && fitsDim(now[i]));
        const hoods = new Map<string, number>();
        for (const i of idx) hoods.set(inp.lots[i].hood, (hoods.get(inp.lots[i].hood) ?? 0) + 1);
        const districts = new Map<string, number>();
        for (const i of idx) districts.set(inp.lots[i].zone ?? '—', (districts.get(inp.lots[i].zone ?? '—') ?? 0) + 1);
        return [
          t,
          {
            opens: idx.length,
            for_sale: idx.filter((i) => inp.lots[i].status === 'Available for Sale').length,
            pencil: idx.filter((i) => now[i].trust !== 'ink').length, // still pencil under the what-if (e.g. §925.06.C.1, mapped frontage)
            was_width: idx.filter((i) => was[i].all.includes('width')).length,
            by_hood: [...hoods.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5),
            by_district: [...districts.entries()].sort((a, b) => b[1] - a[1]),
            pins: idx.map((i) => inp.lots[i].pin).sort(),
          },
        ];
      }),
    );
    const { what, value, ...meta } = sc;
    return { ...meta, override: what ?? value, by_type };
  });
  return {
    meta: {
      note: 'What-ifs, not the law: each scenario reads one clause differently or changes one value, with everything else as today; a rule change needs City Council. Opens = City-owned vacant lots that do not fit the dimensional rules today and would under the scenario (sale status aside). Only districts whose rules are checked are computed.',
      districts: today.two.districts.filter((d) => d.computed).map((d) => d.zone),
      today: Object.fromEntries(TYPES.map((t) => [t, { width_not_area: today[t].widthNotArea, fits: inp.lots.filter((_, i) => fitsDim(base.get(t)![i])).length }])),
      written_by: 'scripts/build-scenarios.ts',
    },
    scenarios: out,
  };
}

if (process.argv[1]?.endsWith('build-scenarios.ts')) {
  const f = build();
  writeFileSync('data/city/scenarios.json', JSON.stringify(f) + '\n');
  console.log('today:', JSON.stringify(f.meta.today), 'districts:', f.meta.districts.join(', '));
  for (const s of f.scenarios)
    for (const t of TYPES) {
      const x = (s.by_type as Record<string, { opens: number; for_sale: number; pencil: number; by_hood: [string, number][]; by_district: [string, number][] }>)[t];
      console.log(`${s.id} ${t}: opens ${x.opens} (${x.for_sale} for sale, ${x.pencil} pencil); ${x.by_district.map(([d, n]) => `${d} ${n}`).join(', ')}; top: ${x.by_hood.map(([h, n]) => `${h} ${n}`).join(', ')}`);
    }
}
