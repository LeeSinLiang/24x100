// Scripted first-run test: a fresh browser (no storage) opens the app with no parameters and answers
// "What blocks 2241 Mahon St, and what would unlock it?". It times the path and records the answers
// the screen gives. This measures the interface's path, not a human; see docs/evidence/usability.md.
// Usage: node scripts/firstrun.mjs [--base http://localhost:5173/] [--out docs/evidence/first-run.json]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5173/');
const OUT = arg('out', 'docs/evidence/first-run.json');

const browser = await chromium.launch({ channel: 'chrome' });
const runs = [];
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const steps = [];
  const t0 = Date.now();
  const mark = (what) => steps.push({ what, ms: Date.now() - t0 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  mark('app ready (first screen, no parameters)');
  // A first-time user types the address into the search box the header offers.
  const search = page.getByRole('searchbox').or(page.getByLabel(/find a lot/i)).first();
  await search.click();
  await search.fill('2241 Mahon');
  mark('typed "2241 Mahon" into the search');
  await search.press('Enter');
  mark('pressed Enter');
  // The workspace (spec §0.15): the inspector's first screen has the status, the plain sentence, the way forward
  // and four numbers; the reason (the side setbacks) is on the Rules tab, one more click.
  await page.waitForSelector('.ws-inspector [data-way], .ws-inspector .ws-way', { timeout: 10000 });
  mark('first screen: status, sentence, way forward, four numbers');
  const insp = page.locator('.ws-inspector').first();
  const first = (await insp.innerText()).replace(/\s+/g, ' ').trim();
  const way = (await page.locator('.ws-way').first().innerText()).replace(/\s+/g, ' ').trim();
  await page.getByRole('tab', { name: /Rules/ }).first().click();
  await page.waitForFunction(() => /side setbacks?/i.test(document.querySelector('.ws-inspector')?.textContent ?? ''), null, { timeout: 10000 });
  mark('clicked the Rules tab: the side setbacks and the relief');
  const rules = (await insp.innerText()).replace(/\s+/g, ' ').trim();
  const answer = { first_screen: first.slice(0, 700), way_forward: way, rules_tab: rules.slice(0, 700) };
  const blocksOk = /4 ft/.test(first) && /side setbacks 10 → 4 ft on each side/.test(rules);
  const nextOk = /lots? \d+/.test(way) && /ft/.test(way);
  runs.push({
    viewport: viewport.name,
    user_actions_to_blocker_and_unlock: 3, // click the search, type, press Enter: both on the first screen
    user_actions_to_the_reason: 4, // plus the Rules tab, for the 10 ft setbacks and the relief
    total_ms: steps[steps.length - 1].ms,
    under_60s: steps[steps.length - 1].ms < 60000,
    answers_found: { blocks: blocksOk, unlock: nextOk },
    steps,
    answer,
  });
  await ctx.close();
}
await browser.close();
const result = {
  run_at: new Date().toISOString(),
  question: 'What blocks 2241 Mahon St, and what would unlock it?',
  method: 'Playwright, fresh browser context, app root with no parameters; the path a first-time user can see: the search box in the header.',
  caveat: 'This times the interface path with a script. It is not a study with people; the judge panel and the team supply the human check.',
  runs,
};
mkdirSync(OUT.split('/').slice(0, -1).join('/'), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
for (const r of runs) console.log(`${r.viewport}: ${r.user_actions_to_blocker_and_unlock} actions (reason: ${r.user_actions_to_the_reason}), ${(r.total_ms / 1000).toFixed(1)} s; blocks found: ${r.answers_found.blocks}; unlock found: ${r.answers_found.unlock}`);
console.log(`→ ${OUT}`);
