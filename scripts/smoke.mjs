// Post-deploy smoke test: does the site at <url> show what the film says?
//   npm run smoke -- https://<deployed url>/        (default http://localhost:4173/, `npm run preview`)
//   npm run smoke -- <url> --mutate                 every expected value nudged: each value check must now FAIL
//
// Checks, in a real Chrome at 1440×900:
//   - the city view: "CHECKED IN 6 DISTRICTS", each of the six signed districts named, and 428 too narrow;
//   - the rule what-if S1 opens 196 lots;
//   - lot 25 leaves 4 ft for a two-unit house;
//   - the builder's quote moves the money to the full-cost gap (film beat B16: $140/sf → $23.1k–$48.1k a home before land,
//     $51k left after building only);
//   - the letters: a draft, four letters, every number traced to the engine;
//   - the static API (api/city/summary.json, api/lots/<pin>.json), the link-preview image and the favicon;
//   - on every page: no console error, no uncaught error, no failed request to the site itself;
//   - a phone (390 px) shows the lot page without sideways scroll.
// The numbers come from film/facts.json (scripts/facts.ts, the engine's), so the site is checked against the same
// source the film's lines are.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const MUTATE = args.includes('--mutate');
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:4173/').replace(/\/?(\?.*)?$/, '/');
const origin = new URL(BASE).origin;
const facts = JSON.parse(readFileSync('film/facts.json', 'utf8')).facts;

const E = {
  districts: facts.city_districts_computed.value, // ['R1D-H', 'RM-M', 'R2-L', 'R1D-L', 'R2-H', 'R1D-M']
  narrow: facts.city_width_not_area.value, // 428
  whatif: facts.scenario_s1_two.value, // 196
  width: facts.lot25_two_width.value, // 4
  quote: 140, // $/sf, the builder's quote typed in beat B16
  quoteGap: '$23.1k–$48.1k', // 189,000 × 1.26 + 25,000 / 50,000 − 240,000, per home before land
  quoteLeft: '$51k', // 240,000 − 1,350 sf × 140 (after building only)
  letters: 4,
};
if (MUTATE) Object.assign(E, { districts: [...E.districts, 'R3-M'], narrow: E.narrow + 1, whatif: E.whatif + 1, width: E.width + 1, quoteGap: '$24.1k–$49.1k', quoteLeft: '$52k', letters: 5 });

const n = (x) => x.toLocaleString('en-US');
const norm = (s) => s.replace(/[‑‐]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const results = [];
const check = (name, ok, detail, kind = 'value') => {
  results.push({ name, ok: !!ok, detail, kind });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `: ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 160)}`));
page.on('pageerror', (e) => problems.push(`uncaught: ${String(e.message).slice(0, 160)}`));
page.on('response', (r) => r.url().startsWith(origin) && r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url().slice(origin.length)}`));

const open = async (q) => {
  await page.goto(`${BASE}?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
};
/** The text of `sel` once it matches `re` (or whatever it says after `ms`). */
const textWhen = async (sel, re, ms = 20000) => {
  const end = Date.now() + ms;
  let t = '';
  while (Date.now() < end) {
    t = norm(await page.locator(sel).first().innerText({ timeout: 1000 }).catch(() => ''));
    if (re.test(t)) return t;
    await page.waitForTimeout(250);
  }
  return t;
};

console.log(`smoke test: ${BASE}${MUTATE ? '  (--mutate: every value check below must FAIL)' : ''}\n`);
try {
  // The city view: the signed districts and the headline count.
  await open('view=city&type=two');
  const stamp = await textWhen('.ws-status .stamp', /DISTRICTS/i);
  check(`city: checked in ${E.districts.length} districts`, stamp.toUpperCase().includes(`CHECKED IN ${E.districts.length} DISTRICTS`), `stamp "${stamp}"`);
  const tile = await textWhen('[data-tile="narrow"]', /\d/);
  check(`city: ${n(E.narrow)} too narrow`, new RegExp(`\\b${n(E.narrow)}\\b`).test(tile), `tile "${tile}"`);
  await open('view=city&type=two&tab=rules');
  const rules = await textWhen('[data-tabpanel="rules"]', /Computed for/);
  const computed = (rules.match(/Computed for (.*?) only/)?.[1] ?? '').split(/, | and /).map((d) => d.trim()).filter(Boolean).sort();
  check(`city: the districts are ${E.districts.join(', ')}`, JSON.stringify(computed) === JSON.stringify([...E.districts].sort()), `the Rules tab computes ${computed.join(', ') || 'nothing'}`);

  // The rule what-if.
  await open('view=city&type=two&tab=whatif&whatif=S1');
  const s1 = await textWhen('[data-whatif="S1"]', /Opens \d/);
  check(`what-if S1 opens ${n(E.whatif)} lots`, s1.includes(`Opens ${n(E.whatif)} City-owned lots for a two-unit house`), `"${s1.match(/Opens [^·]*/)?.[0] ?? s1.slice(0, 80)}"`);

  // Lot 25.
  await open('view=lot&block=10K&lot=25&type=two');
  const lead = await textWhen('main', /The rules leave only/);
  check(`lot 25 leaves ${E.width} ft for a two-unit house`, lead.includes(`The rules leave only ${E.width} ft to build on`), `"${lead.match(/The rules leave only[^,;.]*/)?.[0] ?? 'no such sentence'}"`);

  // The builder's quote flips the verdict (film beat B16).
  const combo = 'view=lot&block=10K&lot=25&type=three&lots=25,26,27';
  await open(combo);
  const before = await textWhen('.ws-status .stamp', /\w/);
  const leftBefore = await textWhen('[data-tile="left"] .ws-tile-value', /\$/);
  await open(`${combo}&quote=${E.quote}`);
  const after = await textWhen('.ws-status .stamp', /builder/i);
  const leftAfter = await textWhen('[data-tile="left"] .ws-tile-value', /\$/);
  const flagged = await page.locator('.ws-status .stamp[data-quote="1"]').count();
  const sentence = await textWhen('.ws-sentence', /subsidy|covers/);
  check(`quote $${E.quote}/sf: a home needs ${E.quoteGap} before land`, flagged && before !== after && sentence.includes(E.quoteGap), `"${after}" · "${sentence.slice(0, 140)}"`);
  check(`quote $${E.quote}/sf leaves ${E.quoteLeft}`, leftAfter === E.quoteLeft && leftBefore !== leftAfter, `left after building ${leftBefore} → ${leftAfter}`);

  // The letters.
  await open(`view=inquiry&block=10K&lot=25&type=three&lots=25,26,27`);
  const draft = await textWhen('.iq-stamp', /SEND/i);
  const trace = await textWhen('#iq-check p', /✓|✗/);
  check('letters: a draft the user sends', /DRAFT/i.test(draft) && /YOU SEND IT/i.test(draft), `stamp "${draft}"`, 'page');
  check(`letters: ${E.letters} letters, every number traced`, new RegExp(`all \\d+ numbers in ${E.letters} letters trace to the engine ✓`).test(trace), `"${trace}"`);

  // The static API and the files a link preview needs.
  const get = async (path) => {
    const r = await page.request.get(`${BASE}${path}`);
    const type = r.headers()['content-type'] ?? '';
    let json = null; // a missing file comes back as the app's own page (HTTP 200, text/html) on hosts with an SPA fallback
    if (/json/.test(type)) json = await r.json().catch(() => null);
    return { status: r.status(), type, json };
  };
  const sum = await get('api/city/summary.json');
  const two = sum.json?.by_type?.two;
  check(`api/city/summary.json: ${n(E.narrow)} too narrow`, two?.widthNotArea === E.narrow, `HTTP ${sum.status}, widthNotArea ${two?.widthNotArea}`);
  const lot = await get('api/lots/0010K00025000000.json');
  check('api/lots/<pin>.json serves lot 25', lot.json?.pin === '0010K00025000000', `HTTP ${lot.status} ${lot.type}`, 'page');
  for (const f of ['og.png', 'favicon.svg', 'apple-touch-icon.png']) {
    const r = await get(f);
    check(`${f} served`, r.status === 200 && /image\//.test(r.type), `HTTP ${r.status} ${r.type}`, 'page');
  }
  await open('view=city&type=two');
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  const absolute = /^https:\/\//.test(og ?? '');
  if (absolute || !/^https:/.test(BASE)) console.log(`${absolute ? '✓' : '·'} og:image ${og}${absolute ? '' : ' (relative: fine locally; a deployed build takes SITE_URL or Vercel’s domain)'}`);
  else check('og:image is an absolute URL (link previews need one)', false, `"${og}": set SITE_URL for the build`, 'page');

  // A phone.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(`${BASE}?view=lot&block=10K&lot=25&type=two`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(2500);
  const wide = await phone.evaluate(() => document.scrollingElement.scrollWidth);
  check('a 390 px phone: no sideways scroll on the lot page', wide <= 390, `page width ${wide}px`, 'page');
} catch (e) {
  check('the checks ran to the end', false, String(e.message ?? e).split('\n')[0], 'page');
}
check('no console errors, uncaught errors or failed requests to the site', problems.length === 0, problems.slice(0, 5).join(' | ') || 'none', 'page');
await browser.close();

const failed = results.filter((r) => !r.ok);
if (MUTATE) {
  const values = results.filter((r) => r.kind === 'value');
  const missed = values.filter((r) => r.ok);
  console.log(missed.length ? `\n✗ --mutate: ${missed.length} value checks still passed with wrong values: ${missed.map((r) => r.name).join('; ')}` : `\n✓ --mutate: all ${values.length} value checks failed on the wrong values, so they can fail`);
  process.exit(missed.length ? 1 : 0);
}
console.log(failed.length ? `\n✗ ${failed.length} of ${results.length} checks failed` : `\n✓ all ${results.length} checks passed at ${BASE}`);
process.exit(failed.length ? 1 : 0);
