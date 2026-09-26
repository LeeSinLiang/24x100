// Drives the app through STORYBOARD.md with steady timing. With --record, saves one 1920×1080 clip per
// beat to film/clips/ (Playwright recordVideo → .webm, trimmed so the first frame is the ready page,
// plus .mp4 when ffmpeg is available) and writes film/clips/cues.json with the cue times the film needs.
// Usage: node scripts/demo.mjs --record [--base http://localhost:4173/] [--only B04] [--fast] [--theme dark]
// A rule is signed on camera (B07) and an assumption recorded (B06) only if REVIEWER_NAME and
// REVIEWER_ROLE are set to a real teammate who actually checked it; otherwise the beats say so.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg('base', 'http://localhost:5173/');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const RECORD = flag('record');
const FAST = flag('fast');
const THEME = arg('theme', process.env.THEME ?? 'light');
const OUT = 'film/clips';
const REVIEWER = process.env.REVIEWER_NAME && process.env.REVIEWER_ROLE ? { name: process.env.REVIEWER_NAME, role: process.env.REVIEWER_ROLE } : null;

const heldOut = (() => {
  try {
    return JSON.parse(readFileSync('film/heldout.json', 'utf8')).link;
  } catch {
    return 'view=lot&block=0124P&lot=203&type=detached';
  }
})();

// Beat helpers. `t` is seconds since the page was ready (the trimmed clip's zero).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function clock() {
  const t0 = Date.now();
  return {
    now: () => (Date.now() - t0) / 1000,
    until: async (s) => {
      const left = s * 1000 - (Date.now() - t0);
      if (left > 0) await sleep(FAST ? Math.min(left, 400) : left);
    },
  };
}
const smoothTo = (page, selector, offset = 60) =>
  page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const z = Number(getComputedStyle(document.documentElement).zoom) || 1;
      const y = el.getBoundingClientRect().top + window.scrollY - off / z;
      window.scrollTo({ top: y, behavior: 'smooth' });
      return true;
    },
    [selector, offset],
  );

const cues = {};

const BEATS = [
  { id: 'B01', name: 'surprise', q: 'view=lot&block=10K&lot=25&type=two', run: async (p, c) => c.until(9.5) },
  { id: 'B02', name: 'not-one-lot', q: 'view=city&type=two', run: async (p, c) => c.until(11) },
  { id: 'B03', name: 'why', q: 'view=lot&block=10K&lot=25&type=two&drawer=rule:pgh.contextual_side', run: async (p, c) => c.until(16) },
  {
    id: 'B04',
    name: 'combine-money',
    q: 'view=lot&block=10K&lot=25&type=two',
    run: async (p, c) => {
      await c.until(2);
      await p.getByRole('radio', { name: /Three.unit/ }).click();
      await p.waitForFunction(() => document.querySelector('.group-width') !== null, null, { timeout: 5000 });
      await sleep(340); // the envelope reflow finishes (≤ 400 ms in record mode)
      const cue = c.now();
      cues.B04 = { cue: Math.round(cue * 100) / 100, note: 'clip second the envelope has widened to 52 ft' };
      await c.until(cue + 4.4);
      await smoothTo(p, '[data-panel="money"]', 24); // money panel open by cue + 5: vertical cost and the three signals
      cues.B04.money_panel = Math.round((cue + 5) * 100) / 100;
      cues.B04.subsidy_visible = Math.round((cue + 5) * 100) / 100; // the stamp and "at least $X" sit in the same view
      await c.until(cue + 37);
    },
  },
  { id: 'B05', name: 'open-question', q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached', run: async (p, c) => c.until(16) },
  {
    id: 'B06',
    name: 'assume',
    q: REVIEWER ? 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached' : 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&assume=q.single_unit_includes_attached:yes',
    run: async (p, c) => {
      if (REVIEWER) {
        await c.until(2);
        await p.getByRole('button', { name: 'Assume yes' }).click();
        await p.getByLabel('Name').fill(REVIEWER.name);
        await p.getByLabel('Role').fill(REVIEWER.role);
        await p.getByRole('button', { name: /Assume yes \(red\)/ }).click();
        await p.keyboard.press('Escape');
      }
      await c.until(12);
    },
  },
  {
    id: 'B07',
    name: 'ai-reads-the-code',
    q: 'view=review&district=R1D-H',
    run: async (p, c) => {
      if (REVIEWER) {
        await c.until(6);
        const sign = p.getByRole('button', { name: 'Sign as source-checked' }).first();
        if (await sign.count()) {
          await sign.click();
          await p.getByLabel('Name').first().fill(REVIEWER.name);
          await p.getByLabel('Role').first().fill(REVIEWER.role);
          await p.getByLabel(/Note/).first().fill('Compared with the saved §903.03.D table row.');
          await c.until(10.8);
          await p.getByRole('button', { name: 'Sign as source-checked' }).last().click();
          const placeholder = /placeholder/i.test(REVIEWER.name) || /replace/i.test(REVIEWER.role);
          cues.B07 = {
            cue: Math.round(c.now() * 100) / 100,
            note: placeholder
              ? `PLACEHOLDER signature ("${REVIEWER.name}", "${REVIEWER.role}"): not a real review. Re-record with a real teammate before submission. The signature lived only in the recording browser's storage; no committed data depends on it.`
              : `signed on camera by ${REVIEWER.name} (${REVIEWER.role})`,
          };
        }
      } else cues.B07 = { cue: null, note: 'Nobody signed on camera (REVIEWER_NAME/REVIEWER_ROLE not set). Cut the "signs" line, or re-record with a real teammate.' };
      await c.until(22);
    },
  },
  { id: 'B08', name: 'held-out', q: heldOut, run: async (p, c) => c.until(9.5) },
  {
    id: 'B09',
    name: 'refusal',
    q: 'view=lot&block=10K&lot=22&type=two',
    run: async (p, c) => {
      const box = await p.locator('.numeral-block .stamp-refuse').first().boundingBox();
      if (box) cues.B09 = { mark: [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), Math.round(box.width / 2 + 18), Math.round(box.height / 2 + 14)], note: '[x, y, rx, ry] around "can\'t score" at 1920×1080, visible from the first frame' };
      await c.until(9.5);
    },
  },
  {
    id: 'B10',
    name: 'site-next-letter',
    q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27',
    scrollFirst: '[data-panel="site"]',
    run: async (p, c) => {
      cues.B10 = { site: 0 };
      await c.until(12.6);
      await smoothTo(p, '[data-panel="next"] .next-steps', 120);
      cues.B10.next_steps = 13;
      await c.until(19);
      await p.getByRole('link', { name: 'Draft the letter' }).click();
      await p.waitForSelector('.iq-item', { timeout: 8000 });
      cues.B10.letter = Math.round(c.now() * 100) / 100;
      await c.until(25);
    },
  },
  { id: 'B11', name: 'what-changed', q: 'view=changes', run: async (p, c) => c.until(9.5) },
  { id: 'B12', name: 'limits', q: 'view=about&block=10K&section=limits', run: async (p, c) => c.until(7) },
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
const cuesPath = `${OUT}/cues.json`;
const prior = existsSync(cuesPath) ? JSON.parse(readFileSync(cuesPath, 'utf8')) : {};
for (const beat of BEATS) {
  if (ONLY.length && !ONLY.includes(beat.id)) continue;
  const tmp = `${OUT}/.tmp-${beat.id}`;
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: THEME === 'dark' ? 'dark' : 'light',
    ...(RECORD ? { recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } } : {}),
  });
  const page = await ctx.newPage();
  const tStart = Date.now();
  await page.goto(`${BASE}?${beat.q}&record=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  if (beat.scrollFirst) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const z = Number(getComputedStyle(document.documentElement).zoom) || 1;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24 / z });
    }, beat.scrollFirst);
  }
  await sleep(250);
  const lead = (Date.now() - tStart) / 1000; // seconds of loading to trim from the clip's start
  const c = clock();
  await beat.run(page, c);
  const secs = c.now();
  const video = page.video();
  await ctx.close();
  if (RECORD && video) {
    const src = await video.path();
    const dst = `${OUT}/${beat.id}-${beat.name}`;
    if (ffmpeg) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', `${dst}.mp4`]);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', `${dst}.webm`]);
    } else execFileSync('cp', [src, `${dst}.webm`]);
    console.log(`${beat.id} ${beat.name}: ${secs.toFixed(1)} s after trimming ${lead.toFixed(2)} s of loading → ${dst}.mp4`);
  } else console.log(`${beat.id} ${beat.name}: ${secs.toFixed(1)} s (not recorded; pass --record)`);
  rmSync(tmp, { recursive: true, force: true });
}
await browser.close();
writeFileSync(cuesPath, JSON.stringify({ ...prior, ...cues, _note: 'Seconds from the start of each trimmed clip in film/clips/. Written by scripts/demo.mjs.' }, null, 1) + '\n');
console.log(`cues → ${cuesPath}: ${JSON.stringify(cues)}`);
