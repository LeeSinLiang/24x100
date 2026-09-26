// Trust-state DOM scan: nothing that is pencil, unreviewed, struck or an unsigned † rule may carry
// ink styling anywhere on screen, and no open question or assumption may sit among the inquiry's facts.
//
// Usage: node scripts/trust-scan.mjs [--base http://localhost:5173/] [--verbose]
// Needs the Vite dev server: the page imports the engine and the rule store itself
// (/src/lib/*.ts, /@fs/<repo>/engine/src/index.ts) and uses them as the oracle, so the scan compares
// what is drawn with what the engine says, not with what the interface claims about itself.
//
// Runs every page twice: with the committed review log, and with side_interior reopened (pencil) so
// the lot numeral, the ledger, the drawer and the inquiry have a pencil input to get wrong. A
// mutation self-test proves the DOM check and the markdown check can fail.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('base', 'http://localhost:5173/');
const VERBOSE = process.argv.includes('--verbose');
const REPO = process.cwd();
const ENGINE = `/@fs${REPO}/engine/src/index.ts`;

const PAGES = [
  { id: 'review RM-M', kind: 'review', q: 'view=review&district=RM-M' },
  { id: 'review R1D-H', kind: 'review', q: 'view=review&district=R1D-H' },
  { id: 'B01', kind: 'lot', q: 'view=lot&block=10K&lot=25&type=two' },
  { id: 'B04', kind: 'lot', q: 'view=lot&block=10K&lot=25&type=three&lots=25,26,27' },
  { id: 'B05', kind: 'lot', q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached' },
  { id: 'B06', kind: 'lot', q: 'view=lot&block=10K&lot=25&type=row&lots=25,26,27&assume=q.single_unit_includes_attached:yes' },
  { id: 'B10', kind: 'inquiry', q: 'view=inquiry&block=10K&lot=25&type=three&lots=25,26,27' },
  { id: 'inquiry lot 22 (refused)', kind: 'inquiry', q: 'view=inquiry&block=10K&lot=22&type=two' },
];

// A reopened rule: effective state unreviewed (pencil). Written straight into this browser's log.
const REOPEN = [
  {
    id: 'a-trust-scan-reopen-side-interior',
    rule_id: 'rm-m.side_interior',
    question_id: null,
    at: '2026-09-26T23:00:00Z',
    reviewer: 'trust-scan',
    role: 'test',
    action: 'reopened',
    quote: '',
    decision: 'reopened for the trust scan',
    reason: 'the scan needs a pencil input on the lot view',
    choice: null,
    reference: null,
  },
];

const INK = ['ev-ink', 'mark-ink', 'v-ink', 'chip-ink', 'hl-ink', 'hl-sealed', 'rv-mark-sealed'];

/** In-page: every element that declares data-trust other than ink carries no ink class, nor do its
 *  descendants (a descendant with its own data-trust is judged on its own). */
function domCheck(INK) {
  const bad = [];
  const counts = {};
  for (const el of document.querySelectorAll('[data-trust]')) {
    const t = el.dataset.trust;
    counts[t] = (counts[t] ?? 0) + 1;
    const dagger = el.dataset.dagger === '1';
    if (dagger && t === 'ink' && (el.dataset.aiChecked === '1' || el.dataset.level === 'unreviewed'))
      bad.push(`† rule ${el.dataset.ruleId} is ink without a person's signature`);
    if (t === 'ink') continue;
    const nodes = [el, ...el.querySelectorAll('*')].filter((n) => n === el || n.closest('[data-trust]') === el);
    for (const n of nodes) {
      const hit = [...n.classList].filter((c) => INK.includes(c));
      if (hit.length) bad.push(`${el.dataset.ruleId ?? el.dataset.questionId ?? el.dataset.section ?? el.tagName} is ${t} but <${n.tagName.toLowerCase()}> has ${hit.join(',')}: "${(n.textContent ?? '').trim().slice(0, 50)}"`);
    }
  }
  return { bad, counts };
}

/** Sections of an exported inquiry markdown; returns the facts lines that carry a pencil/red tag. */
function factsProblems(md) {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => /^## What the code and the records say/.test(l));
  if (i < 0) return ['no "What the code and the records say" section in the export'];
  const out = [];
  for (let j = i + 1; j < lines.length && !lines[j].startsWith('## '); j++) if (/^- \[(open|our assumption)\]/.test(lines[j])) out.push(lines[j].slice(0, 100));
  return out;
}

const browser = await chromium.launch({ channel: 'chrome' });
const failures = [];
const report = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

// What each kind of page must have drawn before it is scanned (a dev server can be mid-reload).
const READY = { review: '.rv-card', lot: '.numeral, .stamp-refuse', inquiry: '.iq-item' };

async function open(ctx, q, kind) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}?${q}&still=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 }).catch(() => {});
    if (!kind || (await page.waitForSelector(READY[kind], { timeout: 5000 }).then(() => true).catch(() => false))) break;
  }
  await page.waitForTimeout(150);
  return { page, errors };
}

/** In-page oracle: the rule set and (for lot and inquiry pages) the engine result for this URL. */
async function oracle(page) {
  return page.evaluate(async (ENGINE) => {
    const E = await import(ENGINE);
    const D = await import('/src/lib/data.ts');
    const A = await import('/src/lib/audit.ts');
    const U = await import('/src/lib/url.ts');
    const M = await import('/src/lib/model.ts');
    const s = U.parseUrl(location.search);
    let local = [];
    try {
      local = JSON.parse(localStorage.getItem('lot24x100.audit.v1') ?? '[]');
    } catch {}
    const seeds = A.seedEntries();
    const seen = new Set(seeds.map((x) => x.id));
    const audit = [...seeds, ...local.filter((x) => !seen.has(x.id)), ...A.linkAssumptions(s.assume)];
    const out = { view: s.view, rules: {}, questions: {}, checks: null, widthTrust: null };
    let rs;
    if (s.view === 'review') rs = E.buildRuleSet(s.district ?? 'RM-M', D.RULES, D.QUESTIONS, audit);
    else {
      const block = D.BLOCKS[s.block];
      const scen = M.scenarioFrom(block, s);
      const sel = block.parcels.find((p) => p.pin === scen.pins[0]);
      const ctx = M.contextFor(block, sel.zone, audit, s.tol);
      rs = ctx.rs;
      const r = E.evaluate(ctx, scen);
      out.state = r.state;
      out.checks = r.checks.filter((c) => c.id !== 'contextual').map((c) => ({ id: c.id, label: c.label, trust: c.trust, status: c.status }));
      out.widthTrust = r.checks.find((c) => c.id === 'width')?.trust ?? null;
    }
    for (const r of rs.rules) out.rules[r.id] = { state: r.state, dagger: r.dagger, ai: r.ai_checked, level: r.verification.level };
    for (const q of rs.questions) out.questions[q.question.id] = q.status;
    return out;
  }, ENGINE);
}

async function scanReview(page, o, where) {
  const cards = await page.$$eval('.rv-card[data-rule-id]', (els) => els.map((e) => ({ id: e.dataset.ruleId, trust: e.dataset.trust })));
  const ids = Object.keys(o.rules);
  if (!ids.length) fail(where, 'the engine returned no rules for this district');
  const byId = Object.fromEntries(cards.map((c) => [c.id, c.trust]));
  for (const id of ids) {
    if (!(id in byId)) fail(where, `rule ${id} has no card`);
    else if (byId[id] !== o.rules[id].state) fail(where, `rule ${id}: card says ${byId[id]}, engine says ${o.rules[id].state}`);
  }
  const qs = await page.$$eval('.rv-card[data-question-id]', (els) => els.map((e) => ({ id: e.dataset.questionId, trust: e.dataset.trust })));
  for (const q of qs) {
    const want = { open: 'pencil', assumed: 'red', city_confirmed: 'ink' }[o.questions[q.id]];
    if (q.trust !== want) fail(where, `question ${q.id}: card says ${q.trust}, engine says ${o.questions[q.id]}`);
  }
  const marks = await page.$$eval('mark[data-hl]', (els) => els.length);
  return { cards: cards.length, questions: qs.length, marks };
}

async function scanLot(page, o, where) {
  const rows = await page.$$eval('.ledger tbody tr', (trs) =>
    trs.map((tr) => ({
      label: tr.querySelector('th')?.childNodes[0]?.textContent?.trim() ?? '',
      mark: [...(tr.querySelector('.mark')?.classList ?? [])],
      avail: [...(tr.querySelectorAll('td.num')[1]?.querySelector('.ev')?.classList ?? [])],
      pencilChips: tr.querySelectorAll('.chip-pencil').length,
    })),
  );
  if (o.state === 'ok') {
    if (rows.length !== o.checks.length) fail(where, `ledger has ${rows.length} rows, the engine ${o.checks.length} checks; can't map them`);
    rows.forEach((row, i) => {
      const c = o.checks[i];
      if (!c) return;
      if (row.label !== c.label) return fail(where, `ledger row ${i} reads "${row.label}", engine check is "${c.label}"; can't map them`);
      if (c.trust !== 'ink' && row.mark.includes('mark-ink')) fail(where, `ledger ${c.label}: check is ${c.trust} but the mark is ink`);
      if (c.trust !== 'ink' && row.avail.includes('ev-ink')) fail(where, `ledger ${c.label}: check is ${c.trust} but the available value is ink`);
      if (row.pencilChips && c.trust === 'ink') fail(where, `ledger ${c.label}: cites a pencil rule but the engine made the check ink (weakest input should win)`);
    });
    const numeral = await page.$eval('.numeral', (e) => [...e.classList]).catch(() => null);
    if (!numeral) fail(where, 'no width numeral');
    else if (o.widthTrust !== 'ink' && numeral.includes('ev-ink')) fail(where, `numeral is ink but the width check is ${o.widthTrust}`);
  }
  // Every rule in the drawer: the verification box and the value follow the engine's state.
  let drawers = 0;
  const keep = await page.evaluate(() => location.search);
  for (const [id, r] of Object.entries(o.rules)) {
    await page.evaluate((id) => {
      const q = new URLSearchParams(location.search);
      q.set('drawer', `rule:${id}`);
      history.pushState(null, '', `?${q.toString()}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, id);
    await page.waitForSelector('.drawer .verification', { timeout: 3000 }).catch(() => {});
    const d = await page.evaluate(() => ({
      v: [...(document.querySelector('.drawer .verification')?.classList ?? [])],
      val: [...(document.querySelector('.drawer .card-value .ev')?.classList ?? [])],
    }));
    if (!d.v.length) {
      fail(where, `drawer for ${id} didn't open`);
      continue;
    }
    drawers++;
    if (r.state !== 'ink' && (d.v.includes('v-ink') || d.val.includes('ev-ink'))) fail(where, `drawer for ${id}: engine says ${r.state}, drawer shows ink`);
    if (r.state === 'ink' && r.dagger && r.ai) fail(where, `engine: † rule ${id} is ink with only an AI check`);
  }
  await page.evaluate((k) => {
    history.pushState(null, '', k);
    dispatchEvent(new PopStateEvent('popstate'));
  }, keep);
  return { rows: rows.length, drawers };
}

async function scanInquiry(page, where) {
  const items = await page.$$eval('.iq-item', (els) => els.map((e) => ({ trust: e.dataset.trust ?? null, section: e.dataset.section })));
  if (!items.length) fail(where, 'no inquiry items rendered');
  for (const it of items) if (it.section === 'facts' && it.trust !== 'ink') fail(where, `a ${it.trust} item sits under "What the code and the records say"`);
  const check = await page.$eval('[data-check]', (e) => e.dataset.check).catch(() => null);
  if (check !== 'ok') fail(where, `number check is "${check}"`);
  let md = null;
  try {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('text=Download .md')]);
    md = readFileSync(await dl.path(), 'utf8');
  } catch (e) {
    fail(where, `couldn't export the markdown: ${String(e).slice(0, 120)}`);
  }
  if (md) for (const l of factsProblems(md)) fail(where, `export lists an open item or assumption among the facts: ${l}`);
  return { items: items.length, exported: md ? md.length : 0 };
}

async function run(label, init) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  if (init) await ctx.addInitScript(init);
  for (const pg of PAGES) {
    const where = `[${label}] ${pg.id}`;
    const { page, errors } = await open(ctx, pg.q, pg.kind);
    const o = await oracle(page).catch((e) => (fail(where, `oracle failed (is this the Vite dev server?): ${String(e).slice(0, 160)}`), null));
    if (!o) {
      await page.close();
      continue;
    }
    const dom = await page.evaluate(domCheck, INK);
    dom.bad.forEach((b) => fail(where, b));
    let extra = {};
    if (pg.kind === 'review') extra = await scanReview(page, o, where);
    if (pg.kind === 'lot') extra = await scanLot(page, o, where);
    if (pg.kind === 'inquiry') extra = await scanInquiry(page, where);
    const pencil = Object.values(o.rules).filter((r) => r.state === 'pencil').length;
    report.push({ run: label, page: pg.id, 'data-trust elements': JSON.stringify(dom.counts), 'engine pencil rules': pencil, width: o.widthTrust ?? '', ...extra });
    errors.forEach((e) => fail(where, `page error: ${e.slice(0, 120)}`));
    await page.close();
  }
  await ctx.close();
}

await run('committed log');
await run('side_interior reopened', `localStorage.setItem('lot24x100.audit.v1', ${JSON.stringify(JSON.stringify(REOPEN))})`);

// The reopened run must actually put a pencil input under the lot view, or it tested nothing.
const reopenedB01 = report.find((r) => r.run === 'side_interior reopened' && r.page === 'B01');
if (!reopenedB01 || reopenedB01.width !== 'pencil') failures.push(`[self-test] reopening rm-m.side_interior left B01's width check "${reopenedB01?.width}", not pencil: the reopened run exercised nothing`);

// Mutation self-test: plant ink styling on a pencil element and in the export; both checks must fail.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const { page } = await open(ctx, 'view=review&district=RM-M', 'review');
  const planted = await page.evaluate(() => {
    const el = document.querySelector('[data-trust="pencil"] .ev');
    if (!el) return false;
    el.classList.add('ev-ink');
    return true;
  });
  const after = await page.evaluate(domCheck, INK);
  if (!planted) failures.push('[self-test] no pencil element to mutate on the RM-M review page: the DOM check would be vacuous');
  else if (!after.bad.length) failures.push('[self-test] planted ev-ink on a pencil element and the DOM check did not notice');
  const md = '# x\n\n## What the code and the records say\n- [open] planted\n\n## Next\n';
  if (!factsProblems(md).length) failures.push('[self-test] planted "[open]" under the facts and the markdown check did not notice');
  report.push({ run: 'self-test', page: 'review RM-M', planted, 'violations found': after.bad.length });
  await ctx.close();
}

await browser.close();
console.table(report);
if (VERBOSE || failures.length) for (const f of failures) console.log(`✗ ${f}`);
console.log(failures.length ? `${failures.length} trust violation(s)` : 'trust scan: no pencil, struck or unsigned † item is drawn in ink; inquiry facts are ink only');
process.exit(failures.length ? 1 : 0);
