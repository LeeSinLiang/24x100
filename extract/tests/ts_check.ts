// Parity helper for extract/tests/test_source.py: runs the app's own locator (engine/src/source.ts)
// on cases read from stdin and prints the verdicts as JSON. Run: npx tsx extract/tests/ts_check.ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkQuote, locateSection, normalizeWs } from '../../engine/src/source';

type Case = { file: string; section: string; quote: string };
const cases: Case[] = JSON.parse(readFileSync(0, 'utf8'));
const cache: Record<string, string> = {};
const text = (f: string) => (cache[f] ??= readFileSync(f, 'utf8'));

const out = cases.map((c) => {
  const t = text(c.file);
  const r = checkQuote(t, c.section, c.quote);
  const span = locateSection(t, c.section);
  const secSha = span ? createHash('sha256').update(normalizeWs(t.slice(span.start, span.end))).digest('hex') : null;
  return { ok: r.ok, in_file: r.inFile, in_section: r.inSection, section_found: r.sectionFound, reason: r.reason, section_sha: secSha };
});
process.stdout.write(JSON.stringify(out));
