// Saved code text: locate a cited section and check that a quote appears in it word for word
// (whitespace-normalized). Section paths look like "903.03.C", "903.03.C.2(c)", "925.06.C".
// The saved text keeps one structural marker per line: "§ 903.03", "C. ", "2. ", "(c) ".

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface Span {
  start: number; // char offset into the file text
  end: number;
}

function lineOffsets(lines: string[]): number[] {
  const off: number[] = [];
  let o = 0;
  for (const l of lines) {
    off.push(o);
    o += l.length + 1;
  }
  return off;
}

type Part = { kind: 'letter' | 'number' | 'paren'; label: string };

function parseParts(rest: string): Part[] {
  const parts: Part[] = [];
  for (const tok of rest.split('.').filter(Boolean)) {
    const m = tok.match(/^([A-Za-z0-9]+)((?:\([a-z0-9]+\))*)$/);
    if (!m) continue;
    const head = m[1];
    parts.push({ kind: /^\d+$/.test(head) ? 'number' : 'letter', label: head });
    for (const p of m[2].match(/\([a-z0-9]+\)/g) ?? []) parts.push({ kind: 'paren', label: p.slice(1, -1) });
  }
  return parts;
}

const HEADING = /^§ \d{3}\.\d{2}\b/;

/** Char span of a section in the saved text, or null when it can't be found. */
export function locateSection(text: string, section: string): Span | null {
  const m = section.match(/^(\d{3}\.\d{2})(?:\.(.*))?$/);
  if (!m) return null;
  const base = m[1];
  const lines = text.split('\n');
  const off = lineOffsets(lines);
  // The body occurrence of "§ 903.03" is the one not immediately followed by another heading.
  let s0 = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `§ ${base}`) continue;
    let j = i + 1;
    let seen = 0;
    let headingSoon = false;
    while (j < lines.length && seen < 3) {
      if (lines[j].trim()) {
        seen++;
        if (HEADING.test(lines[j].trim())) headingSoon = true;
      }
      j++;
    }
    if (!headingSoon) {
      s0 = i;
      break;
    }
  }
  if (s0 < 0) return null;
  let e0 = lines.length;
  for (let i = s0 + 1; i < lines.length; i++) if (HEADING.test(lines[i].trim())) { e0 = i; break; }
  let lo = s0;
  let hi = e0;
  for (const p of parseParts(m[2] ?? '')) {
    const want = p.kind === 'paren' ? `(${p.label})` : `${p.label}.`;
    const sib = p.kind === 'letter' ? /^[A-Z]\.$/ : p.kind === 'number' ? /^\d+\.$/ : /^\([a-z0-9]+\)$/;
    let s = -1;
    for (let i = lo + 1; i < hi; i++) if (lines[i].trim() === want) { s = i; break; }
    if (s < 0) return null;
    let e = hi;
    for (let i = s + 1; i < hi; i++) if (sib.test(lines[i].trim())) { e = i; break; }
    lo = s;
    hi = e;
  }
  return { start: off[lo], end: hi < lines.length ? off[hi] : text.length };
}

export interface QuoteCheck {
  ok: boolean;
  inFile: boolean;
  inSection: boolean;
  sectionFound: boolean;
  reason: string | null;
}

export function checkQuote(text: string, section: string, quote: string): QuoteCheck {
  const q = normalizeWs(quote);
  if (!q) return { ok: false, inFile: false, inSection: false, sectionFound: false, reason: 'empty quote' };
  const inFile = normalizeWs(text).includes(q);
  const span = locateSection(text, section);
  const inSection = !!span && normalizeWs(text.slice(span.start, span.end)).includes(q);
  const ok = inFile && (span ? inSection : false);
  const reason = ok
    ? null
    : !inFile
      ? 'quote does not appear word for word in the source file'
      : !span
        ? `section ${section} not found in the source file`
        : `quote appears in the file but not inside §${section}`;
  return { ok, inFile, inSection, sectionFound: !!span, reason };
}

/** Raw char range of a quote inside the file (for highlighting), tolerant of whitespace. */
export function findQuote(text: string, quote: string, within?: Span): Span | null {
  const toks = normalizeWs(quote)
    .split(' ')
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!toks.length) return null;
  const re = new RegExp(toks.join('\\s+'));
  const hay = within ? text.slice(within.start, within.end) : text;
  const m = re.exec(hay);
  if (!m) return null;
  const base = within ? within.start : 0;
  return { start: base + m.index, end: base + m.index + m[0].length };
}
