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
async function mark(page, beat, id, locator, c, note, opts = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  // tight: the box of the text itself (a Range over the element's contents), not the element's full width; the
  // film's camera pushes in on it. Same coordinate space as boundingBox() (checked under record-mode zoom).
  const b = opts.tight
    ? await el
        .evaluate((e) => {
          const g = document.createRange();
          g.selectNodeContents(e);
          const t = g.getBoundingClientRect();
          return t.width && t.height ? { x: t.x, y: t.y, width: t.width, height: t.height } : null;
        })
        .catch(() => null)
    : await el.boundingBox().catch(() => null);
  cues[beat] ??= {};
  cues[beat].marks ??= [];
  if (!b) {
    cues[beat].missing ??= [];
    cues[beat].missing.push(`${id}: not found on this screen${note ? ` (${note})` : ''}`);
    return null;
  }
  return pushMark(page, beat, id, [b.x, b.y, b.width, b.height], c, note);
}
function pushMark(page, beat, id, b, c, note) {
  const box = b.map((v) => Math.round(v));
  cues[beat].marks.push({ id, t: Math.round(c.now() * 100) / 100, box, ...(note ? { note } : {}) });
  // SHOTS=dir: a screenshot per mark with its box drawn, to check the boxes by eye (dry runs only: it costs time).
  if (process.env.SHOTS && !RECORD)
    return page
      .evaluate((bx) => {
        const d = document.createElement('div');
        d.className = 'demo-shot-box';
        const k = parseFloat(document.documentElement.style.zoom || getComputedStyle(document.documentElement).zoom) || 1; // record mode zooms the root
        d.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;outline:3px solid #0a0;left:${bx[0] / k}px;top:${bx[1] / k}px;width:${bx[2] / k}px;height:${bx[3] / k}px`;
        document.documentElement.appendChild(d);
      }, box)
      .then(() => page.screenshot({ path: `${process.env.SHOTS}/${beat}-${id}.png` }))
      .then(() => page.evaluate(() => document.querySelectorAll('.demo-shot-box').forEach((e) => e.remove())))
      .then(() => box);
  return box;
}
/** One box around every element the selector matches that is on screen (a row of things, one mark). */
async function markUnion(page, beat, id, selector, c, note) {
  const b = await page.evaluate((sel) => {
    const rs = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height && r.bottom > 0 && r.top < innerHeight);
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.left));
    const y0 = Math.min(...rs.map((r) => r.top));
    return [x0, y0, Math.max(...rs.map((r) => r.right)) - x0, Math.max(...rs.map((r) => r.bottom)) - y0];
  }, selector);
  cues[beat] ??= {};
  cues[beat].marks ??= [];
  if (!b) {
    (cues[beat].missing ??= []).push(`${id}: not found on this screen${note ? ` (${note})` : ''}`);
    return null;
  }
  return pushMark(page, beat, id, b, c, note);
}
const at = (c) => Math.round(c.now() * 100) / 100;

// A visible mouse pointer (the recorder's video has none; Sin: "show the actual cursor clicking and navigating").
// The standard arrow (white, black outline, soft shadow), about 34 px tall in the 1920×1080 frame, its tip on the
// point; the pointing hand wherever the page itself shows one (a link, a button, a clickable lot); on a press it
// dips and a ring spreads from the tip. Record mode zooms the root (App.tsx) and the pointer lives in it, so its
// position and size are divided by that zoom.
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    const zoom = () => parseFloat(root.style.zoom || getComputedStyle(root).zoom) || 1;
    const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="34" viewBox="0 0 23 34"><path d="M1.5 1.5 L1.5 27.2 L7.6 21.4 L11.6 31.4 L16 29.6 L12 19.8 L20.4 19.8 Z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    const HAND = '<svg xmlns="http://www.w3.org/2000/svg" width="27" height="34" viewBox="0 0 27 34"><path d="M9.5 1.5c-1.5 0-2.7 1.2-2.7 2.7v13.4l-1.9-2c-1.1-1.1-2.8-1.2-3.8-.1-1 1-1 2.5-.1 3.6l6.3 8.1c1.7 2.2 4 3.4 6.8 3.4h2.4c4.3 0 7.8-3.5 7.8-7.8v-8.4c0-1.4-1.1-2.5-2.5-2.5-.6 0-1.2.2-1.6.6-.3-1.1-1.3-1.9-2.5-1.9-.7 0-1.3.3-1.8.7-.4-1-1.3-1.6-2.4-1.6-.4 0-.8.1-1.2.3V4.2c0-1.5-1.2-2.7-2.8-2.7z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/><path d="M12.3 14.6v5.4M16.6 15.5v4.6M20.7 16.8v3.4" stroke="#111" stroke-width="1.3" stroke-linecap="round"/></svg>';
    const TIP = { arrow: [1.5, 1.5], hand: [9.5, 1.5] };
    const d = document.createElement('div');
    d.id = 'demo-cursor';
    d.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;transform-origin:0 0;filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.45));opacity:0;line-height:0;transition:transform .09s ease-out';
    root.appendChild(d);
    let kind = '', press = 1, x = 0, y = 0;
    const place = () => {
      const k = zoom(), t = TIP[kind];
      d.style.left = x / k + 'px';
      d.style.top = y / k + 'px';
      d.style.transform = 'translate(' + (-t[0] * press) / k + 'px,' + (-t[1] * press) / k + 'px) scale(' + press / k + ')';
    };
    const CLICKABLE = 'a[href],button:not(:disabled),[role=tab],[role=radio],[role=button],select,summary,label,input[type=checkbox],input[type=radio]';
    const set = (k) => { if (k !== kind) { kind = k; d.innerHTML = k === 'hand' ? HAND : ARROW; } };
    set('arrow');
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      const t = e.target instanceof Element ? e.target : null;
      set(t && (getComputedStyle(t).cursor === 'pointer' || t.closest(CLICKABLE)) ? 'hand' : 'arrow');
      d.style.opacity = '1';
      place();
    }, true);
    addEventListener('mousedown', () => {
      press = 0.9; place();
      const k = zoom(), r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;box-sizing:border-box;left:' + (x - 20) / k + 'px;top:' + (y - 20) / k + 'px;width:' + 40 / k + 'px;height:' + 40 / k + 'px;border:' + 2.5 / k + 'px solid rgba(17,17,17,.8);box-shadow:0 0 0 ' + 1.5 / k + 'px rgba(255,255,255,.85)';
      root.appendChild(r);
      r.animate([{ transform: 'scale(.15)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }], { duration: 350, easing: 'ease-out' }).onfinish = () => r.remove();
    }, true);
    addEventListener('mouseup', () => { press = 1; place(); }, true);
  });`;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Move the pointer to (x, y) along a slight arc, eased, so the eye can follow it (never a jump); then rest. */
async function glide(page, x, y, { steps = 26, rest = 0 } = {}) {
  const [x0, y0] = page.__pt ?? [x, y];
  const dx = x - x0;
  const dy = y - y0;
  if (Math.hypot(dx, dy) < 2 || FAST) await page.mouse.move(x, y);
  else {
    const cx = x0 + dx / 2 - dy * 0.1; // the arc's control point, off the straight line
    const cy = y0 + dy / 2 + dx * 0.1;
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      await page.mouse.move((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y);
      await sleep(16);
    }
  }
  page.__pt = [x, y];
  if (rest && !FAST) await sleep(rest * 1000);
}
/** Glide to the middle of an element (or a point inside it, as fractions of its box) and rest there. */
async function hoverSlow(page, locator, { fx = 0.5, fy = 0.5, rest = 0.6 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  const b = await el.boundingBox();
  if (b) await glide(page, b.x + b.width * fx, b.y + b.height * fy, { rest });
  return b;
}
/** Glide to an element, settle, then click it where the pointer is. */
async function clickSlow(page, locator) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator.first();
  const b = await el.boundingBox();
  if (b) await glide(page, b.x + b.width / 2, b.y + b.height / 2, { rest: 0.3 });
  await el.click();
  if (b) page.__pt = [b.x + b.width / 2, b.y + b.height / 2];
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
// 2 s of hold at the end. Round 3 (map zoom, the plate's selection, graph focus, the Rules and Next tabs) adds
// B02, B01, B14, B08 and B10.
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
      if (s) await glide(p, s.x + s.width / 2, s.y + s.height / 2, { rest: 0.6 }); // the eye goes to the stamp
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
      if (b) await glide(p, b.x + b.width / 2, b.y + b.height / 2, { rest: 0.6 });
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
      await mark(p, 'B13', 'count_111', p.locator('.ws-canvas-body.is-table h2').first(), c, 'the heading; it scrolls away with the list', { tight: true });
      await mark(p, 'B13', 'count_111_tile', p.locator('[data-tile="runs"] .ws-tile-value, [data-tile="runs"] .ev-num').first(), c, 'the right-panel tile "Lot groups that fit 111"; on screen until the group is chosen', { tight: true });
      await mark(p, 'B13', 'homes_240', p.locator('[data-count="homes"]').first(), c, '"240 homes" (at most 80 groups share no lot); under the heading, so it scrolls away with the list at list_scroll', { tight: true });
      // The list scrolls down to the Mahon group, then it is chosen and the map shows it with its inset plan.
      const row = p.locator(`tr[data-run="${MAHON}"]`);
      await c.until(1.2);
      cues.B13.list_scroll = at(c);
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
  {
    id: 'B02',
    name: 'not-one-lot',
    // anim=1: the staged map still zooms and pans (record mode is otherwise a still picture).
    q: 'view=city&type=two&anim=1',
    run: async (p, c) => {
      const layer = (t) => p.locator('.ws-rail .ws-layer').filter({ hasText: t }).first();
      cues.B02 = {};
      // The rail and the tiles never move in this clip: citywide counts, whatever the camera does.
      await mark(p, 'B02', 'city_total', layer('City-owned vacant lots').locator('.ws-layer-n'), c, 'the rail count, citywide; on screen the whole clip', { tight: true });
      await mark(p, 'B02', 'width_178', layer('Too narrow').locator('.ws-layer-n'), c, "the rail's Too narrow count; the cursor rests on this row from hover_178", { tight: true });
      await mark(p, 'B02', 'width_178_row', layer('Too narrow'), c, 'the whole Too narrow row: red swatch, words and count');
      await mark(p, 'B02', 'width_178_tile', p.locator('[data-tile="narrow"] .ws-tile-value'), c, 'the right-panel tile TOO NARROW 178', { tight: true });
      await mark(p, 'B02', 'grey', layer('Not checked'), c, 'the grey key: "Not checked" 9,413 (districts whose rules are not loaded), the grey dots on the map');
      // The camera: to the Hill District's red cluster (the map's pixel for it at 1920×1080), a slow wheel zoom
      // about that point, then a short drag that centres it.
      const HILL = [790, 410];
      await c.until(0.8);
      await glide(p, HILL[0], HILL[1], { rest: 0.4 });
      await c.until(1.8);
      cues.B02.zoom_start = at(c);
      for (let i = 0; i < 36; i++) {
        await p.mouse.wheel(0, -30);
        await sleep(FAST ? 5 : 80);
      }
      cues.B02.zoom_end = at(c);
      await c.until(5.6);
      await glide(p, 762, 470, { steps: 14, rest: 0.2 });
      await p.mouse.down();
      await glide(p, 762, 555, { steps: 34 });
      await p.mouse.up();
      cues.B02.pan_end = at(c);
      await sleep(400); // the map settles and letters its neighbourhoods
      const hood = await p.evaluate(() => [...document.querySelectorAll('.city-plate svg text')].map((e) => e.textContent).filter((t) => /HILL/i.test(t)));
      cues.B02.hill_labels = hood; // proof the camera is on the Hill
      if (!hood.length) (cues.B02.missing ??= []).push('the zoom did not land on the Hill District (no Hill label on the map)');
      await c.until(8);
      const row = await layer('Too narrow').boundingBox();
      if (row) await glide(p, row.x + 36, row.y + row.height / 2, { steps: 32, rest: 0.6 }); // on the red swatch: the words stay readable
      cues.B02.hover_178 = at(c);
      await c.until(12.2 + HOLD);
    },
  },
  {
    id: 'B01',
    name: 'surprise',
    // Opens on the block (every lot, no selection), then lot 25 is clicked: the plate's ink selection and the
    // inspector's 4 ft.
    q: 'view=block&block=10K&type=two',
    run: async (p, c) => {
      cues.B01 = {};
      const row0 = await mark(p, 'B01', 'street_row', p.locator('[data-plate="envelopes"]'), c, "every Mahon St lot's red sliver (the lots' envelopes); stays put the whole clip");
      await c.until(1.0);
      const lot = p.locator('[data-lot="25"]').first();
      const b = await lot.boundingBox();
      if (!b) throw new Error('not found: lot 25 on the plate');
      await glide(p, b.x + b.width / 2, b.y + 34, { rest: 0.3 }); // the lot's numbers, above its sliver
      await p.mouse.down();
      await sleep(90);
      await p.mouse.up();
      await p.waitForSelector('.lot.is-selected[data-lot="25"]', { timeout: 5000 });
      cues.B01.lot_selected = at(c);
      await sleep(350);
      await mark(p, 'B01', 'four_ft', p.locator('[data-lot-width="25"]'), c, "lot 25's 4′ on the plate, under its sliver", { tight: true });
      await mark(p, 'B01', 'four_ft_tile', p.locator('[data-tile="width"] .ws-tile-value, .ws-tile[data-tile="width"] .ev-num').first(), c, 'the inspector tile BUILDABLE WIDTH 4 ft', { tight: true });
      const row1 = await p.locator('[data-plate="envelopes"]').boundingBox();
      if (row0 && row1 && Math.abs(row1.y - row0[1]) + Math.abs(row1.x - row0[0]) > 2) (cues.B01.missing ??= []).push('street_row moved when lot 25 was selected: re-measure');
      // The cursor comes down onto lot 25's sliver and rests there.
      await c.until(2.6);
      const sl = await p.locator('[data-plate="envelopes"] .is-selected').first().boundingBox();
      if (sl) await glide(p, sl.x + sl.width / 2, sl.y + sl.height * 0.55, { rest: 0.6 });
      cues.B01.hover_sliver = at(c);
      await c.until(5.8 + HOLD);
    },
  },
  {
    id: 'B14',
    name: 'graph',
    start: [640, 872], // under the legend: the paper's nodes show a label on hover
    q: 'view=lot&block=10K&lot=25&type=two&canvas=graph',
    run: async (p, c) => {
      cues.B14 = {};
      const rule = p.locator('[data-node="rule:rm-m.side_interior"]').first(); // the node (its hover label shares the id)
      await c.until(0.8);
      await clickSlow(p, rule); // the rule's links light up; the rest dims
      cues.B14.rule_selected = at(c);
      await c.until(2.2);
      await rule.dblclick(); // focus mode: only the chain behind this rule's decision
      await p.waitForSelector('[data-graph-mode="focus"]', { timeout: 5000 });
      await sleep(500);
      cues.B14.focus = at(c);
      await mark(p, 'B14', 'record', p.locator('[data-node="source:wprdc_assessments"]'), c, 'Allegheny County Property Assessments (WPRDC): a public record');
      await mark(p, 'B14', 'rule', rule, c, 'Interior side setback · 10 ft (§903.03.C, RM-M)');
      await mark(p, 'B14', 'signer', p.locator('[data-node^="person:Sin|"]'), c, 'Sin (Student, team 24×100), signed 2026-09-26, with the sign-off note');
      // The pointer leaves the rule's old place and rests beside the rule → signer link, off every label.
      const sg = await p.locator('[data-node^="person:Sin|"]').first().boundingBox();
      if (sg) await glide(p, sg.x - 40, sg.y - 30, { steps: 30, rest: 0.6 });
      await c.until(5.5 + HOLD);
    },
  },
  {
    id: 'B08',
    name: 'held-out',
    q: `${heldOut}&tab=rules`,
    run: async (p, c) => {
      cues.B08 = {};
      // An R1D-H rule the model proposed and Sin signed: the Depth row's front-setback chip (§903.03.D.2).
      const row = p.locator('[data-tabpanel="rules"] tr.row-pass').filter({ hasText: 'Depth' }).first();
      await c.until(0.2);
      await row.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await c.until(0.9);
      await clickSlow(p, row.locator('.chip-ink').first());
      await p.waitForSelector('.drawer blockquote.excerpt mark', { timeout: 5000 });
      await sleep(450); // the drawer has slid in
      cues.B08.drawer = at(c);
      await mark(p, 'B08', 'quote', p.locator('.drawer blockquote.excerpt mark').first(), c, 'the verbatim quote, highlighted in the saved code text');
      await mark(p, 'B08', 'ink_rules', p.locator('.drawer').getByText('Source-checked by a named person.').locator('xpath=..'), c, 'Source-checked by a named person: Sin, with the sign-off note');
      await mark(p, 'B08', 'model', p.locator('.drawer').getByText(/proposed by gemini/).first(), c, "the provenance line: 'proposed by gemini-3.6-flash (prompt 7f7e2a03)'");
      // The pointer moves off the drawer's words to its left margin, level with the quote.
      const qb = await p.locator('.drawer blockquote.excerpt').first().boundingBox();
      if (qb) await glide(p, qb.x - 14, qb.y + 24, { rest: 0.6 });
      await c.until(3 + HOLD);
    },
  },
  {
    id: 'B10',
    name: 'next-letter',
    q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27&tab=next',
    run: async (p, c) => {
      cues.B10 = { next_steps: 0 };
      const tag = p.locator('[data-tabpanel="next"] .step-tag').first();
      await mark(p, 'B10', 'free_tags', tag, c, 'FREE on step 1 in the Next tab; visible until the tab scrolls to the letter link (letter_scroll)', { tight: true });
      await markUnion(p, 'B10', 'free_tags_tray', '.ws-tray-body .ws-step-tag', c, 'the five cost tags along the tray (FREE · FREE OR CHEAP · FREE · LOW COST · PAID); visible until the click');
      await c.until(0.8);
      const tb = await tag.boundingBox();
      if (tb) await glide(p, tb.x + tb.width / 2, tb.y + tb.height / 2, { rest: 0.6 });
      await c.until(3.4);
      const draft = p.locator('[data-tabpanel="next"] a[href*="view=inquiry"]').first();
      cues.B10.letter_scroll = at(c);
      await draft.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await c.until(5.6);
      await clickSlow(p, draft);
      cues.B10.letter = at(c);
      await p.waitForSelector('.iq-title', { timeout: 15000 });
      await p.waitForFunction(() => document.documentElement.dataset.ready === '1' || !!document.querySelector('.iq-title'), null, { timeout: 15000 });
      await sleep(400);
      cues.B10.letter_shown = at(c);
      // The page loaded afresh: the pointer reappears where it clicked, then moves to the letter's heading.
      if (p.__pt) await p.mouse.move(p.__pt[0], p.__pt[1]);
      const hb = await p.locator('.iq-title').first().boundingBox();
      if (hb) await glide(p, hb.x - 30, hb.y + hb.height / 2, { steps: 30, rest: 0.6 });
      if (!(await p.evaluate(() => new URLSearchParams(location.search).get('record') === '1'))) (cues.B10.missing ??= []).push('the letter opened without record=1');
      await mark(p, 'B10', 'letter', p.locator('.iq-title').first(), c, "the draft letter's heading", { tight: true });
      await mark(p, 'B10', 'letter_draft', p.locator('.iq-stamp').first(), c, 'the stamp "DRAFT · YOU SEND IT" on the letter');
      const trace = await mark(p, 'B10', 'letter_trace', p.locator('#iq-check p').first(), c, 'the number check: "all N numbers in 4 letters trace to the engine ✓"', { tight: true });
      if (trace) cues.B10.letter_trace_words = (await p.locator('#iq-check p').first().innerText()).replace(/\s+/g, ' ').trim();
      // The pointer points at the number check, then rests beside it; the letter stays on screen.
      const tb2 = await p.locator('#iq-check p').first().boundingBox();
      if (tb2) await glide(p, tb2.x + tb2.width + 26, tb2.y + tb2.height / 2, { steps: 28, rest: 0.6 });
      await c.until(Math.max(13, cues.B10.letter_shown + 5) + HOLD);
    },
  },
  {
    id: 'B16',
    name: 'builders-quote',
    // The builder's quote closes the money beat: "take this to a builder", then type in what the builder quoted.
    q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27',
    run: async (p, c) => {
      cues.B16 = {};
      const field = p.locator('#quote-in');
      await mark(p, 'B16', 'quote_field', p.locator('[data-quote-form]'), c, "the builder's quote field on the Money tab (red: yours, not checked)");
      await c.until(0.6);
      await clickSlow(p, field);
      await field.pressSequentially('140', { delay: 220 }); // typed visibly
      cues.B16.typed = at(c);
      await sleep(350);
      await p.keyboard.press('Enter');
      await p.waitForSelector('.ws-status .stamp[data-quote="1"]', { timeout: 5000 });
      await sleep(300);
      cues.B16.updated = at(c);
      await mark(p, 'B16', 'new_verdict', p.locator('.ws-status .stamp').first(), c, 'the stamp after the quote: WORTH PRICING THE SITE, "your builder’s quote" (red)');
      await mark(p, 'B16', 'left_value', p.locator('[data-tile="left"] .ws-tile-value').first(), c, 'LEFT AFTER BUILDING $51k at the quote (240,000 − 1,350 × 140)', { tight: true });
      cues.B16.verdict_words = (await p.locator('.ws-status .stamp').first().innerText()).replace(/\s+/g, ' ').trim();
      cues.B16.left_words = (await p.locator('[data-tile="left"] .ws-tile-value').first().innerText()).replace(/\s+/g, ' ').trim();
      // The pointer goes up to the stamp and rests.
      const st = await p.locator('.ws-status .stamp').first().boundingBox();
      if (st) await glide(p, st.x + st.width + 30, st.y + st.height / 2, { steps: 28, rest: 0.6 });
      await c.until(Math.max(7, cues.B16.updated + 3) + HOLD);
    },
  },
  {
    id: 'B15',
    name: 'what-if',
    // The rule what-ifs (spec §0.16): S1's sentence struck through; a click lights its City lots on the map.
    q: 'view=city&type=two&tab=whatif',
    run: async (p, c) => {
      cues.B15 = {};
      const row = p.locator('[data-whatif="S1"]');
      await mark(p, 'B15', 's1_sentence', row.locator('[data-whatif-sentence]'), c, 'the §925.06.C sentence, struck through in red; on screen the whole clip', { tight: true });
      await mark(p, 'B15', 's1_count', row.locator('[data-whatif-count]'), c, 'the "69" in "Opens 69 City-owned lots for a two-unit house"; on screen the whole clip', { tight: true });
      await c.until(0.5);
      await hoverSlow(p, row.locator('[data-whatif-sentence]'), { fx: 0.28, fy: 0.3, rest: 0.6 });
      await c.until(1.7);
      await clickSlow(p, row.locator('button.whatif-pick'));
      cues.B15.s1_click = at(c);
      await p.waitForFunction(() => new URLSearchParams(location.search).get('whatif') === 'S1', null, { timeout: 5000 });
      await sleep(350); // the map redraws: the rest dims, the what-if lots keep their dot and get a pencil ring
      cues.B15.s1_lit = at(c);
      // s1_map: the box around the lit lots, read from the canvas (after the wash, only they stay saturated red).
      const lit = await p.evaluate(() => {
        const cv = document.querySelector('.city-plate canvas');
        if (!(cv instanceof HTMLCanvasElement)) return null;
        const g = cv.getContext('2d');
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let y = 0; y < cv.height; y++)
          for (let x = 0; x < cv.width; x++) {
            const k = (y * cv.width + x) * 4;
            if (d[k] > 140 && d[k] - d[k + 1] > 90 && d[k] - d[k + 2] > 80 && d[k + 3] > 200) {
              if (x < x0) x0 = x;
              if (y < y0) y0 = y;
              if (x > x1) x1 = x;
              if (y > y1) y1 = y;
            }
          }
        if (x1 < 0) return null;
        const r = cv.getBoundingClientRect();
        const sx = r.width / cv.width, sy = r.height / cv.height;
        return [r.x + x0 * sx - 6, r.y + y0 * sy - 6, (x1 - x0) * sx + 12, (y1 - y0) * sy + 12];
      });
      if (lit) await pushMark(p, 'B15', 's1_map', lit, c, 'the box around the lit lots (Homewood, Lincoln-Lemington-Belmar, the Hill); the rest of the map is dimmed');
      else (cues.B15.missing ??= []).push('s1_map: no lit lots found on the canvas');
      // The pointer goes to the map, to the Hill's lit cluster, and rests.
      await glide(p, 790, 410, { steps: 30, rest: 0.6 });
      await c.until(7 + HOLD);
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
  // The pointer is on screen from the first frame (never arriving from 0,0), somewhere it covers nothing.
  const [sx, sy] = beat.start ?? [1150, 720];
  await page.mouse.move(sx, sy);
  page.__pt = [sx, sy];
  await sleep(250);
  const lead = (Date.now() - tStart) / 1000; // seconds of loading to trim from the clip's start
  const c = clock();
  try {
    await beat.run(page, c);
  } catch (e) {
    errors.push(`beat failed: ${String(e).split('\n')[0]}`);
  }
  const secs = c.now();
  if (process.env.SHOTS && !RECORD) await page.screenshot({ path: `${process.env.SHOTS}/${beat.id}-end.png` }).catch(() => {});
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
