// The inquiry: one letter per office; facts from the engine only; every number traced; red never reads as ink.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildInquiry,
  buildRuleSet,
  checkQuote,
  DEFAULT_SETTINGS,
  evaluate,
  moneyFor,
  numbersIn,
  proposalFor,
  withQuoteStatus,
  type AuditEntry,
  type Assumption,
  type BlockFile,
  type Comps,
  type Hud,
  type Inquiry,
  type Rule,
} from '../src';
import { baseRules, block10K, ctxFor, questions, scen } from './load';

const b = block10K();
const ctx = ctxFor(b);
const raw = JSON.parse(readFileSync('data/money/comps_ward5.json', 'utf8'));
const comps: Comps = { ...raw, newest: raw.newest_built };
const h = JSON.parse(readFileSync('data/money/hud_fy2026.json', 'utf8'));
const hud: Hud = { area_name: h.hud_area_name, median: h.median_family_income, l80: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h[`l80_${i}`]), source_url: h.meta.url, pulled: h.meta.pulled };
const assumptions: Assumption[] = JSON.parse(readFileSync('data/assumptions.json', 'utf8'));

const letter = (inq: Inquiry, office: string) => inq.letters.find((l) => l.office === office)!;
const section = (l: { sections: { id: string; items: { text: string }[] }[] }, id: string) =>
  l.sections
    .filter((x) => x.id === id)
    .flatMap((x) => x.items.map((i) => i.text))
    .join(' ');
const money = (r: ReturnType<typeof evaluate>) => (r.state === 'ok' ? moneyFor(r, { comps, hud, assumptions }) : null);

/** The rules the app loads: base files plus the extracted districts, each quote checked against the saved code text. */
const allRules = (): Rule[] =>
  withQuoteStatus(
    [...baseRules(), ...JSON.parse(readFileSync('data/rules/extracted/r1d-h.json', 'utf8')).rules, ...JSON.parse(readFileSync('data/rules/extracted/rm-m.json', 'utf8')).rules],
    (f) => {
      try {
        return readFileSync(`data/code/${f.split('/').pop()}`, 'utf8');
      } catch {
        return null;
      }
    },
    checkQuote,
  );

const cases = [
  ['two', [25]],
  ['detached', [25]],
  ['three', [25, 26, 27]],
  ['row', [25, 26, 27]],
  ['two', [22]],
  ['two', [28]],
] as const;

describe('inquiry', () => {
  for (const [t, lots] of cases) {
    it(`${t} on ${lots.join(',')}: every number traces to the engine output`, () => {
      const r = evaluate(ctx, scen(b, t, [...lots]));
      const inq = buildInquiry(r, b, ctx.rs, money(r), '2026-09-26');
      expect(inq.check.unknown).toEqual([]);
      expect(inq.check.ok).toBe(true);
      expect(inq.letters.length).toBeGreaterThan(0);
      for (const l of inq.letters) {
        expect(l.check.ok).toBe(true);
        expect(l.markdown).toContain('not legal, financial or zoning advice');
        expect(l.markdown).toMatch(/not sent automatically/);
      }
    });
  }

  it('blocks export when a number does not trace (mutation)', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    const bad = { ...r, checks: r.checks.map((c) => (c.id === 'height' ? { ...c, text: `${c.text} Also 777 ft of something.` } : c)) };
    const inq = buildInquiry(bad, b, ctx.rs, null, '2026-09-26');
    expect(inq.check.ok).toBe(false);
    expect(letter(inq, 'zoning').check.ok).toBe(false);
    expect(letter(inq, 'zoning').check.unknown.join()).toMatch(/777/);
    expect(letter(inq, 'real_estate').check.ok).toBe(true); // a letter that doesn't carry it is not blocked
  });

  it('pencil and red items never appear as plain facts', () => {
    const r = evaluate(ctx, scen(b, 'row', [25, 26, 27]));
    const inq = buildInquiry(r, b, ctx.rs, null, '2026-09-26');
    for (const l of inq.letters) for (const f of l.sections.filter((s) => s.id === 'facts')) expect(f.items.every((i) => i.trust === 'ink')).toBe(true);
    const za = letter(inq, 'zoning');
    expect(section(za, 'facts')).not.toMatch(/21 ft/); // the open rowhouse reading stays out of the facts
    expect(section(za, 'questions')).toMatch(/single-unit house/);
  });

  it('numbersIn ignores identifiers (addresses, sections, lots, dates)', () => {
    expect(numbersIn('2241 Mahon St (lot 25) §903.03.C on 2026-09-26: 4 ft')).toEqual([4]);
  });

  it('numbersIn ignores code sections, ordinances and file numbers, but not quantities', () => {
    for (const id of ['§925.06', '925.07', '§915.02.A.1.c', 'Ord. 10-2025', '2025-1579', 'per Section 925.06?', 'under Sec. 922.07', '§903.03.C.2(c)', 'City Code Chapter 452'])
      expect(numbersIn(`See ${id} here.`), id).toEqual([]);
    expect(numbersIn('A stray $123,456 per home.')).toEqual([123456]);
    expect(numbersIn('925.07 ft of frontage')).toEqual([925.07]); // section-shaped, but a quantity
    expect(numbersIn('lot 25: 53%, lot 26: 56% and lot 27: 42%')).toEqual([53, 56, 42]);
  });

  it('Larimer (block 0124P, lot 203, detached): model-written section references do not block export', () => {
    const lar: BlockFile = JSON.parse(readFileSync('data/blocks/0124P.json', 'utf8'));
    const p = lar.parcels.find((x) => x.lot === 203)!;
    const rs = buildRuleSet(p.zone!, allRules(), questions(), []);
    const r = evaluate({ block: lar, rs, settings: DEFAULT_SETTINGS }, { type: 'detached', pins: [p.pin], proposal: proposalFor('detached') });
    const inq = buildInquiry(r, lar, rs, null, '2026-09-26');
    expect(section(letter(inq, 'zoning'), 'questions')).toMatch(/Section 925\.06.*Section 925\.07/s);
    expect(inq.check.unknown).toEqual([]);
    expect(inq.letters.every((l) => l.check.ok)).toBe(true);
    // The fix must not let a real untraced number through.
    const bad = { ...r, questions: r.questions.map((q) => (q.id.startsWith('q.rule') ? { ...q, text: `${q.text} It would cost $123,456.` } : q)) };
    const za = letter(buildInquiry(bad, lar, rs, null, '2026-09-26'), 'zoning');
    expect(za.check.ok).toBe(false);
    expect(za.check.unknown.join()).toMatch(/123456/);
  });

  describe('one letter per office', () => {
    const r = evaluate(ctx, scen(b, 'three', [25, 26, 27]));
    const inq = buildInquiry(r, b, ctx.rs, money(r), '2026-09-26');

    it('each letter has its own To, the From placeholder, the date, the disclaimer and a number check', () => {
      expect(inq.letters.map((l) => l.office)).toEqual(['real_estate', 'zoning', 'ura', 'rco']);
      for (const l of inq.letters) {
        expect(l.markdown).toContain(`To: ${l.to}`);
        expect(l.markdown).toContain('From: [your name, organization and contact]');
        expect(l.markdown).toContain('Date: 26 Sep 2026');
        expect(l.markdown).toMatch(/interprets its own code.*not sent automatically/s);
        expect(l.check.ok).toBe(true);
        expect(inq.markdown).toContain(l.markdown); // the combined download
      }
      expect(inq.markdown).toMatch(/## What to check next, in order/);
    });

    it('City property sales go to the Department of Finance, Real Estate Division, without our cost figures', () => {
      const re = letter(inq, 'real_estate');
      expect(re.to).toBe('City of Pittsburgh, Department of Finance, Real Estate Division');
      expect(re.markdown).not.toMatch(/\$|practitioner|estimate|setback|variance/i);
      const q = section(re, 'questions');
      expect(q).toMatch(/17 Nov 2016/); // when the City's inventory last updated the status
      expect(q).toMatch(/price/);
      expect(q).toMatch(/Request to Purchase/);
      expect(q).toMatch(/bought together/);
    });

    it('lots owned by others: look them up in the County records; never ask the City who owns them', () => {
      const re = letter(inq, 'real_estate');
      expect(re.markdown).not.toMatch(/who owns/i);
      expect(section(re, 'questions')).not.toMatch(/lot 26/);
      expect(section(re, 'facts')).toMatch(/[Ll]ot 26.*Allegheny County's public real-estate records/s);
      const next = inq.sections.find((s) => s.id === 'next')!.items[0].text;
      expect(next).not.toMatch(/who owns/i);
      expect(next).toMatch(/Look up the owner of lot 26 .*Allegheny County's public real-estate records/);
    });

    it('the Zoning Administrator gets the code questions and the facts they need: no money, no practitioner, no hardship', () => {
      const za = letter(inq, 'zoning');
      expect(za.markdown).not.toMatch(/\$|practitioner|hardship|estimate/i);
      expect(section(za, 'lot')).toMatch(/Zoned RM-M/);
      expect(section(za, 'lot')).toMatch(/24 × 100 ft/);
      expect(za.sections.find((x) => x.id === 'build')!.items.every((i) => i.trust === 'red')).toBe(true);
    });

    it('slope on combined lots is listed per lot, as the Site panel does', () => {
      const q = section(letter(inq, 'zoning'), 'questions');
      expect(q).toMatch(/lot 25: 53%, lot 26: 56% and lot 27: 42%/);
      expect(q).not.toMatch(/About 56% of the lot/);
    });

    it('the URA gets the money screen and the gap question; the RCO letter carries no money or code', () => {
      const ura = letter(inq, 'ura');
      expect(section(ura, 'money')).toMatch(/\$200–\$250 per sq ft.*a practitioner at the hackathon/s);
      expect(section(ura, 'money')).toMatch(/not a cap/);
      expect(section(ura, 'money')).toMatch(/production builder/);
      expect(section(ura, 'questions')).toMatch(/gap-financing programs/);
      expect(ura.markdown).not.toMatch(/estimate A\b|\(A\)/);
      const rco = letter(inq, 'rco');
      expect(rco.markdown).toMatch(/community meeting/);
      expect(rco.markdown).not.toMatch(/\$|§|setback|practitioner/);
    });

    it('a variance is only "may be needed" from the Zoning Board of Adjustment, with a question; never "hardship"', () => {
      const r2 = evaluate(ctx, scen(b, 'two', [25]));
      const za = letter(buildInquiry(r2, b, ctx.rs, money(r2), '2026-09-26'), 'zoning');
      expect(section(za, 'facts')).toMatch(/A variance from the Zoning Board of Adjustment may be needed/);
      expect(section(za, 'questions')).toMatch(/what would you need to see/);
      expect(za.markdown).not.toMatch(/hardship|practitioner/i);
    });

    it('records disagree (lot 22): the County assessment letter and City Real Estate, no zoning letter', () => {
      const r3 = evaluate(ctx, scen(b, 'two', [22]));
      const inq3 = buildInquiry(r3, b, ctx.rs, null, '2026-09-26');
      expect(inq3.letters.map((l) => l.office)).toEqual(['assessment', 'real_estate']);
      expect(section(letter(inq3, 'assessment'), 'records')).toMatch(/Which lot area is right/);
      expect(inq3.check.ok).toBe(true);
    });
  });

  describe('a City confirmation recorded in this app', () => {
    const confirm: AuditEntry = {
      id: 'a-test-confirm',
      rule_id: null,
      question_id: 'q.single_unit_includes_attached',
      at: '2026-09-20T15:00:00Z',
      reviewer: 'Test Reviewer',
      role: 'CDC project manager',
      action: 'city_confirmed',
      quote: '',
      decision: 'City says yes',
      reason: 'test',
      choice: 'yes',
      reference: { text: 'email, ticket 4471', date: '2026-09-19', who: 'Zoning counter' },
    };
    const c2 = ctxFor(b, { audit: [confirm] });
    const r = evaluate(c2, scen(b, 'row', [25, 26, 27]));
    const za = letter(buildInquiry(r, b, c2.rs, null, '2026-09-26', c2.settings), 'zoning');

    it('keeps the question and quotes who recorded it, when, and the reference', () => {
      expect(r.questions.some((q) => q.id === 'q.single_unit_includes_attached')).toBe(false); // the engine dropped it
      const q = section(za, 'questions');
      expect(q).toMatch(/single-unit house/);
      expect(q).toContain(
        "Recorded in this app by Test Reviewer (CDC project manager) on 20 Sep 2026: the City confirmed the answer is yes (reference: Zoning counter, 19 Sep 2026, email, ticket 4471). Please confirm this is the City's reading.",
      );
      expect(za.check.ok).toBe(true);
    });

    it('the numbers that depend on it say they rest on it; the others do not', () => {
      const facts = za.sections.find((x) => x.id === 'facts')!.items;
      expect(facts.find((i) => /21 ft/.test(i.text))!.text).toMatch(/rests on a City confirmation recorded in this app/);
      expect(facts.find((i) => /depth/.test(i.text))!.text).not.toMatch(/rests on/);
    });
  });
});
