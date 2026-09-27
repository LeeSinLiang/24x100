// Integrity tests (spec §12): one result object, no double counting, preference vs regulation,
// trust states, audit rules, sanity limits, and the mutation check.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  auditProblems,
  checkQuote,
  withQuoteStatus,
  evaluate,
  explanation,
  headline,
  parseFormula,
  unlockSearch,
  type AuditEntry,
  type LotResult,
  type Rule,
} from '../src';
import { baseRules, block10K, ctxFor, pinOf, scen } from './load';
import { assertLot25TwoUnit } from './lot25.test';

const b = block10K();
const ctx = ctxFor(b);
const rowLots = b.parcels.filter((p) => p.pin.startsWith('0010K') && p.lot != null && p.lot >= 21 && p.lot <= 35 && !p.lot_suffix);

function numbersIn(s: string): number[] {
  return [...s.matchAll(/(?<![\w§.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function allScenarios(): LotResult[] {
  const out: LotResult[] = [];
  for (const p of rowLots) {
    for (const t of ['two', 'detached'] as const) out.push(evaluate(ctx, { ...scen(b, t, [25]), pins: [p.pin] }));
    const i = rowLots.indexOf(p);
    const group = rowLots.slice(i, i + 3).filter((q) => q.zone === p.zone);
    if (group.length === 3) for (const t of ['three', 'row'] as const) out.push(evaluate(ctx, { ...scen(b, t, [25]), pins: group.map((q) => q.pin) }));
  }
  return out;
}

describe('one result object: every formula string round-trips to the result numbers (lots 21–35)', () => {
  const results = allScenarios();
  it('covers every scenario', () => expect(results.length).toBeGreaterThan(30));
  for (const r of results) {
    it(`${r.scenario.type} ${r.pins.map((p) => p.slice(-7, -4)).join('+')}`, () => {
      if (r.state !== 'ok') {
        expect(r.refusal!.reason.length).toBeGreaterThan(10);
        expect(r.score).toBeNull();
        return;
      }
      for (const c of r.checks) {
        if (!c.alternative) continue;
        const f = parseFormula(c.alternative.formula)!;
        expect(f.result).toBe(c.alternative.available);
        expect(f.terms[0] - f.terms.slice(1).reduce((a, x) => a + x, 0)).toBe(c.alternative.available);
      }
      for (const m of [r.width!, r.depth!, ...r.units.map((u) => u.width)]) {
        if (m.none) {
          expect(m.deed).toBe(0);
          expect(m.formula).toMatch(/leaves no buildable/);
          continue;
        }
        const f = parseFormula(m.formula)!;
        expect(f).not.toBeNull();
        expect(f.terms).toEqual(m.terms.map((t) => t.value));
        expect(f.result).toBeCloseTo(m.terms[0].value - m.terms.slice(1).reduce((s, t) => s + t.value, 0), 6);
        if (m.deed != null) expect(f.result).toBeCloseTo(m.deed, 6);
      }
      // The score formula agrees with the approvals.
      const s = r.score!;
      const [hiPart, loPart] = s.formula.split(' · open: ');
      const hi = parseFormula(hiPart)!;
      expect(hi.result).toBe(s.hi);
      expect(hi.terms.slice(1)).toEqual(r.approvals.ink.map((a) => a.weight));
      if (loPart) {
        const lo = parseFormula(loPart)!;
        expect(lo.result).toBe(s.lo);
        expect(lo.terms.slice(1)).toEqual(r.approvals.pencil.map((a) => a.weight));
      } else expect(s.lo).toBe(s.hi);
      // Every number in the headline and the explanation appears in the result object.
      // Identifiers (addresses, lot numbers, section numbers) are names, not quantities.
      const text = [...headline(r, b, ctx.rs), ...explanation(r, b)]
        .map((x) => x.t)
        .join(' ')
        .replace(/\b\d+ [A-Z][a-z]+ (St|Way|Ave|Street|Avenue)\b/g, '')
        .replace(/\b[Ll]ots? \d+(–\d+)?/g, '');
      const known = new Set<number>([
        ...[r.width!, r.depth!, ...r.units.map((u) => u.width)].flatMap((m) => [m.deed ?? -1, m.mapped, ...m.terms.map((t) => t.value)]),
        ...r.checks.flatMap((c) => [c.required ?? -1, c.available ?? -1, c.alternative?.available ?? -1, ...(c.alternative ? numbersIn(c.alternative.formula) : [])]),
        ...r.relief.flatMap((x) => [x.from, x.to]),
        r.scenario.proposal.width,
        2025, 60, 3, // "since May 2025"; "less than 60 ft" and the 3 ft minimum are quoted rule text
      ]);
      for (const n of numbersIn(text.replace(/§[\d.A-Za-z()]+/g, ''))) expect(known.has(n), `${n} in "${text}"`).toBe(true);
    });
  }
});

describe('score', () => {
  it('deducts once per distinct approval (lot 28: width, depth and area all need a variance)', () => {
    const r = evaluate(ctx, scen(b, 'two', [28]));
    const variance = r.checks.flatMap((c) => c.approvals).filter((a) => a.kind === 'variance' && a.trust === 'ink');
    expect(variance.length).toBeGreaterThanOrEqual(2);
    expect(r.approvals.ink.filter((a) => a.kind === 'variance')).toHaveLength(1);
    expect(r.score!.hi).toBe(100 - 35 - 5);
  });

  it('lot 25 two-unit: 30–60 (variance and City sale certain; grading and parking open)', () => {
    const r = evaluate(ctx, scen(b, 'two', [25]));
    expect([r.score!.lo, r.score!.hi]).toEqual([30, 60]);
  });
});

describe('preference vs regulation', () => {
  it('a wider proposal changes the relief requested, never the kinds of approval', () => {
    const a = evaluate(ctx, scen(b, 'two', [25], { width: 16 }));
    const c = evaluate(ctx, scen(b, 'two', [25], { width: 18 }));
    expect(a.relief.find((x) => x.check === 'width')!.text).toBe('side setbacks 10 → 4 ft on each side');
    expect(c.relief.find((x) => x.check === 'width')!.text).toBe('side setbacks 10 → 3 ft on each side');
    const kinds = (r: LotResult) => [...r.approvals.ink, ...r.approvals.pencil].map((x) => x.kind).sort();
    expect(kinds(c)).toEqual(kinds(a));
  });
});

describe('trust states', () => {
  const extractedUse: Rule = {
    ...baseRules()[0],
    id: 'rm-m.use_two.x',
    field: 'use_two',
    value: 'P',
    unit: 'use',
    applies_to: ['two'],
    section: '911.02',
    quote: 'x',
    source_file: 'data/code/ch911.txt',
    origin: 'extracted',
    dagger: true,
    verification: { level: 'unreviewed', reviewer: null, role: null, at: null, note: null, reference: null },
    model: 'gemini-test',
    prompt_sha: 'abc',
  };

  it('an unreviewed extracted rule is pencil and never ink', () => {
    const c = ctxFor(b, { rules: [...baseRules(), extractedUse] });
    const r = evaluate(c, scen(b, 'two', [25]));
    const use = r.checks.find((x) => x.id === 'use')!;
    expect(use.trust).toBe('pencil');
    expect(use.status).toBe('open');
  });

  it('a † rule "source-checked" only by an AI agent stays pencil', () => {
    const aiChecked = { ...extractedUse, verification: { level: 'source_checked' as const, reviewer: 'Claude (research pass)', role: 'AI agent', at: '2026-09-26T16:30:00-04:00', note: 'n', reference: null } };
    const c = ctxFor(b, { rules: [...baseRules(), aiChecked] });
    expect(c.rs.rules.find((x) => x.id === aiChecked.id)!.state).toBe('pencil');
  });

  it('a named person signing turns it ink; striking removes it', () => {
    const sign: AuditEntry = { id: 'a1', rule_id: extractedUse.id, question_id: null, at: '2026-09-26T21:00:00Z', reviewer: 'A. Person', role: 'Housing lead', action: 'source_checked', quote: 'x', decision: 'matches', reason: 'compared to §911.02 table', choice: null, reference: null };
    const c = ctxFor(b, { rules: [...baseRules(), extractedUse], audit: [sign] });
    expect(c.rs.rules.find((x) => x.id === extractedUse.id)!.state).toBe('ink');
    const r = evaluate(c, scen(b, 'two', [25]));
    expect(r.checks.find((x) => x.id === 'use')!.trust).toBe('ink');
    const strike: AuditEntry = { ...sign, id: 'a2', at: '2026-09-26T21:05:00Z', action: 'struck', reason: 'wrong row' };
    const c2 = ctxFor(b, { rules: [...baseRules(), extractedUse], audit: [sign, strike] });
    expect(c2.rs.rules.find((x) => x.id === extractedUse.id)!.state).toBe('struck');
    expect(evaluate(c2, scen(b, 'two', [25])).checks.find((x) => x.id === 'use')!.rule_ids).toEqual([]);
  });

  it('signing a rule that carries a question for the City inks its value, and the question stays open until the City answers', () => {
    const q: Rule = { ...extractedUse, id: 'x.q', dagger: false, question_for_city: 'Does this apply to attached houses?' };
    const sign: AuditEntry = { id: 'b1', rule_id: q.id, question_id: null, at: '2026-09-26T21:00:00Z', reviewer: 'A. Person', role: 'Housing lead', action: 'source_checked', quote: 'x', decision: 'matches', reason: 'r', choice: null, reference: null };
    const signed = ctxFor(b, { rules: [...baseRules(), q], audit: [sign] });
    expect(signed.rs.rules.find((x) => x.id === q.id)!.state).toBe('ink');
    expect(evaluate(signed, scen(b, 'two', [25])).questions.map((x) => x.id)).toContain('q.rule.x.q');
    const conf: AuditEntry = { ...sign, id: 'b2', at: '2026-09-26T21:10:00Z', action: 'city_confirmed', reference: { text: 'email', date: '2026-09-28', who: 'Zoning Administrator' } };
    const sealed = ctxFor(b, { rules: [...baseRules(), q], audit: [sign, conf] });
    expect(evaluate(sealed, scen(b, 'two', [25])).questions.map((x) => x.id)).not.toContain('q.rule.x.q');
  });

  it('pre-seeded RM‑M rules are ink but flagged AI-checked until a teammate re-signs', () => {
    const r = ctx.rs.rules.find((x) => x.id === 'rm-m.side_interior')!;
    expect(r.state).toBe('ink');
    expect(r.ai_checked).toBe(true);
    expect(r.sealed).toBe(false);
  });

  it('a rule whose quote no longer appears in the saved text drops back to pencil', () => {
    const changed = withQuoteStatus(baseRules(), (f) => readFileSync(f, 'utf8').replace('RM Subdistrict | \n10 ft.', 'RM Subdistrict | \n12 ft.'), checkQuote);
    const c = ctxFor(b, { rules: changed });
    expect(changed.find((r) => r.id === 'rm-m.side_interior')!.quote_status).toBe('failed');
    expect(c.rs.rules.find((r) => r.id === 'rm-m.side_interior')!.state).toBe('pencil');
    expect(evaluate(c, scen(b, 'two', [25])).width!.trust).toBe('pencil');
    const same = withQuoteStatus(baseRules(), (f) => readFileSync(f, 'utf8'), checkQuote);
    expect(same.every((r) => r.quote_status === 'verified')).toBe(true);
  });

  it('audit entries need a name, role and reason; City confirmation needs a reference; only questions are assumed', () => {
    const base: AuditEntry = { id: 'x', rule_id: 'r', question_id: null, at: '2026-09-26T21:00:00Z', reviewer: 'A', role: 'B', action: 'source_checked', quote: '', decision: '', reason: 'C', choice: null, reference: null };
    expect(auditProblems(base)).toEqual([]);
    expect(auditProblems({ ...base, reviewer: ' ' })).not.toEqual([]);
    expect(auditProblems({ ...base, reason: '' })).not.toEqual([]);
    expect(auditProblems({ ...base, action: 'city_confirmed' })).not.toEqual([]);
    expect(auditProblems({ ...base, action: 'assumed' })).not.toEqual([]);
  });
});

describe('sanity limits', () => {
  it('width ≤ 0 reads "no buildable width", never a negative number', () => {
    const rules = baseRules().map((r) => (r.id === 'rm-m.side_interior' ? { ...r, value: 15 } : r));
    const r = evaluate(ctxFor(b, { rules }), scen(b, 'two', [25]));
    expect(r.width!.none).toBe(true);
    expect(r.width!.deed).toBe(0);
    expect(r.width!.formula).toBe('24 − 15 − 15 leaves no buildable width');
    expect(r.checks.find((c) => c.id === 'width')!.available).toBe(0);
  });

  it('the envelope never exceeds the lot', () => {
    for (const r of allScenarios()) if (r.state === 'ok') expect(r.envelope.area).toBeLessThanOrEqual(r.pins.reduce((s, pin) => s + b.parcels.find((p) => p.pin === pin)!.mapped_area, 0));
  });
});

describe('unlock search', () => {
  it('keeps the proposal’s homes, names the smallest change within the levers, and never calls it optimal', () => {
    const u = unlockSearch(ctx, scen(b, 'two', [25]));
    expect(u.recommended).not.toBeNull();
    expect(u.recommended!.fits).toBe(true);
    expect(u.recommended!.discretionary).toBe(0);
    expect(u.recommended!.homes).toBeGreaterThanOrEqual(2);
    expect(u.options.at(-1)!.discretionary).toBeGreaterThanOrEqual(1);
    const want = [25, 26, 27].map((l) => pinOf(b, l)).sort().join('+');
    const three = u.options.find((o) => o.lever === 'combine' && o.scenario.type === 'three' && [...o.scenario.pins].sort().join('+') === want)!;
    expect(three.result.width!.deed).toBe(52);
    expect(three.fits).toBe(true);
    expect(u.options.find((o) => o.lever === 'variance')).toBeDefined();
  });
});

describe('mutation check (a test that cannot fail proves nothing)', () => {
  it('changing the RM‑M interior side setback from 10 to 5 makes the lot‑25 two-unit test fail', () => {
    const mutated = baseRules().map((r) => (r.id === 'rm-m.side_interior' ? { ...r, value: 5 } : r));
    expect(() => assertLot25TwoUnit(ctxFor(b, { rules: mutated }))).toThrow();
    expect(() => assertLot25TwoUnit(ctx)).not.toThrow();
  });
});

describe('street names', () => {
  it('match across small spelling differences, but not different streets', async () => {
    const { sameStreet } = await import('../src');
    expect(sameStreet('STOLZ ST', 'Stoltz Street')).toBe(true);
    expect(sameStreet('CROSSMAN ST', 'Crosman Street')).toBe(true);
    expect(sameStreet('CLAIRTONICA ST', 'Clairtonic Street')).toBe(true);
    expect(sameStreet('MAHON ST', 'Mahon Street')).toBe(true);
    expect(sameStreet('MAHON ST', 'Mahon Way')).toBe(false);
    expect(sameStreet('SOHO ST', 'Soto Street')).toBe(false);
    expect(sameStreet('WYLIE AVE', 'Kirkpatrick Street')).toBe(false);
  });
});
