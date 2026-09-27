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
// The workspace (spec §0.15) never scrolls the page: panels scroll inside. `reveal` scrolls the element's
// own panel (the inspector's tab body) so it sits near the top; `openTab` opens an inspector tab.
const reveal = (page, selector, smooth = true) =>
  page.evaluate(
    ([sel, sm]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ block: 'start', behavior: sm ? 'smooth' : 'auto' });
      return true;
    },
    [selector, smooth],
  );
const openTab = async (page, tab) => {
  const t = page.locator(`[role="tab"][data-tab="${tab}"]`);
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
  await page.waitForSelector(`[data-tabpanel="${tab}"]:not([hidden])`, { timeout: 4000 });
};
const must = async (ok, what) => {
  if (!(await ok)) throw new Error(`not found: ${what}`);
};

const cues = {};

// Pointer marks for the film's red pen (film v6): one box per spoken phrase, in CSS px at 1920×1080, measured
// with boundingBox() at the clip second from which the element is visible and stays put (no scrolling after t).
async function mark(page, beat, id, locator, c, note) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  const b = await el.boundingBox().catch(() => null);
  cues[beat] ??= {};
  cues[beat].marks ??= [];
  if (!b) {
    cues[beat].missing ??= [];
    cues[beat].missing.push(`${id}: not found on this screen${note ? ` (${note})` : ''}`);
    return null;
  }
  const box = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  cues[beat].marks.push({ id, t: Math.round(c.now() * 100) / 100, box, ...(note ? { note } : {}) });
  return box;
}

// A visible cursor (the recorder's video has none): a dot that follows the mouse and rings on each click.
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.id = 'demo-cursor';
    d.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(160,30,30,.85);box-shadow:0 0 0 3px rgba(255,255,255,.9);pointer-events:none;transition:transform .12s ease;opacity:0';
    document.documentElement.appendChild(d);
    addEventListener('mousemove', (e) => { d.style.opacity = '1'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { d.style.transform = 'scale(1.6)'; }, true);
    addEventListener('mouseup', () => { d.style.transform = 'scale(1)'; }, true);
  });`;
/** Move the (visible) mouse to an element smoothly, then click it. */
async function clickSlow(page, locator) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  const b = await el.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await el.click();
}
const failed = [];

const LEGACY = [
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
      await openTab(p, 'money'); // the Money tab (the default) by cue + 5: vertical cost and the three signals
      await must(reveal(p, '[data-panel="money"]'), '[data-panel="money"]');
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
    q: 'view=review&district=R1D-H&section=r1d-h.x.side_setback_exterior',
    run: async (p, c) => {
      // The first R1D-H rule: minimum lot size, §903.03.D.
      const card = p.locator('article[data-rule-id="r1d-h.x.side_setback_exterior"]');
      await card.scrollIntoViewIfNeeded();
      if (REVIEWER) {
        await c.until(5);
        await card.getByRole('button', { name: 'Sign as source-checked' }).click();
        const form = card.locator('.review-form');
        await form.getByLabel('Name').fill(REVIEWER.name);
        await form.getByLabel('Role').fill(REVIEWER.role);
        await form.getByRole('textbox', { name: /Note/ }).fill('Quote matches the saved code text');
        await c.until(10.8);
        await form.getByRole('button', { name: 'Sign as source-checked' }).click();
        await p.waitForFunction(() => document.querySelector('article[data-rule-id="r1d-h.x.side_setback_exterior"]')?.getAttribute('data-trust') === 'ink', null, { timeout: 4000 });
        const placeholder = /placeholder/i.test(REVIEWER.name) || /replace/i.test(REVIEWER.role);
        cues.B07 = {
          cue: Math.round(c.now() * 100) / 100,
          rule: 'r1d-h.x.side_setback_exterior (exterior side setback 15 ft, §903.03.D.2)',
          note: placeholder
            ? `PLACEHOLDER signature ("${REVIEWER.name}", "${REVIEWER.role}"): not a real review. Re-record with a real teammate before submission. The signature lived only in the recording browser's storage; no committed data depends on it.`
            : `signed on camera by ${REVIEWER.name} (${REVIEWER.role})`,
        };
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
      const box = await p.locator('.ws-status .stamp-refuse').first().boundingBox();
      if (!box) throw new Error('not found: the "can\'t score" stamp in the inspector header');
      if (box) cues.B09 = { mark: [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), Math.round(box.width / 2 + 18), Math.round(box.height / 2 + 14)], note: '[x, y, rx, ry] around "can\'t score" at 1920×1080, visible from the first frame' };
      await c.until(9.5);
    },
  },
  {
    id: 'B10',
    name: 'site-next-letter',
    q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27',
    first: async (p) => {
      await openTab(p, 'site');
      await must(reveal(p, '[data-panel="site"]', false), '[data-panel="site"]');
    },
    run: async (p, c) => {
      cues.B10 = { site: 0 };
      await c.until(12.6);
      await openTab(p, 'next');
      await must(reveal(p, '[data-panel="next"] .next-steps'), '[data-panel="next"] .next-steps');
      cues.B10.next_steps = 13;
      await c.until(19);
      await p.getByRole('link', { name: 'Draft the letter' }).click();
      await p.waitForSelector('.iq-item', { timeout: 8000 });
      cues.B10.letter = Math.round(c.now() * 100) / 100;
      await c.until(25);
    },
  },
  {
    // B13 (spec §0.14, C15): the citywide "Combine to fit" list, then Mahon 25–27 on the map with its inset plan.
    id: 'B13',
    name: 'assemblies',
    q: 'view=city&type=three&layer=assemble&hood=Middle+Hill&canvas=table',
    run: async (p, c) => {
      const MAHON = '0010K00025000000,0010K00026000000,0010K00027000000';
      await p.waitForSelector(`tr[data-run="${MAHON}"]`, { timeout: 8000 });
      cues.B13 = { list: 0, note: 'the Combine to fit list (Middle Hill) is on screen from the first frame' };
      await c.until(3);
      await p.locator(`tr[data-run="${MAHON}"] button`).first().click();
      cues.B13.mahon_selected = Math.round(c.now() * 100) / 100;
      await c.until(6);
      await p.getByRole('button', { name: /^Map$/ }).first().click().catch(async () => p.getByRole('link', { name: /^Map$/ }).first().click());
      await p.waitForSelector('.city-inset.is-wide', { timeout: 8000 });
      cues.B13.map_inset = Math.round(c.now() * 100) / 100;
      await c.until(12);
    },
  },
  { id: 'B11', name: 'what-changed', q: 'view=changes', run: async (p, c) => c.until(9.5) },
  { id: 'B12', name: 'limits', q: 'view=about&block=10K&section=limits', run: async (p, c) => c.until(7) },
];


// Film v6 (27 Sep): every clip moves, one thing to look at per phrase, pointer marks for the film's red pen,
// 2 s of hold at the end. Beats whose screens are still being built (B02 map zoom, B01 focus ring, B14 graph
// focus, B08 Rules tab, B10 Next tab) are recorded after that work lands.
const HOLD = 2;
const MAHON = '0010K00025000000,0010K00026000000,0010K00027000000';
const V6 = [
  {
    id: 'B07',
    name: 'ai-reads-the-code',
    q: 'view=review&district=R1D-H',
    run: async (p, c) => {
      const RULE = 'r1d-h.x.side_setback_exterior';
      const card = p.locator(`article[data-rule-id="${RULE}"]`);
      await c.until(0.6);
      await card.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })); // the page scrolls to the rule
      await c.until(1.8);
      await clickSlow(p, card.locator('button.rv-locate')); // the quote lights up in the saved code text
      await c.until(2.8);
      await mark(p, 'B07', 'quote', p.locator('mark.is-active'), c);
      // A "question for the City" on screen now: this rule's own if it has one, else the nearest visible one.
      const qs = p.locator('text=/question for the City/i');
      let qi = -1;
      for (let i = 0; i < (await qs.count()); i++) {
        const bb = await qs.nth(i).boundingBox();
        if (bb && bb.y > 60 && bb.y + bb.height < 1060) { qi = i; break; }
      }
      if (qi >= 0) await mark(p, 'B07', 'city_question', qs.nth(qi), c, 'a question for the City on another rule on this screen (this rule has none)');
      else (cues.B07 ??= {}, (cues.B07.missing ??= []).push('city_question: none visible on this screen'));
      if (REVIEWER) {
        await c.until(3.2);
        await clickSlow(p, card.getByRole('button', { name: 'Sign as source-checked' }));
        const form = card.locator('.review-form');
        await form.getByLabel('Name').pressSequentially(REVIEWER.name, { delay: 110 }); // typed visibly
        await form.getByLabel('Role').pressSequentially(REVIEWER.role, { delay: 55 });
        await form.getByRole('textbox', { name: /Note/ }).pressSequentially('Quote matches the saved code text', { delay: 30 });
        await c.until(9.6);
        await clickSlow(p, form.getByRole('button', { name: 'Sign as source-checked' }));
        await p.waitForFunction((id) => document.querySelector(`article[data-rule-id="${id}"]`)?.getAttribute('data-trust') === 'ink', RULE, { timeout: 4000 });
        cues.B07 = { ...(cues.B07 ?? {}), cue: Math.round(c.now() * 100) / 100, rule: `${RULE} (exterior side setback 15 ft, §903.03.D.2)`, note: `signed on camera as ${REVIEWER.name} (${REVIEWER.role}) in the recording browser only; not published` };
        await sleep(300);
        await mark(p, 'B07', 'sign', card.locator('[data-trust="ink"], .rv-state, .ev-ink').first(), c, 'the ink state after signing');
      } else cues.B07 = { ...(cues.B07 ?? {}), cue: null, note: 'Nobody signed on camera (REVIEWER_NAME/REVIEWER_ROLE not set).' };
      await c.until(13 + HOLD);
    },
  },
  {
    id: 'B04',
    name: 'combine',
    q: 'view=lot&block=10K&lot=25&type=two',
    run: async (p, c) => {
      await c.until(1.2);
      await clickSlow(p, p.getByRole('radio', { name: /Three.unit/ }));
      await p.waitForFunction(() => document.querySelector('.group-width, .env-width.big') !== null, null, { timeout: 5000 });
      await sleep(400); // the envelope reflow finishes
      cues.B04 = { cue: Math.round(c.now() * 100) / 100, note: 'clip second the envelope has widened to 52 ft' };
      await mark(p, 'B04', 'width_52', p.locator('.env-width.big'), c);
      await c.until(Math.max(5, cues.B04.cue + 2) + HOLD);
    },
  },
  {
    id: 'B04b',
    name: 'money',
    q: `view=lot&block=10K&lot=25&type=three&lots=25,26,27&tab=rules`,
    run: async (p, c) => {
      await c.until(0.4);
      await clickSlow(p, p.getByRole('tab', { name: /Money/ }));
      await sleep(250);
      cues.B04b = { money_tab: Math.round(c.now() * 100) / 100 };
      await mark(p, 'B04b', 'stamp', p.locator('.ws-status .stamp'), c);
      const s = await p.locator('.ws-status .stamp').boundingBox();
      if (s) await p.mouse.move(s.x + s.width / 2, s.y + s.height / 2, { steps: 20 }); // the eye goes to the stamp
      await c.until(3 + HOLD);
    },
  },
  {
    id: 'B09',
    name: 'refusal',
    q: 'view=lot&block=10K&lot=22&type=two',
    run: async (p, c) => {
      await c.until(0.5);
      const st = p.locator('.ws-status .stamp');
      const b = await st.boundingBox();
      if (b) await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
      cues.B09 = {};
      const box = await mark(p, 'B09', 'cant_score', st, c);
      if (box) cues.B09.mark = [box[0] + Math.round(box[2] / 2), box[1] + Math.round(box[3] / 2), Math.round(box[2] / 2) + 18, Math.round(box[3] / 2) + 14];
      await c.until(4 + HOLD);
    },
  },
  {
    id: 'B13',
    name: 'assemblies',
    q: 'view=city&type=three&layer=assemble&canvas=table',
    run: async (p, c) => {
      await p.waitForSelector('tr[data-run]', { timeout: 8000 });
      cues.B13 = { list: 0 };
      await mark(p, 'B13', 'count_111', p.locator('.ws-canvas-body.is-table h2').first(), c);
      // The list scrolls down to the Mahon group, then it is chosen and the map shows it with its inset plan.
      const row = p.locator(`tr[data-run="${MAHON}"]`);
      await c.until(1.2);
      await row.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await c.until(3.2);
      await clickSlow(p, row.locator('button').first());
      cues.B13.mahon_selected = Math.round(c.now() * 100) / 100;
      await c.until(4.6);
      await clickSlow(p, p.getByRole('button', { name: /^Map$/ }).first()).catch(async () => clickSlow(p, p.getByRole('link', { name: /^Map$/ }).first()));
      await p.waitForSelector('.city-inset.is-wide', { timeout: 8000 });
      cues.B13.map_inset = Math.round(c.now() * 100) / 100;
      await c.until(8 + HOLD);
    },
  },
];
const BEATS = flag('legacy') ? LEGACY : V6;

if (RECORD) mkdirSync(OUT, { recursive: true });
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
  const tmp = `${OUT}/.tmp-${beat.id}`; // used only with --record
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    ...(RECORD ? { recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } } : {}),
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const tStart = Date.now();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Light (paper) is the default whatever the OS says; dark is chosen in the link (spec §0.15).
  await page.goto(`${BASE}?${beat.q}&record=1${THEME === 'dark' ? '&theme=dark' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  if (beat.first) await beat.first(page);
  await sleep(250);
  const lead = (Date.now() - tStart) / 1000; // seconds of loading to trim from the clip's start
  const c = clock();
  try {
    await beat.run(page, c);
  } catch (e) {
    errors.push(`beat failed: ${String(e).split('\n')[0]}`);
  }
  const secs = c.now();
  if (errors.length) failed.push(`${beat.id}: ${errors.join(' | ').slice(0, 300)}`);
  const video = page.video();
  await ctx.close();
  if (RECORD && video) {
    const src = await video.path();
    const dst = `${OUT}/${beat.id}-${beat.name}`;
    if (ffmpeg) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', `${dst}.mp4`]);
      if (flag('webm')) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', lead.toFixed(2), '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', `${dst}.webm`]);
    } else execFileSync('cp', [src, `${dst}.webm`]);
    console.log(`${beat.id} ${beat.name}: ${secs.toFixed(1)} s after trimming ${lead.toFixed(2)} s of loading → ${dst}.mp4`);
  } else console.log(`${beat.id} ${beat.name}: ${secs.toFixed(1)} s (not recorded; pass --record)`);
  rmSync(tmp, { recursive: true, force: true });
}
await browser.close();
// Cue times belong to recorded clips only: a run without --record leaves cues.json alone.
if (RECORD) {
  writeFileSync(cuesPath, JSON.stringify({ ...prior, ...cues, _note: 'Seconds from the start of each trimmed clip in film/clips/. Written by scripts/demo.mjs.' }, null, 1) + '\n');
  console.log(`cues → ${cuesPath}: ${JSON.stringify(cues)}`);
} else console.log(`cues (not written; pass --record): ${JSON.stringify(cues)}`);
if (failed.length) {
  for (const f of failed) console.log(`✗ ${f}`);
  process.exit(1);
}
console.log('every beat reached its end without errors');
