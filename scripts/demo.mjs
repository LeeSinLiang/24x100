// Drives the app through STORYBOARD.md with steady timing. With --record, saves one 1920×1080 clip per
// beat to film/clips/ (Playwright recordVideo → .webm, plus .mp4 when ffmpeg is available).
// Usage: node scripts/demo.mjs --record [--base http://localhost:4173/] [--only B04] [--fast]
// Reviews in beats B06/B07 are signed only if REVIEWER_NAME and REVIEWER_ROLE are set to a real
// teammate who actually checked the rule; otherwise the beat shows the page-link assumption / the form.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg('base', 'http://localhost:5173/');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const RECORD = flag('record');
const FAST = flag('fast');
const OUT = 'film/clips';
const REVIEWER = process.env.REVIEWER_NAME && process.env.REVIEWER_ROLE ? { name: process.env.REVIEWER_NAME, role: process.env.REVIEWER_ROLE } : null;

const heldOut = (() => {
  try {
    return JSON.parse(readFileSync('film/facts.json', 'utf8')).held_out_link?.value ?? null;
  } catch {
    return null;
  }
})();

const hold = (page, s) => page.waitForTimeout(FAST ? Math.min(1500, s * 1000) : s * 1000);
const click = async (page, locator) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
};

const BEATS = [
  { id: 'B01', name: 'surprise', secs: 16, q: 'view=lot&block=10K&lot=25&type=two', run: async (p) => hold(p, 16) },
  { id: 'B02', name: 'not-one-lot', secs: 16, q: 'view=city&type=two', run: async (p) => hold(p, 16) },
  { id: 'B03', name: 'why', secs: 16, q: 'view=lot&block=10K&lot=25&type=two&drawer=rule:pgh.contextual_side', run: async (p) => hold(p, 16) },
  {
    id: 'B04',
    name: 'combine',
    secs: 28,
    q: 'view=lot&block=10K&lot=25&type=two',
    run: async (p) => {
      await hold(p, 4);
      await click(p, p.getByRole('radio', { name: /Three-unit/ }));
      await hold(p, 12);
      await p.locator('.money-wall').scrollIntoViewIfNeeded();
      await hold(p, 12);
    },
  },
  { id: 'B05', name: 'open-question', secs: 16, q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached', run: async (p) => hold(p, 16) },
  {
    id: 'B06',
    name: 'assume',
    secs: 12,
    q: REVIEWER ? 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached' : 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&assume=q.single_unit_includes_attached:yes',
    run: async (p) => {
      if (REVIEWER) {
        await hold(p, 2);
        await click(p, p.getByRole('button', { name: 'Assume yes' }));
        await p.getByLabel('Name').fill(REVIEWER.name);
        await p.getByLabel('Role').fill(REVIEWER.role);
        await click(p, p.getByRole('button', { name: /Assume yes \(red\)/ }));
        await p.keyboard.press('Escape');
      }
      await hold(p, REVIEWER ? 8 : 12);
    },
  },
  {
    id: 'B07',
    name: 'ai-reads-the-code',
    secs: 22,
    q: 'view=review&district=R1D-H',
    run: async (p) => {
      await hold(p, 6);
      if (REVIEWER) {
        const sign = p.getByRole('button', { name: 'Sign as source-checked' }).first();
        if (await sign.count()) {
          await click(p, sign);
          await p.getByLabel('Name').first().fill(REVIEWER.name);
          await p.getByLabel('Role').first().fill(REVIEWER.role);
          await p.getByLabel(/Note/).first().fill('Compared with the saved §903.03.D table row.');
          await click(p, p.getByRole('button', { name: 'Sign as source-checked' }).last());
        }
      }
      await hold(p, 14);
    },
  },
  { id: 'B08', name: 'held-out', secs: 14, q: heldOut ?? 'view=lot&block=0124P&type=detached', run: async (p) => hold(p, 14) },
  { id: 'B09', name: 'refusal', secs: 10, q: 'view=lot&block=10K&lot=22&type=two', run: async (p) => hold(p, 10) },
  { id: 'B10', name: 'letter', secs: 16, q: 'view=inquiry&block=10K&lot=25&type=three&lots=25,26,27', run: async (p) => hold(p, 16) },
  { id: 'B11', name: 'what-changed', secs: 8, q: 'view=changes', run: async (p) => hold(p, 8) },
  { id: 'B12', name: 'limits', secs: 6, q: 'view=about&block=10K&section=limits', run: async (p) => hold(p, 6) },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
for (const beat of BEATS) {
  if (ONLY.length && !ONLY.includes(beat.id)) continue;
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: process.env.THEME === 'dark' ? 'dark' : 'light',
    ...(RECORD ? { recordVideo: { dir: `${OUT}/.tmp`, size: { width: 1920, height: 1080 } } } : {}),
  });
  const page = await ctx.newPage();
  const url = `${BASE}?${beat.q}&record=1`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  await beat.run(page);
  const video = page.video();
  await ctx.close();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (RECORD && video) {
    const src = await video.path();
    const dst = `${OUT}/${beat.id}-${beat.name}.webm`;
    renameSync(src, dst);
    if (ffmpeg) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', dst, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', dst.replace(/\.webm$/, '.mp4')]);
    }
    console.log(`${beat.id} ${beat.name}: ${secs}s → ${dst}${ffmpeg ? ' (+ .mp4)' : ''}`);
  } else console.log(`${beat.id} ${beat.name}: ${secs}s (not recorded; pass --record)`);
}
await browser.close();
if (existsSync(`${OUT}/.tmp`)) execFileSync('rm', ['-rf', `${OUT}/.tmp`]);
