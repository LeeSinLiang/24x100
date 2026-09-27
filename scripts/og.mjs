// The link preview (OpenGraph / Twitter card, 1200×630) and the favicons, drawn from the app itself: a real crop of
// the city map beside the city view's own headline sentence, its numbers read from film/facts.json (scripts/facts.ts,
// the engine's). Re-run after the numbers change:
//   node scripts/og.mjs [--base http://localhost:5173/]
// Writes web/public/og.png, favicon.svg, favicon-32.png and apple-touch-icon.png (committed; Vite copies them to the
// site root).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const i = process.argv.indexOf('--base');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:5173/';
const OUT = 'web/public';
const facts = JSON.parse(readFileSync('film/facts.json', 'utf8')).facts;
const narrow = facts.city_width_not_area.display; // 428
const districts = String(facts.city_districts_computed.value ?? facts.city_districts_computed.display).split(',').length; // 6

// The mark: a 24-ft lot between its neighbours, the buildable strip in red (the same drawing as the app's tab icon).
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="22" fill="#F2EEE5" stroke="#1E1A15" stroke-width="2"/><path d="M12 5v22M20 5v22" stroke="#1E1A15" stroke-width="1.2"/><path d="M14 12h4v12h-4z" fill="#B01E33"/></svg>\n`;
writeFileSync(`${OUT}/favicon.svg`, FAVICON);

const browser = await chromium.launch({ channel: 'chrome' });

// The map, as the app draws it (the camera's buttons hidden).
const app = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await app.goto(`${BASE}?view=city&type=two`);
await app.waitForSelector('svg.city-svg');
await app.addStyleTag({ content: '.map-controls{display:none!important}' });
await app.evaluate(() => document.fonts.ready);
await app.waitForTimeout(1500);
const map = (await app.locator('svg.city-svg').first().screenshot()).toString('base64');
const said = (await app.getByText(/checked so far/).first().innerText()).replace(/\s+/g, ' ').trim();
if (!said.includes(` ${narrow} `) || !said.includes(`${districts} districts`)) throw new Error(`the city view says "${said}", not ${narrow}: rebuild film/facts.json (npx tsx scripts/facts.ts) first`);

const card = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=Public+Sans:wght@400;500&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#ece7db;color:#1e1a15}
  .frame{position:absolute;inset:22px;border:2px solid #1e1a15;display:grid;grid-template-columns:430px 1fr;gap:28px;padding:34px 30px 30px 40px;box-sizing:border-box}
  .mark{display:inline-block;border:2px solid #1e1a15;padding:8px 16px 6px;text-align:center}
  .mark b{font:400 40px/1 'Old Standard TT',serif;letter-spacing:.02em;display:block}
  .mark i{font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.24em;font-style:normal;display:block;margin-top:6px}
  h1{font:400 30px/1.25 'Old Standard TT',serif;margin:34px 0 0}
  h1 strong{font-weight:700;color:#b01e33}
  p{font:400 17px/1.45 'Public Sans',sans-serif;margin:20px 0 0;color:#3b352d}
  .foot{position:absolute;left:40px;bottom:30px;font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.2em;text-transform:uppercase}
  .map{align-self:center;border:1px solid #1e1a15;background:#f2eee5}
  .map img{display:block;width:100%}
</style></head><body><div class="frame">
  <div>
    <div class="mark"><b>24×100</b><i>PITTSBURGH LOT ATLAS</i></div>
    <h1>In the ${districts} districts checked so far, <strong>${narrow}</strong> City-owned lots are big enough for a two-unit house but too narrow.</h1>
    <p>What a Pittsburgh lot can hold, what's holding it back, and what would move it, with each number traced to its source.</p>
    <div class="foot">City-owned vacant lots · checked lot by lot</div>
  </div>
  <div class="map"><img src="data:image/png;base64,${map}"></div>
</div></body></html>`;

const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(card, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${OUT}/og.png` });

// The favicons as PNG, for browsers and home screens that don't take SVG.
for (const [name, px] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
  const p = await (await browser.newContext({ viewport: { width: px, height: px } })).newPage();
  const pad = name.startsWith('apple') ? 18 : 0; // iOS rounds the corners: keep the drawing inside
  await p.setContent(`<body style="margin:0;background:#ece7db;display:grid;place-items:center;width:${px}px;height:${px}px">${FAVICON.replace('<svg ', `<svg width="${px - 2 * pad}" height="${px - 2 * pad}" `)}</body>`);
  await p.screenshot({ path: `${OUT}/${name}` });
}
await browser.close();
console.log(`wrote ${OUT}/og.png (1200×630: ${districts} districts, ${narrow} too narrow), favicon.svg, favicon-32.png, apple-touch-icon.png`);
