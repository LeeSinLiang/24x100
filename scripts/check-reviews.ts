// The steward's publish step (docs/pilot.md): check review logs exported from the review screen ("Send to
// the steward") and merge them into data/rules/reviews.json, the log every visitor's app starts from.
//
//   npm run check-reviews -- [files…] [--write] [--allow-flagged] [--reviews data/rules/reviews.json]
//
// With no files it reads data/rules/uploads/*.json (where a steward can drop a file through GitHub's web
// upload). Without --write nothing changes: it only reports. It fails (exit 1) on any invalid entry, on an
// id already published with different content, and, unless --allow-flagged, on entries that look like a
// placeholder or a test, an AI "review", or a published assumption. Every check is the app's own
// (web/src/components/review/reviewlog.ts, engine/src/rules.ts auditProblems).
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEntry, describeEntry, entriesOf, mergeLog, stateChanges, type PublishedEntry, type Store } from '../web/src/components/review/reviewlog';
import type { Question, Rule } from '../engine/src/types';

export interface CheckOptions {
  files: string[];
  reviews: string;
  write: boolean;
  allowFlagged: boolean;
  root?: string; // repo root (tests use a temp copy)
  now?: number;
}

export interface CheckReport {
  ok: boolean;
  lines: string[];
  added: number;
  merged: PublishedEntry[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadStore(root: string): Store {
  const rules = new Map<string, Rule>();
  for (const dir of ['data/rules/base', 'data/rules/extracted']) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
      const j = readJson(join(d, f)) as Rule[] | { rules?: Rule[] };
      const list = Array.isArray(j) ? j : Array.isArray(j.rules) ? j.rules : [];
      for (const r of list) if (r && typeof r.id === 'string') rules.set(r.id, r);
    }
  }
  const qPath = join(root, 'data/rules/questions.json');
  const questions = new Map<string, Question>(existsSync(qPath) ? (readJson(qPath) as Question[]).map((q) => [q.id, q]) : []);
  const code = new Map<string, string | null>();
  const codeFor = (file: string) => {
    if (!code.has(file)) code.set(file, existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null);
    return code.get(file)!;
  };
  return { rules, questions, codeFor };
}

export function checkReviews(o: CheckOptions): CheckReport {
  const root = o.root ?? '.';
  const store = loadStore(root);
  const lines: string[] = [];
  let ok = true;
  const reviewsPath = join(root, o.reviews);
  const published = (existsSync(reviewsPath) ? entriesOf(readJson(reviewsPath)) ?? [] : []) as PublishedEntry[];

  // Entries already published: a rule that changed since is a warning, never a reason to rewrite them.
  for (const raw of published) {
    const c = checkEntry(raw, store, { incoming: false, now: o.now });
    for (const w of [...c.errors, ...c.warnings]) lines.push(`  published ${(raw as { id?: string }).id}: ${w}`);
    if (c.errors.length) ok = false;
  }

  const incoming: PublishedEntry[] = [];
  for (const f of o.files) {
    const list = entriesOf(readJson(join(root, f)));
    if (!list) {
      lines.push(`✗ ${f}: expected { "entries": [...] } or a list of entries`);
      ok = false;
      continue;
    }
    lines.push(`${f}: ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`);
    list.forEach((raw, i) => {
      const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : `entry ${i + 1}`;
      const c = checkEntry(raw, store, { incoming: true, now: o.now });
      for (const e of c.errors) lines.push(`  ✗ ${id}: ${e}`);
      for (const w of c.warnings) lines.push(`  ! ${id}: ${w}`);
      for (const fl of c.flags) lines.push(`  ${o.allowFlagged ? '!' : '✗'} ${id}: ${fl}${o.allowFlagged ? ' (allowed with --allow-flagged)' : ''}`);
      if (c.errors.length || (c.flags.length && !o.allowFlagged)) {
        ok = false;
        return;
      }
      if (c.entry) incoming.push(c.flags.length ? { ...c.entry, flags_accepted_at: new Date(o.now ?? Date.now()).toISOString() } : c.entry);
    });
  }

  const m = mergeLog(published, incoming);
  for (const c of m.conflicts) {
    lines.push(`  ✗ ${c.id}: ${c.why}`);
    ok = false;
  }
  if (m.duplicates) lines.push(`${m.duplicates} already published (skipped)`);
  for (const e of m.added) lines.push(`+ ${describeEntry(e, store)}`);
  const changes = stateChanges([...store.rules.values()], published, m.merged);
  for (const ch of changes) lines.push(`  ${ch.rule.id}: ${ch.before} → ${ch.after}`);
  lines.push(ok ? `OK: ${m.added.length} new ${m.added.length === 1 ? 'entry' : 'entries'}, ${changes.length} rule ${changes.length === 1 ? 'state changes' : 'states change'}${o.write ? '' : ' (dry run: add --write to publish)'}` : 'NOT PUBLISHED: fix the entries marked ✗ (or, for flags only, re-run with --allow-flagged after a person has looked)');

  if (ok && o.write && m.added.length) writeFileSync(reviewsPath, JSON.stringify({ note: 'Published review log. Only scripts/check-reviews.ts writes this file; entries are never rewritten.', entries: m.merged }, null, 1) + '\n');
  return { ok, lines, added: m.added.length, merged: m.merged };
}

function main() {
  const argv = process.argv.slice(2);
  const val = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  const flags = new Set(['--write', '--allow-flagged']);
  const skip = new Set<number>();
  argv.forEach((a, i) => a === '--reviews' && (skip.add(i), skip.add(i + 1)));
  let files = argv.filter((a, i) => !flags.has(a) && !skip.has(i));
  if (!files.length && existsSync('data/rules/uploads')) files = readdirSync('data/rules/uploads').filter((f) => f.endsWith('.json')).map((f) => `data/rules/uploads/${f}`);
  const r = checkReviews({ files, reviews: val('--reviews', 'data/rules/reviews.json'), write: argv.includes('--write'), allowFlagged: argv.includes('--allow-flagged') });
  const out = r.lines.join('\n');
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Review log check\n\n\`\`\`\n${out}\n\`\`\`\n`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith('check-reviews.ts')) main();
