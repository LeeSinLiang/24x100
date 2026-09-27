// The watchlist digest: the state of a watched lot, what changed, and the message. No network.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffStates, renderDigest, watchState, type WatchLotState, type WatchSnapshot } from '../src/digest';
import { buildRuleSet, DEFAULT_SETTINGS, type Rule } from '../src';
import type { CityLot } from '../src/city';

const J = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const lots: CityLot[] = J('data/city/lots.json').lots;
const files = ['data/rules/base/pgh.json', 'data/rules/base/rm-m.json'].map(J).flat() as Rule[];
const extracted = ['r2-h', 'rm-m', 'r1d-h'].flatMap((d) => J(`data/rules/extracted/${d}.json`).rules) as Rule[];
const rules = [...files, ...extracted];
const questions = J('data/rules/questions.json');
const reviews = J('data/rules/reviews.json').entries;
const snap = (label: string, revs: unknown[], pins: string[]): WatchSnapshot => ({
  at: '2026-09-27T15:00:00Z',
  label,
  lots: Object.fromEntries(
    pins.map((pin) => {
      const l = lots.find((x) => x.pin === pin)!;
      return [pin, watchState(l, buildRuleSet(l.zone!, rules, questions, revs as never), 'two', DEFAULT_SETTINGS, `?view=city&type=two&pin=${pin}`)];
    }),
  ),
});

describe('watchlist digest', () => {
  const CLIMAX = '0014E00106000000'; // 503 Climax St, Beltzhoover, R2-H
  const before = snap('before the sign-off', reviews.filter((e: { id: string }) => !e.id.startsWith('sin-signoff-coverage')), [CLIMAX]);
  const now = snap('now', reviews, [CLIMAX]);

  it("a real change: Sin's sign-off of R2-H moves 503 Climax St from 'not checked yet' to too narrow, 25 − 5 − 5 = 15 ft", () => {
    expect(before.lots[CLIMAX].verdict.blocker).toBe('rules');
    expect(now.lots[CLIMAX].verdict).toMatchObject({ blocker: 'width', formula: '25 − 5 − 5 = 15', trust: 'ink' });
    const [c] = diffStates(before, now);
    expect(c.pin).toBe(CLIMAX);
    const v = c.items.find((i) => i.kind === 'verdict')!;
    expect(v.before).toMatch(/^not checked yet: its rules are proposed/);
    expect(v.after).toBe('too narrow: 25 − 5 − 5 = 15 ft, for a 16 ft two-unit house');
    const r = c.items.find((i) => i.kind === 'rules')!;
    // The rules the map reads for a two-unit house: R2-H's six (its dimensions and use) and two citywide ones.
    expect(r.before).toBe('2 signed by a person, 6 in pencil (proposed by the model, not checked)');
    expect(r.after).toBe('8 signed by a person; signed by Sin (Student, team 24×100)');
  });

  it('no change, no message; a record change is reported with its source; a newly watched lot once, as new', () => {
    expect(diffStates(now, now)).toEqual([]);
    const moved: WatchSnapshot = { ...now, lots: { [CLIMAX]: { ...now.lots[CLIMAX], records: { ...now.lots[CLIMAX].records, status: 'Sale Pending' } } } };
    const [c] = diffStates(now, moved);
    expect(c.items).toEqual([expect.objectContaining({ kind: 'records', what: 'City sale status', before: 'Available for Sale', after: 'Sale Pending' })]);
    expect(diffStates(null, now)[0].items[0].kind).toBe('new');
    // A refresh diff carries its own dataset and pull time.
    const [r] = diffStates(now, now, [{ pin: CLIMAX, field: 'streets.names', before: ['Climax St'], after: ['Climax Street'], source: 'city data, refresh pulled 2026-09-27T0300' }]);
    expect(r.items[0]).toMatchObject({ kind: 'records', source: 'city data, refresh pulled 2026-09-27T0300' });
  });

  it('the message: Slack Block Kit with a link into the app, an HTML email that escapes, a plain-text twin', () => {
    const odd: WatchLotState = { ...now.lots[CLIMAX], addr: '5 <Main> & "Oak"' };
    const m = renderDigest(diffStates(before, { ...now, lots: { [CLIMAX]: odd } }), { appUrl: 'https://app.test', watched: 1, note: 'Compared with before.', at: now.at });
    expect(m.subject).toBe('24×100: 1 watched lot changed');
    const blocks = m.slack.blocks as { type: string; text?: { text: string }; elements?: { url?: string }[] }[];
    expect(blocks[0].type).toBe('header');
    expect(blocks.find((x) => x.type === 'section')!.text!.text).toContain('<https://app.test/?view=city&type=two&pin=0014E00106000000|5 &lt;Main&gt; &amp; "Oak">');
    expect(blocks.find((x) => x.type === 'actions')!.elements![0].url).toBe('https://app.test/?view=city&type=two&pin=0014E00106000000');
    expect(m.html).toContain('5 &lt;Main&gt; &amp; &quot;Oak&quot;');
    expect(m.html).not.toContain('<Main>');
    expect(m.text).toContain('Open: https://app.test/?view=city&type=two&pin=0014E00106000000');
    expect(m.text).toMatch(/never sends anything to the City/);
    // No personal data: an owner field never appears.
    expect(JSON.stringify(m)).not.toMatch(/PROPERTYOWNER|owner_name|mailing/i);
  });
});
