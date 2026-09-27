// The steward's publish step (scripts/check-reviews.ts), run against a temporary copy of the rules so the
// committed data/rules/reviews.json is never touched.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReviews } from '../../scripts/check-reviews';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const RULE = { id: 'r1d-h.x.min_lot_area', quote: 'Minimum Lot Size | 1,200 s.f.' }; // a model-proposed rule, pencil until signed

function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'reviews-'));
  for (const d of ['data/rules/base', 'data/rules/extracted', 'data/code']) cpSync(d, join(root, d), { recursive: true });
  cpSync('data/rules/questions.json', join(root, 'data/rules/questions.json'));
  mkdirSync(join(root, 'data/rules/uploads'), { recursive: true });
  return root;
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  rule_id: RULE.id,
  question_id: null,
  at: '2026-09-27T10:00:00Z',
  reviewer: 'Jordan Rivera',
  role: 'Zoning analyst',
  action: 'source_checked',
  quote: RULE.quote,
  decision: 'matches',
  reason: 'Compared with the saved §903.03.D table.',
  choice: null,
  reference: null,
  ...over,
});

function upload(root: string, name: string, entries: unknown[]) {
  writeFileSync(join(root, 'data/rules/uploads', name), JSON.stringify({ entries }));
  return `data/rules/uploads/${name}`;
}

describe('check-reviews', () => {
  it('a valid signature passes, merges with --write, and turns its rule to ink', () => {
    const root = sandbox();
    const f = upload(root, 'a.json', [entry()]);
    const dry = checkReviews({ root, files: [f], reviews: 'data/rules/reviews.json', write: false, allowFlagged: false, now: NOW });
    expect(dry.ok).toBe(true);
    expect(existsSync(join(root, 'data/rules/reviews.json'))).toBe(false); // dry run writes nothing
    const r = checkReviews({ root, files: [f], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.lines.join('\n')).toMatch(/r1d-h\.x\.min_lot_area: pencil → ink/);
    const written = JSON.parse(readFileSync(join(root, 'data/rules/reviews.json'), 'utf8'));
    expect(written.entries.map((e: { id: string }) => e.id)).toEqual(['e-1']);
    // Sending the same file again is a duplicate, not a change.
    const again = checkReviews({ root, files: [f], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW });
    expect(again.ok).toBe(true);
    expect(again.added).toBe(0);
  });

  it('refuses a placeholder or test name unless a person overrides it, and records the override', () => {
    const root = sandbox();
    const f = upload(root, 'b.json', [entry({ reviewer: 'Placeholder reviewer', role: 'replace before submission' })]);
    const r = checkReviews({ root, files: [f], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/looks like a placeholder or a test/);
    expect(existsSync(join(root, 'data/rules/reviews.json'))).toBe(false);
    const forced = checkReviews({ root, files: [f], reviews: 'data/rules/reviews.json', write: false, allowFlagged: true, now: NOW });
    expect(forced.ok).toBe(true);
    expect(forced.merged[0].flags_accepted_at).toBeTruthy();
  });

  it('refuses an AI "review", a quote that isn’t the rule’s, a missing name, and a rewritten published entry', () => {
    const root = sandbox();
    const bad = [
      entry({ id: 'ai', role: 'AI agent', reviewer: 'Some model' }),
      entry({ id: 'quote', quote: 'Minimum Lot Size | 1,000 s.f.' }),
      entry({ id: 'noname', reviewer: '' }),
    ];
    const r = checkReviews({ root, files: [upload(root, 'c.json', bad)], reviews: 'data/rules/reviews.json', write: false, allowFlagged: false, now: NOW });
    expect(r.ok).toBe(false);
    const out = r.lines.join('\n');
    expect(out).toMatch(/ai: signed as "AI agent"/);
    expect(out).toMatch(/quote: the quote in this entry differs/);
    expect(out).toMatch(/noname: reviewer name is required/);

    const ok = upload(root, 'd.json', [entry()]);
    expect(checkReviews({ root, files: [ok], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW }).ok).toBe(true);
    const changed = upload(root, 'e.json', [entry({ reason: 'A different note' })]);
    const r2 = checkReviews({ root, files: [changed], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW });
    expect(r2.ok).toBe(false);
    expect(r2.lines.join('\n')).toMatch(/already published with different content/);
  });

  it('never touches the committed review log (the tests write only to a temporary copy)', () => {
    const before = existsSync('data/rules/reviews.json') ? readFileSync('data/rules/reviews.json', 'utf8') : null;
    const root = sandbox();
    checkReviews({ root, files: [upload(root, 'z.json', [entry({ id: 'z' })])], reviews: 'data/rules/reviews.json', write: true, allowFlagged: false, now: NOW });
    const after = existsSync('data/rules/reviews.json') ? readFileSync('data/rules/reviews.json', 'utf8') : null;
    expect(after).toBe(before);
  });
});
