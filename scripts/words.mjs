// Spec §0.15 checks for the workspace, with Playwright at 1440×900:
//   - words in the inspector header plus the four tiles: ≤ 80;
//   - words visible on the whole first screen: ≤ 250;
//   - no page scroll (panels scroll inside), in both themes, and in record mode (1920×1080);
//   - no console errors.
// A word is a whitespace-separated token with at least one letter ("52", "$240k" and "4′" are figures,
// not words; they are counted separately and reported). A token counts as visible when its box is inside
// the viewport and inside every ancestor that clips (a scrolled panel shows only what is in view).
// Usage: node scripts/words.mjs [--base http://localhost:5173/] [--verbose]
import { chromium } from 'playwright';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5173/');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_HEAD = 80;
const LIMIT_SCREEN = 250;

export const URLS = [
  'view=lot&block=10K&lot=25&type=two',
  'view=lot&block=10K&lot=25&type=three&lots=25,26,27',
  'view=city&type=two',
  'view=lot&block=10K&lot=22&type=two',
  'view=lot&block=0124P&lot=203&type=detached',
];

/** In-page: the visible tokens under `root` (or the whole body), split into words and figures. */
function countVisible(selectors) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clipCache = new Map();
  // The visible rect of an element's clipping ancestors (and the viewport).
  const clipOf = (el) => {
    if (clipCache.has(el)) return clipCache.get(el);
    let r = { l: 0, t: 0, r: vw, b: vh };
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none') {
        const b = a.getBoundingClientRect();
        r = { l: Math.max(r.l, b.left), t: Math.max(r.t, b.top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
    }
    clipCache.set(el, r);
    return r;
  };
  const out = {};
  for (const [name, sel] of Object.entries(selectors)) {
    const roots = sel ? [...document.querySelectorAll(sel)] : [document.body];
    let words = 0;
    let figures = 0;
    const sample = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || !node.textContent.trim()) continue;
        if (el.closest('script,style,noscript,title,option,select')) continue;
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const clip = clipOf(el);
        const text = node.textContent;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const b = range.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          if (cx < clip.l || cx > clip.r || cy < clip.t || cy > clip.b) continue;
          if (/\p{L}/u.test(m[0])) {
            words++;
            if (sample.length < 400) sample.push(m[0]);
          } else figures++;
        }
      }
    }
    out[name] = { words, figures, sample: sample.join(' ') };
  }
  return out;
}

const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];
const failures = [];
async function open(ctx, q) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}?${q}&still=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  await page.waitForSelector('.ws-inspector', { timeout: 10000 });
  await page.waitForTimeout(400);
  return { page, errors };
}
const scrolls = (page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return { v: d.scrollHeight - window.innerHeight, h: d.scrollWidth - window.innerWidth };
  });

for (const q of URLS) {
  const row = { url: q };
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const { page, errors } = await open(ctx, `${q}&theme=${theme}`);
    const s = await scrolls(page);
    row[`scroll ${theme}`] = s.v > 0 || s.h > 0 ? `✗ ${s.v}px down, ${s.h}px across` : 'none';
    if (s.v > 0 || s.h > 0) failures.push(`${q} (${theme}): the page scrolls ${s.v}px down and ${s.h}px across at 1440×900`);
    if (theme === 'light') {
      const c = await page.evaluate(countVisible, { head: '.ws-ins-head, .ws-tiles', screen: '' });
      row['header + tiles'] = c.head.words;
      row['first screen'] = c.screen.words;
      row.figures = c.screen.figures;
      if (c.head.words > LIMIT_HEAD) failures.push(`${q}: ${c.head.words} words in the inspector header and tiles (limit ${LIMIT_HEAD})`);
      if (c.screen.words > LIMIT_SCREEN) failures.push(`${q}: ${c.screen.words} words on the first screen (limit ${LIMIT_SCREEN})`);
      if (!c.head.words) failures.push(`${q}: no inspector header found: the check measured nothing`);
      if (VERBOSE) console.log(`\n${q}\n  header+tiles: ${c.head.sample}\n  screen: ${c.screen.sample}`);
    }
    errors.forEach((e) => failures.push(`${q} (${theme}): console error: ${e.slice(0, 160)}`));
    await ctx.close();
  }
  // Record mode: the 1440×810 layout zoomed to 1920×1080 must not scroll either.
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const { page, errors } = await open(ctx, `${q}&record=1`);
  const s = await scrolls(page);
  row['scroll record'] = s.v > 0 || s.h > 0 ? `✗ ${s.v}px down, ${s.h}px across` : 'none';
  if (s.v > 0 || s.h > 0) failures.push(`${q} (record): the page scrolls ${s.v}px down and ${s.h}px across at 1920×1080`);
  errors.forEach((e) => failures.push(`${q} (record): console error: ${e.slice(0, 160)}`));
  await ctx.close();
  rows.push(row);
}
await browser.close();
console.table(rows);
if (failures.length) {
  for (const f of failures) console.log(`✗ ${f}`);
  console.log(`${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`words: every URL within ${LIMIT_HEAD} words (header + tiles) and ${LIMIT_SCREEN} (first screen); no page scroll at 1440×900 in either theme or in record mode; no console errors`);
