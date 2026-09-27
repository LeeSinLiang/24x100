// The Development Ease guard (it replaces the no-score check, retired when Sin chose to show the score, 27 Sep):
// a score never renders alone. On every page that shows one:
//   - no bare "NN / 100": out of 100 only as a range ("15–35 / 100") inside a [data-ease] element;
//   - every scored [data-ease] has lo ≤ hi, both 0–100, and shows its range;
//   - its parts are one click away or on the page: the bar is a button (opens the Ease tab), or sits by the parts table,
//     or carries its formula in its title.
// --self-test plants a bare score first and must catch it.
// Usage: node scripts/ease-guard.mjs [--base http://localhost:5173/] [--self-test]
import { chromium } from 'playwright';

const i = process.argv.indexOf('--base');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:5173/';
const PAGES = [
  'view=lot&block=10K&lot=25&type=two',
  'view=lot&block=10K&lot=25&type=three&lots=25,26,27&tab=ease',
  'view=lot&block=10K&lot=25&type=three&lots=25,26,27&quote=140',
  'view=compare',
  'view=shortlist',
  'view=city&type=two',
];

function scan() {
  const bad = [];
  const bare = /(?<![–\d]\s?)\b\d{1,3}\s*\/\s*100\b/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const s = t.textContent || '';
    if (bare.test(s) && !t.parentElement.closest('[data-ease]')) bad.push(`bare score outside an ease range: "${s.trim().slice(0, 60)}"`);
  }
  const bars = [...document.querySelectorAll('[data-ease]')];
  for (const b of bars) {
    if (b.dataset.ease !== 'scored') continue;
    const lo = Number(b.dataset.easeLo);
    const hi = Number(b.dataset.easeHi);
    if (!(lo >= 0 && hi <= 100 && lo <= hi)) bad.push(`ease range out of order: ${lo}–${hi}`);
    if (!b.textContent.includes(`${lo}–${hi}`)) bad.push(`ease shows no range: "${b.textContent.trim()}"`);
    const parts = b.tagName === 'BUTTON' || !!b.closest('[data-panel="ease"], [data-ease-compare]') || /=/.test(b.getAttribute('title') || '');
    if (!parts) bad.push(`ease ${lo}–${hi} with no way to its parts`);
  }
  return { bad, bars: bars.length };
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let problems = 0;
if (process.argv.includes('--self-test')) {
  await page.goto(`${BASE}?view=lot&block=10K&lot=25&type=two`);
  await page.waitForSelector('[data-ease]', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.ws-sentence')?.insertAdjacentHTML('beforeend', ' <b>Ease 72 / 100</b>'));
  const r = await page.evaluate(scan);
  if (!r.bad.length) {
    console.log('✗ self-test: a planted bare score went unnoticed');
    process.exit(1);
  }
}
for (const q of PAGES) {
  await page.goto(`${BASE}?${q}`);
  await page.waitForSelector('[data-ease], main', { timeout: 20000 });
  await page.waitForTimeout(q.includes('shortlist') || q.includes('compare') || q.includes('city') ? 2500 : 1200);
  const r = await page.evaluate(scan);
  for (const b of r.bad) console.log(`✗ ${q}: ${b}`);
  problems += r.bad.length;
  if (!q.startsWith('view=city') && !r.bars) {
    console.log(`✗ ${q}: no Development Ease shown`);
    problems++;
  }
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : `ease guard: every Development Ease is a range with its parts one click away; no bare score on ${PAGES.length} pages`);
process.exit(problems ? 1 : 0);
