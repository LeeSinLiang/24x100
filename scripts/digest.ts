// The watchlist digest (team, 27 Sep): per watched lot, what changed since the last digest (records, the rules the
// map rests on, the map's verdict), with a link into the app, as Slack Block Kit and an HTML + text email.
//
//   npm run digest -- --dry-run            preview (data/digest/preview.md, preview.html); nothing is sent
//   npm run digest -- --send               send via pipeline/digest.py (Slack and/or email, only what .env sets:
//                                          email through Resend with RESEND_API_KEY, else SMTP),
//                                          then record the state sent (data/digest/last.json) so a change pings once
//   npm run digest -- --baseline <git ref> compare with the state published at that commit instead of last.json
//
// The watched lots come from data/watchlist.json ({watch: [{label, pins, type?}]}); only City-owned vacant lots (the
// map's lots) are watched. Credentials never pass through here: the Python sender reads them from .env.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { diffStates, renderDigest, watchState, type RecordChange, type WatchSnapshot } from '../engine/src/digest';
import { buildRuleSet, DEFAULT_SETTINGS, type BlockFile, type Rule, type TemplateId } from '../engine/src/index';
import type { CityLot } from '../engine/src/city';

const OUT = 'data/digest';
const LAST = `${OUT}/last.json`;
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (k: string) => process.argv.includes(`--${k}`);

/** A file as it is now, or as it was at a git commit. */
function readAt(path: string, ref?: string): string | null {
  if (!ref) return existsSync(path) ? readFileSync(path, 'utf8') : null;
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}
function listAt(dir: string, ref?: string): string[] {
  if (!ref) return existsSync(dir) ? readdirSync(dir).map((f) => `${dir}/${f}`) : [];
  return execFileSync('git', ['ls-tree', '--name-only', `${ref}`, `${dir}/`], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
const J = <T>(s: string | null, d: T): T => (s ? (JSON.parse(s) as T) : d);

interface Watch {
  label: string;
  pins: string[];
  type?: TemplateId;
}

/** The state of every watched City lot, from the files as they are now or were at `ref`. */
export function snapshot(watch: Watch[], ref: string | undefined, label: string, at: string): { snap: WatchSnapshot; unwatchable: string[] } {
  const lots = J<{ lots: CityLot[] }>(readAt('data/city/lots.json', ref), { lots: [] }).lots;
  const byPin = new Map(lots.map((l) => [l.pin, l]));
  const ruleFiles = [...listAt('data/rules/base', ref), ...listAt('data/rules/extracted', ref).filter((f) => f.endsWith('.json') && !f.endsWith('eval.json'))];
  const rules: Rule[] = ruleFiles.flatMap((f) => {
    const d = J<unknown>(readAt(f, ref), []);
    return Array.isArray(d) ? (d as Rule[]) : ((d as { rules?: Rule[] }).rules ?? []);
  });
  const questions = J(readAt('data/rules/questions.json', ref), []);
  const r = J<{ entries?: unknown[] } | unknown[]>(readAt('data/rules/reviews.json', ref), []);
  const reviews = Array.isArray(r) ? r : r.entries ?? [];
  const blocks: BlockFile[] = listAt('data/blocks', ref)
    .filter((f) => /\/[0-9A-Z]+\.json$/.test(f))
    .map((f) => J<BlockFile>(readAt(f, ref), null as unknown as BlockFile))
    .filter(Boolean);
  const blockOf = new Map<string, { id: string; lot: string }>();
  for (const b of blocks) for (const p of b.parcels) blockOf.set(p.pin, { id: b.meta.id, lot: `${p.lot ?? p.pin}${p.lot_suffix ?? ''}` });
  const rsBy = new Map<string, ReturnType<typeof buildRuleSet>>();
  const rsFor = (z: string) => rsBy.get(z) ?? (rsBy.set(z, buildRuleSet(z, rules, questions, reviews as never)), rsBy.get(z)!);
  const snap: WatchSnapshot = { at, label, lots: {} };
  const unwatchable: string[] = [];
  for (const w of watch)
    for (const pin of w.pins) {
      const l = byPin.get(pin);
      if (!l) {
        unwatchable.push(pin);
        continue;
      }
      const type = w.type ?? 'two';
      const b = blockOf.get(pin);
      const link = b ? `?view=lot&block=${b.id}&lot=${b.lot}&type=${type}` : `?view=city&type=${type}&pin=${pin}`;
      snap.lots[pin] = watchState(l, l.zone ? rsFor(l.zone) : null, type, DEFAULT_SETTINGS, link);
    }
  return { snap, unwatchable };
}

/** Which variables are set, from the environment and .env: names only, never a value (the Python sender reads them). */
function setVars(): Set<string> {
  const on = new Set(Object.entries(process.env).filter(([, v]) => v).map(([k]) => k));
  if (existsSync('.env'))
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !/^(""|'')$/.test(m[2]) && !m[2].startsWith('#')) on.add(m[1]);
    }
  return on;
}

/** What `--send` would use, as the Python sender decides it (pipeline/digest.py channels()). */
function channelsWords(): string {
  const on = setVars();
  const ch: string[] = [];
  if (on.has('SLACK_WEBHOOK_URL')) ch.push('Slack (SLACK_WEBHOOK_URL)');
  if (on.has('RESEND_API_KEY') && on.has('DIGEST_TO')) ch.push(`email through Resend to DIGEST_TO, from ${on.has('DIGEST_FROM') ? 'DIGEST_FROM' : 'onboarding@resend.dev'}`);
  else if (['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'DIGEST_TO'].every((k) => on.has(k))) ch.push('email over SMTP to DIGEST_TO');
  const lines = [ch.length ? `--send would use: ${ch.join('; ')}.` : '--send would refuse: no channel is set (SLACK_WEBHOOK_URL, or RESEND_API_KEY and DIGEST_TO, in .env).'];
  if (on.has('RESEND_API_KEY') && !on.has('DIGEST_TO')) lines.push('RESEND_API_KEY is set but DIGEST_TO isn’t: no email would go.');
  if (on.has('RESEND_API_KEY') && !on.has('DIGEST_FROM'))
    lines.push('Resend’s test sender (onboarding@resend.dev) delivers only to the address that owns the Resend account: DIGEST_TO must be that address. Another sender needs a domain verified with Resend.');
  return lines.join('\n');
}

function main() {
  const watch: Watch[] = J<{ watch?: Watch[] }>(readAt('data/watchlist.json'), {}).watch ?? [];
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const at = new Date().toISOString();
  const { snap: now, unwatchable } = snapshot(watch, undefined, `the published state now (git ${head})`, at);
  const baseRef = arg('baseline');
  let before: WatchSnapshot | null = null;
  if (baseRef) {
    const when = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format:%d %b %H:%M', baseRef], { encoding: 'utf8' }).trim();
    const short = execFileSync('git', ['rev-parse', '--short', baseRef], { encoding: 'utf8' }).trim();
    before = snapshot(watch, baseRef, `the state published at git ${short} (${when} ET)`, at).snap;
  } else if (existsSync(LAST)) before = JSON.parse(readFileSync(LAST, 'utf8')) as WatchSnapshot;

  // The refresh's record diffs on watched lots, with the dataset and its pull time.
  const latest = J<{ meta?: { to?: string }; changes?: { pin: string; field: string; before: unknown; after: unknown; scope: string }[] }>(readAt('data/refresh/latest.json'), {});
  const records: RecordChange[] = (latest.changes ?? [])
    .filter((c) => now.lots[c.pin])
    .map((c) => ({ pin: c.pin, field: c.field, before: c.before, after: c.after, source: `${c.scope} data, refresh pulled ${latest.meta?.to ?? 'unknown'}` }));

  const changes = diffStates(before, now, records);
  const appUrl = process.env.APP_URL || 'https://24x100.example/';
  const watched = Object.keys(now.lots).length;
  // Tonight's shortlist (agents/shortlist.py): the lots that joined it since the run before.
  const hist = J<{ run_at: string; shortlist: string[]; counts: { shortlist: number; swept: number } }[]>(readAt('data/shortlist/history.json'), []);
  const last = hist[hist.length - 1];
  const prevRun = hist.length > 1 ? new Set(hist[hist.length - 2].shortlist) : null;
  const newOnShortlist = last && prevRun ? last.shortlist.filter((p) => !prevRun.has(p)).length : 0;
  const shortlistLine = last
    ? ` Tonight's shortlist (${appUrl.replace(/\/?$/, '/')}?view=shortlist): ${last.counts.shortlist} City lots where a two-unit house fits and that passed the zoning and records checks, all ${last.counts.swept.toLocaleString('en-US')} re-checked${prevRun ? `; ${newOnShortlist} new since the run before` : ''}.`
    : '';
  const note = `${watched} City lots watched. Compared with ${before ? before.label : 'nothing (the first digest)'}.${shortlistLine}${appUrl.includes('example') ? ' Links point at a placeholder until the app is deployed (APP_URL).' : ''}`;
  const msg = renderDigest(changes, { appUrl, watched, note, at });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/outbox.json`, JSON.stringify({ ...msg, meta: { at, changes: changes.length, watched, unwatchable, compared_with: before?.label ?? null } }, null, 1) + '\n');
  writeFileSync(`${OUT}/preview.md`, msg.markdown + '\n');
  writeFileSync(`${OUT}/preview.html`, msg.html + '\n');
  console.log(msg.text);
  if (unwatchable.length) console.log(`\n(${unwatchable.length} watched pins aren't City-owned vacant lots on the map; they're skipped.)`);

  if (!flag('send')) {
    console.log(`\n(dry run: wrote ${OUT}/outbox.json, preview.md and preview.html; nothing sent)`);
    console.log(channelsWords());
    return;
  }
  if (!changes.length && !newOnShortlist && !flag('always')) {
    console.log('\nNo change on the watched lots and nothing new on the shortlist: nothing to send.');
    return;
  }
  // The Python sender reads the credentials from .env; they never pass through this process's output.
  try {
    execFileSync('uv', ['run', 'python', '-m', 'pipeline', 'digest', '--send', '--outbox', `${OUT}/outbox.json`], { stdio: 'inherit' });
  } catch {
    console.error('Not sent (see the line above). data/digest/last.json is unchanged, so the next run tries again.');
    process.exit(2);
  }
  writeFileSync(LAST, JSON.stringify(now, null, 1) + '\n'); // a change pings once
  console.log(`recorded the state sent → ${LAST}`);
}

if (process.argv[1]?.endsWith('digest.ts')) main();
