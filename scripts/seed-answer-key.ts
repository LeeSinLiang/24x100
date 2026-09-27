// Writes the hand-checked RM‑M answer key (spec §6.3) as pre-seeded, source-checked rules, plus the
// citywide §925.06 rules and the open questions. The values were typed by hand from the saved code
// text; this script refuses to write any rule whose quote isn't word for word inside its section.
// Verification label (spec §0.7): {reviewer:"Claude (research pass)", role:"AI agent"}. The UI asks a
// teammate to re-check every one of them. None is City-confirmed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { checkQuote, locateSection, normalizeWs } from '../engine/src/source';
import type { NarrowRow, Question, Rule } from '../engine/src/types';

const AT = '2026-09-26T16:30:00-04:00';
const V = {
  level: 'source_checked' as const,
  reviewer: 'Claude (research pass)',
  role: 'AI agent',
  at: AT,
  note: 'matched to saved ecode360 text 2026-09-26',
  reference: null,
};
const URL: Record<string, string> = {
  'data/code/ch903.txt': 'https://ecode360.com/45474194',
  'data/code/ch925.txt': 'https://ecode360.com/45479639',
};
const text = (f: string) => readFileSync(f, 'utf8');

function rule(r: Omit<Rule, 'source_url' | 'retrieved' | 'origin' | 'dagger' | 'verification' | 'model' | 'prompt_sha'> & Partial<Rule>): Rule {
  return {
    source_url: URL[r.source_file],
    retrieved: '2026-09-26',
    origin: 'answer_key',
    dagger: false,
    verification: V,
    model: null,
    prompt_sha: null,
    ...r,
  } as Rule;
}

const C903 = 'data/code/ch903.txt';
const C925 = 'data/code/ch925.txt';
const ALL: ('detached' | 'two' | 'row' | 'three' | 'row_end')[] = ['detached', 'two', 'row', 'three', 'row_end'];

// Parse the narrow-lot table in §925.06.C from the saved text (no transcription).
function narrowTable(): NarrowRow[] {
  const t = text(C925);
  const span = locateSection(t, '925.06.C')!;
  const sec = t.slice(span.start, span.end);
  const lead = sec.indexOf('for any single-unit house on a recorded zoning lot');
  const body = normalizeWs(sec.slice(lead));
  const head = 'Required Streetside Setback |';
  const cells = body
    .slice(body.indexOf(head) + head.length)
    .split(' | ')
    .map((c) => c.trim());
  const rows: NarrowRow[] = [];
  for (let k = 0; k + 2 < cells.length; k += 3) {
    const w = cells[k].match(/^(\d+)′?( and below)?$/); // the saved text prints one row as "49" without ′
    const a = cells[k + 1].match(/^(\d+)′$/);
    const b = cells[k + 2].match(/^(\d+)′/);
    if (!w || !a || !b) break;
    rows.push({ max_width: Number(w[1]), interior: Number(a[1]), streetside: Number(b[1]) });
    if (w[2]) break; // "37′ and below" is the last row
  }
  if (!rows.length || rows[rows.length - 1].max_width !== 37) throw new Error('narrow-lot table not parsed');
  return rows;
}

const rmm: Rule[] = [
  rule({
    id: 'rm-m.min_lot_area', district: 'RM-M', field: 'min_lot_area', value: 2400, unit: 'sf', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'Moderate Density Subdistrict | Minimum Lot Size | 2,400 s.f.', source_file: C903, question_for_city: null,
    enacted: { ordinance: 'Ord. No. 10-2025', effective: '5-7-2025', quote: 'Ord. No. 10-2025, eff. 5-7-2025' },
  }),
  rule({
    id: 'rm-m.front', district: 'RM-M', field: 'front_setback', value: 25, unit: 'ft', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft.', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.rear', district: 'RM-M', field: 'rear_setback', value: 25, unit: 'ft', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'Minimum Rear Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft.', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.side_exterior', district: 'RM-M', field: 'side_setback_exterior', value: 25, unit: 'ft', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'Minimum Exterior Sideyard Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft.', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.side_interior', district: 'RM-M', field: 'side_setback_interior', value: 10, unit: 'ft', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'Minimum Interior Sideyard Setback | | R1D, R2 & R3 Subdistricts | 5 ft. | R1A Subdistrict | 5 ft. | RM Subdistrict | 10 ft.', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.max_height', district: 'RM-M', field: 'max_height_ft', value: 55, unit: 'ft', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'RM Subdistrict | 55 ft. (not to exceed 4 stories)', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.max_stories', district: 'RM-M', field: 'max_stories', value: 4, unit: 'stories', applies_to: ['*'], condition: null,
    section: '903.03.C', quote: 'RM Subdistrict | 55 ft. (not to exceed 4 stories)', source_file: C903, question_for_city: null,
  }),
  rule({
    id: 'rm-m.party_wall', district: 'RM-M', field: 'party_wall_side', value: 0, unit: 'ft', applies_to: ['row', 'row_end'], condition: 'attached dwellings on separate lots',
    section: '903.03.C.2(c)',
    quote: 'When a dwelling is "attached" to one (1) or more separate dwelling units on separate lots by a party wall or separate abutting wall the required interior sideyard setback shall be zero on the abutting or party wall side.',
    source_file: C903, question_for_city: null,
  }),
];

const pgh: Rule[] = [
  rule({
    id: 'pgh.contextual_side', district: '*', field: 'contextual_side', value: 3, unit: 'ft', applies_to: ALL,
    condition: 'Only next to a built lot oriented to the same street; not below 3 ft. If lots on either side are vacant, the district setback applies.',
    section: '925.06.C',
    quote:
      'A Contextual Side Setback may fall at any point between the required side setback and the side setback that exists on a lot that is adjacent and oriented to the same street as the subject lot, but shall be a minimum of three (3) feet. If the subject lot is a corner lot, the Contextual Side Setback may fall at any point between the required side setback required by the zoning district and the side setback that exists on the lot that is adjacent and oriented to the same street as the subject lot, but shall be a minimum of three (3) feet. If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.',
    source_file: C925, question_for_city: null,
  }),
  rule({
    id: 'pgh.contextual_rear', district: '*', field: 'contextual_rear', value: null, unit: 'ft', applies_to: ALL,
    condition: 'Only next to built lots oriented to the same street. If lots on either side are vacant, the district setback applies.',
    section: '925.06.I', quote: 'If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.', source_file: C925, question_for_city: null,
  }),
  rule({
    id: 'pgh.narrow_lot_side', district: '*', field: 'narrow_lot_side_table', value: narrowTable(), unit: 'table', applies_to: ['detached'],
    condition: 'Single-unit house on a recorded zoning lot under 60 ft wide. Whether this includes single-unit attached houses is an open question.',
    section: '925.06.C',
    quote: 'Regardless of the setbacks of adjacent structures, for any single-unit house on a recorded zoning lot that is less than sixty (60) feet in width, the side yards may be reduced according to the following:',
    source_file: C925, question_for_city: null,
  }),
];

const questions: Question[] = [
  {
    id: 'q.single_unit_includes_attached',
    district: '*',
    section: '925.06.C',
    quote: 'for any single-unit house on a recorded zoning lot that is less than sixty (60) feet in width, the side yards may be reduced',
    source_file: C925,
    question:
      'Does "single-unit house" in the narrow-lot side-yard provision of §925.06.C include single-unit attached houses (rowhouses)? On a 24 ft lot it changes an end unit from 14 ft to 21 ft wide.',
    ask: 'Zoning Administrator',
    affects: ['pgh.narrow_lot_side'],
    yes: { extends_applies_to: ['row_end'] },
    no: {},
  },
  {
    id: 'q.narrow_both_sides_3ft',
    district: '*',
    section: '925.06.C.1',
    quote: "The applicant may reduce the side setback to three (3) feet on both sides only if adjacent properties have setbacks of three (3) feet or less on the sides abutting the applicant's property.",
    source_file: C925,
    question:
      'Can a single-unit house on a narrow lot use the narrow-lot table\'s 3 ft side yard on both sides when a neighbouring lot is vacant or its setback is unknown? §925.06.C.1 allows 3 ft on both sides only if adjacent properties have setbacks of 3 ft or less. If not, which setback applies on the other side? (We read it as the district setback.)',
    ask: 'Zoning Administrator',
    affects: ['pgh.narrow_lot_side'],
    yes: {},
    no: {},
  },
];

let bad = 0;
for (const r of [...rmm, ...pgh]) {
  const c = checkQuote(text(r.source_file), r.section, r.quote);
  if (!c.ok) {
    console.error(`✗ ${r.id}: ${c.reason}`);
    bad++;
  }
  if (r.enacted && !normalizeWs(text(r.source_file)).includes(r.enacted.quote)) {
    console.error(`✗ ${r.id}: enacted quote not found`);
    bad++;
  }
}
for (const q of questions) {
  const c = checkQuote(text(q.source_file), q.section, q.quote);
  if (!c.ok) {
    console.error(`✗ ${q.id}: ${c.reason}`);
    bad++;
  }
}
if (bad) process.exit(1);
mkdirSync('data/rules/base', { recursive: true });
writeFileSync('data/rules/base/rm-m.json', JSON.stringify(rmm, null, 1) + '\n');
writeFileSync('data/rules/base/pgh.json', JSON.stringify(pgh, null, 1) + '\n');
writeFileSync('data/rules/questions.json', JSON.stringify(questions, null, 1) + '\n');
console.log(`wrote ${rmm.length} RM-M rules, ${pgh.length} citywide rules, ${questions.length} question(s); every quote verified in its section`);
console.log('narrow-lot rows:', narrowTable().length, 'last:', JSON.stringify(narrowTable().slice(-1)[0]));
