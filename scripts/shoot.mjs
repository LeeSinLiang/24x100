// Screenshots of every storyboard state at 1440×900 and 390×844, in both themes.
// Usage: node scripts/shoot.mjs [--base http://localhost:5173] [--only B01,B04] [--out out/shots] [--sizes desktop,phone] [--themes light,dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5173/');
const OUT = arg('out', 'out/shots');
const ONLY = arg('only', '')?.split(',').filter(Boolean);
const SIZES = arg('sizes', 'desktop,phone').split(',');
const THEMES = arg('themes', 'light,dark').split(',');
const EXTRA = arg('extra', '');

export const STATES = [
  { id: 'B01', name: 'lot25-two', q: 'view=lot&block=10K&lot=25&type=two' },
  { id: 'B02', name: 'city', q: 'view=city&type=two' },
  { id: 'B03', name: 'lot25-why', q: 'view=lot&block=10K&lot=25&type=two&drawer=rule:pgh.contextual_side' },
  { id: 'B04', name: 'lot25-combined', q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27' },
  { id: 'B05', name: 'lot25-row-open', q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached' },
  { id: 'B06', name: 'lot25-row-assumed', q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&assume=q.single_unit_includes_attached:yes' },
  { id: 'B07', name: 'review-r1dh', q: 'view=review&district=R1D-H' },
  { id: 'B08', name: 'heldout', q: 'view=lot&block=0124P&type=detached' },
  { id: 'B09', name: 'lot22-refusal', q: 'view=lot&block=10K&lot=22&type=two' },
  { id: 'B10', name: 'inquiry', q: 'view=inquiry&block=10K&lot=25&type=three&lots=25,26,27' },
  { id: 'B11', name: 'changes', q: 'view=changes' },
  { id: 'B12', name: 'limits', q: 'view=about&block=10K&section=limits' },
];

const SIZE = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 }, record: { width: 1920, height: 1080 } };

const browser = await chromium.launch({ channel: 'chrome' });
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const st of STATES) {
  if (ONLY.length && !ONLY.includes(st.id)) continue;
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: SIZE[size], colorScheme: theme, deviceScaleFactor: size === 'phone' ? 2 : 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const url = `${BASE}?${st.q}${EXTRA ? `&${EXTRA}` : ''}${size === 'record' ? '&record=1' : ''}&still=1`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(250);
      const file = `${OUT}/${st.id}-${st.name}-${size}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: size === 'phone' || arg('full', '') === '1' });
      if (errors.length) console.log(`! ${file}: ${errors.slice(0, 3).join(' | ')}`);
      n++;
      await ctx.close();
    }
  }
}
await browser.close();
console.log(`${n} screenshots → ${OUT}`);
