// Spec §0.12 C1 check: no score or number out of 100 appears in the UI, the inquiry, film/facts.json or the
// film notes. ("Can't score" is a refusal, not a score, and is allowed.)
// Usage: node scripts/no-score.mjs [--base http://localhost:5173/]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const i = process.argv.indexOf('--base');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:5173/';
const BAD = [/\b\d{1,3}\s*[–-]?\s*\d{0,3}\s*\/\s*100\b/, /score\s*\(heuristic\)|heuristic score|score · heuristic|\bease\b/i, /\bscore[ds]?\b(?!\s*(them|it))/i];
const allow = (s) => s.replace(/can[’']?t score|can[’']?t be scored|can be scored|not scored|never scored|does not score|isn[’']?t scored|are not scored|there is no score|no score\b|"score"|RULES NOT LOADED/gi, '');
if (process.argv.includes('--self-test')) {
  const planted = [];
  for (const re of BAD) if (allow('Score · heuristic 30–60 out of 100').match(re)) planted.push(re);
  if (!planted.length) { console.log('✗ self-test: a planted score went unnoticed'); process.exit(1); }
}
const problems = [];
const check = (where, text) => {
  const t = allow(text);
  for (const re of BAD) {
    const m = t.match(re);
    if (m) problems.push(`${where}: "${t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}"`);
  }
};
check('film/facts.json', readFileSync('film/facts.json', 'utf8'));
check('film/SCRIPT_NOTES.md', readFileSync('film/SCRIPT_NOTES.md', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
for (const q of [
  'view=lot&block=10K&lot=25&type=two',
  'view=lot&block=10K&lot=25&type=three&lots=25,26,27',
  'view=lot&block=10K&lot=22&type=two',
  'view=lot&block=0124P&lot=203&type=detached',
  'view=inquiry&block=10K&lot=25&type=three&lots=25,26,27',
  'view=city&type=two',
  'view=about&block=10K&section=limits',
]) {
  await page.goto(`${BASE}?${q}&still=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
  await page.waitForTimeout(300);
  check(q, await page.locator('body').innerText());
}
await browser.close();
if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`✗ ${problems.length} score mention(s)`);
  process.exit(1);
}
console.log('no score: none in the UI, the inquiry, film/facts.json or the film notes');
