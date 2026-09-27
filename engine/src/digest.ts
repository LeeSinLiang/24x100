// The watchlist digest (team, 27 Sep: "Watch this lot" leads to a real ping). Pure: the state of a watched lot, the
// changes between two states, and the message in four forms (plain text, Markdown, HTML email, Slack Block Kit).
// The state is the map's own answer (the citywide classifier) plus the rules it rests on and the lot's records, so
// any City lot can be watched. Nothing here sends anything; scripts/digest.ts builds, pipeline/digest.py sends.
// No personal data: addresses, statuses, rule ids and the role and name of whoever signed a rule (as the app shows).
import { BLOCKER_WORDS, classifyCityLot, type Blocker, type CityLot } from './city';
import { isAiReviewer, pick } from './rules';
import { TEMPLATES } from './templates';
import type { RuleSet, Settings, TemplateId, Trust } from './types';

export interface LotRecords {
  status: string;
  status_updated: string | null;
  assessed: number | null;
  mapped: number;
  deed: string | null;
}

export interface WatchLotState {
  pin: string;
  addr: string;
  hood: string | null;
  zone: string | null;
  type: TemplateId;
  link: string; // the query string into the app ("?view=…")
  verdict: { blocker: Blocker; width: number | null; formula: string | null; trust: Trust };
  rules: { ink: number; ai: number; pencil: number; signers: string[] }; // the district's rules the map uses, by state
  records: LotRecords;
}

export interface WatchSnapshot {
  at: string; // when this state was taken (ISO)
  label: string; // what it is, in words ("published before Sin's sign-off, git d87dce4^")
  lots: Record<string, WatchLotState>;
}

export interface RecordChange {
  pin: string;
  field: string;
  before: unknown;
  after: unknown;
  source: string; // dataset and pull time
}

export interface ChangeItem {
  kind: 'records' | 'rules' | 'verdict' | 'new';
  what: string;
  before: string;
  after: string;
  source: string;
}

export interface LotChanges {
  pin: string;
  addr: string;
  hood: string | null;
  link: string;
  now: WatchLotState;
  items: ChangeItem[];
}

const n = (v: number) => v.toLocaleString('en-US');

/** The words for a lot's map verdict: "too narrow: 24 − 5 − 5 = 14 ft for a 16 ft two-unit house". */
export function verdictWords(v: WatchLotState['verdict'], type: TemplateId, rules?: WatchLotState['rules']): string {
  const t = TEMPLATES[type];
  const w = BLOCKER_WORDS[v.blocker];
  // Grey because the district's rules are proposed but no person has checked them: say that, not "not loaded".
  if (v.blocker === 'rules' && rules && rules.pencil > 0) return 'not checked yet: its rules are proposed by the model, awaiting a person';
  const tail = v.trust === 'pencil' ? ' (pencil)' : '';
  if (v.blocker === 'width' && v.formula) return `too narrow: ${v.formula} ft, for a ${t.proposal.width} ft ${t.name.toLowerCase()}${tail}`;
  if (v.blocker === 'fits' || v.blocker === 'ownership') return `${w}${v.width != null ? ` (${n(v.width)} ft buildable)` : ''}${tail}`;
  return `${w}${tail}`;
}

export function lotRecords(l: CityLot): LotRecords {
  return { status: l.status, status_updated: l.status_updated, assessed: l.assessed, mapped: Math.round(l.mapped), deed: l.deed ? `${l.deed.front} × ${l.deed.depth} ft` : null };
}

/** The rules the map's answer rests on (the one rule it picks for each field it reads, citywide rules included), by
 *  state, and the people who signed them. Unused duplicate proposals are not counted. */
export function ruleCounts(rs: RuleSet | null, type: TemplateId): WatchLotState['rules'] {
  if (!rs) return { ink: 0, ai: 0, pencil: 0, signers: [] };
  const fields = ['min_lot_area', 'front_setback', 'rear_setback', 'side_setback_interior', 'side_setback_exterior', 'narrow_lot_side_table', 'contextual_side', `use_${type}`];
  const used = [...new Map(fields.map((f) => pick(rs, f as never)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.id, r])).values()];
  const signers = new Set<string>();
  for (const r of used)
    for (const e of r.history)
      if ((e.action === 'source_checked' || e.action === 'city_confirmed') && !isAiReviewer(e.reviewer, e.role)) signers.add(`${e.reviewer} (${e.role})`);
  return {
    ink: used.filter((r) => r.state === 'ink' && !r.ai_checked).length,
    ai: used.filter((r) => r.state === 'ink' && r.ai_checked).length,
    pencil: used.filter((r) => r.state === 'pencil').length,
    signers: [...signers].sort(),
  };
}

export function watchState(l: CityLot, rs: RuleSet | null, type: TemplateId, settings: Settings, link: string): WatchLotState {
  const c = classifyCityLot(l, rs, type, settings);
  return {
    pin: l.pin,
    addr: l.addr,
    hood: l.hood ?? null,
    zone: l.zone,
    type,
    link,
    verdict: { blocker: c.blocker, width: c.width, formula: c.formula, trust: c.trust },
    rules: ruleCounts(rs, type),
    records: lotRecords(l),
  };
}

const RECORD_WORDS: Record<keyof LotRecords, string> = {
  status: 'City sale status',
  status_updated: 'City status last updated',
  assessed: 'County lot area (sf)',
  mapped: 'City map area (sf)',
  deed: 'Deed dimensions',
};
const show = (v: unknown) => (v == null || v === '' ? 'none' : typeof v === 'number' ? n(v) : String(v));
export const rulesWords = (r: WatchLotState['rules']) =>
  [r.ink ? `${r.ink} signed by a person` : '', r.ai ? `${r.ai} AI-checked only` : '', r.pencil ? `${r.pencil} in pencil (proposed by the model, not checked)` : ''].filter(Boolean).join(', ') || 'none loaded';

/** What changed on each watched lot between two states. `records` are the refresh's own record diffs (with their
 *  dataset and pull time); a lot new to the watchlist is reported once, as new. */
export function diffStates(before: WatchSnapshot | null, now: WatchSnapshot, records: RecordChange[] = []): LotChanges[] {
  const out: LotChanges[] = [];
  for (const pin of Object.keys(now.lots).sort()) {
    const a = before?.lots[pin];
    const b = now.lots[pin];
    const items: ChangeItem[] = [];
    if (!a) items.push({ kind: 'new', what: 'Now watched', before: '', after: verdictWords(b.verdict, b.type, b.rules), source: now.label });
    else {
      const since = `since ${before!.label}`;
      if (a.verdict.blocker !== b.verdict.blocker || a.verdict.formula !== b.verdict.formula || a.verdict.trust !== b.verdict.trust)
        items.push({ kind: 'verdict', what: `Map verdict (${TEMPLATES[b.type].name.toLowerCase()})`, before: verdictWords(a.verdict, a.type, a.rules), after: verdictWords(b.verdict, b.type, b.rules), source: `the citywide classifier, ${since}` });
      if (a.rules.ink !== b.rules.ink || a.rules.ai !== b.rules.ai || a.rules.pencil !== b.rules.pencil)
        items.push({
          kind: 'rules',
          what: `${b.zone ?? 'District'} rules`,
          before: rulesWords(a.rules),
          after: `${rulesWords(b.rules)}${b.rules.signers.length ? `; signed by ${b.rules.signers.join(', ')}` : ''}`,
          source: `the review log (data/rules/reviews.json), ${since}`,
        });
      for (const k of Object.keys(RECORD_WORDS) as (keyof LotRecords)[])
        if (show(a.records[k]) !== show(b.records[k]))
          items.push({ kind: 'records', what: RECORD_WORDS[k], before: show(a.records[k]), after: show(b.records[k]), source: `the lot file (data/city/lots.json), ${since}` });
    }
    // The refresh's own diffs, except the City status the lot file already reports.
    for (const r of records.filter((x) => x.pin === pin && !/^city\.status/.test(x.field))) items.push({ kind: 'records', what: r.field, before: show(r.before), after: show(r.after), source: r.source });
    if (items.length) out.push({ pin, addr: b.addr, hood: b.hood, link: b.link, now: b, items });
  }
  return out;
}

export interface DigestMessage {
  subject: string;
  text: string;
  markdown: string;
  html: string;
  slack: { text: string; blocks: unknown[] };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slackEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The digest in four forms. `appUrl` is the live app ("https://…/"), `note` a line on what is compared with what. */
export function renderDigest(changes: LotChanges[], opts: { appUrl: string; watched: number; note: string; at: string }): DigestMessage {
  const url = (c: LotChanges) => `${opts.appUrl.replace(/\/?$/, '/')}${c.link}`;
  const head = changes.length ? `${changes.length} watched ${changes.length === 1 ? 'lot' : 'lots'} changed` : `No change on the ${opts.watched} watched lots`;
  const subject = `24×100: ${head}`;
  const line = (i: ChangeItem) => (i.kind === 'new' ? `${i.what}: ${i.after}` : `${i.what}: ${i.before} → ${i.after}`);
  const foot = 'Decision support, not legal, financial or zoning advice; the City of Pittsburgh interprets its own code. 24×100 never sends anything to the City for you.';

  const text = [subject, opts.note, '', ...changes.flatMap((c) => [`${c.addr}${c.hood ? `, ${c.hood}` : ''} (${c.pin})`, ...c.items.map((i) => `  - ${line(i)}  [${i.source}]`), `  Open: ${url(c)}`, '']), foot].join('\n');
  const markdown = [`# ${subject}`, '', `_${opts.note}_`, '', ...changes.flatMap((c) => [`## [${c.addr}](${url(c)})${c.hood ? ` · ${c.hood}` : ''}`, '', ...c.items.map((i) => `- **${i.what}:** ${i.kind === 'new' ? i.after : `${i.before} → **${i.after}**`}  \n  _${i.source}_`), '']), `_${foot}_`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f3efe6;font-family:Georgia,serif;color:#1d1b18">
<div style="max-width:640px;margin:0 auto;padding:24px">
<p style="font:600 11px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6b665d;margin:0 0 6px">24×100 · watchlist digest</p>
<h1 style="font-weight:400;font-size:24px;margin:0 0 6px">${esc(head)}</h1>
<p style="font:13px/1.45 Helvetica,Arial,sans-serif;color:#6b665d;margin:0 0 18px">${esc(opts.note)}</p>
${changes
  .map(
    (c) => `<div style="background:#fbf9f4;border:1px solid #d9d2c3;padding:14px 16px;margin:0 0 12px">
<h2 style="font-weight:400;font-size:18px;margin:0 0 8px">${esc(c.addr)}${c.hood ? ` <span style="font:13px Helvetica,Arial,sans-serif;color:#6b665d">· ${esc(c.hood)}</span>` : ''}</h2>
<ul style="font:14px/1.5 Helvetica,Arial,sans-serif;margin:0 0 10px;padding-left:18px">${c.items
      .map((i) => `<li><strong>${esc(i.what)}:</strong> ${i.kind === 'new' ? esc(i.after) : `${esc(i.before)} → <strong style="color:#a01e1e">${esc(i.after)}</strong>`}<br><span style="color:#6b665d;font-size:12px">${esc(i.source)}</span></li>`)
      .join('')}</ul>
<a href="${esc(url(c))}" style="font:600 13px Helvetica,Arial,sans-serif;color:#1d1b18">Open in 24×100 →</a></div>`,
  )
  .join('\n')}
<p style="font:12px/1.45 Helvetica,Arial,sans-serif;color:#6b665d">${esc(foot)}</p>
</div></body></html>`;
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `24×100 · ${head}`, emoji: false } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: slackEsc(opts.note) }] },
    ...changes.flatMap((c) => [
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*<${url(c)}|${slackEsc(c.addr)}>*${c.hood ? ` · ${slackEsc(c.hood)}` : ''}\n${c.items.map((i) => `• *${slackEsc(i.what)}:* ${i.kind === 'new' ? slackEsc(i.after) : `${slackEsc(i.before)} → *${slackEsc(i.after)}*`}`).join('\n')}` },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: slackEsc([...new Set(c.items.map((i) => i.source))].join(' · ')) }] },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in 24×100' }, url: url(c) }] },
    ]),
    { type: 'divider' },
    { type: 'context', elements: [{ type: 'mrkdwn', text: slackEsc(foot) }] },
  ];
  return { subject, text, markdown, html, slack: { text: `${subject}. ${opts.note}`, blocks } };
}
