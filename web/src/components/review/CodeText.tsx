// The saved code text of the sections a district's rules cite, tidied for reading: blank lines
// collapsed, structural markers ("C.", "2.", "(c)") joined to their text and indented, and the
// ecode360 table cells (" | ") laid out as rows. Every rule's quote is highlighted in place, by raw
// character offsets, so the highlight is exactly the span findQuote() matched. The law's own words
// are ink; only the mark (dashed, solid, struck) carries the rule's state, so marks don't boil.
import type { ReactNode } from 'react';

type Piece = [number, number]; // raw [start, end) in the file text

type Node =
  | { kind: 'heading'; pieces: Piece[] }
  | { kind: 'para'; depth: number; marker: Piece | null; pieces: Piece[]; note: boolean }
  | { kind: 'table'; rows: { cells: Piece[][]; type: 'row' | 'sub' | 'note' }[] };

export type HlStyle = 'ink' | 'sealed' | 'pencil' | 'red' | 'struck';

export interface Highlight {
  id: string; // rule id, or "q:<question id>"
  start: number;
  end: number;
  style: HlStyle;
}

export interface CodeBlock {
  file: string; // "data/code/ch903.txt"
  label: string; // "903.03.C"
  sections: string[]; // every cited section merged into this block
  start: number;
  end: number;
}

const MARKER = /^(?:[A-Z]|\d{1,2}|\([a-z0-9]{1,5}\))\.?$/;
const HEADING = /^§ \d{3}\.\d{2}\b/;

function depthOf(marker: string): number {
  if (/^\([a-z0-9]+\)$/.test(marker)) return /^\([ivx]+\)$/.test(marker) && marker !== '(i)' ? 3 : 2;
  if (/^\d/.test(marker)) return 1;
  return 0;
}

interface Line {
  t: string; // trimmed
  ts: number; // raw offset of the trimmed text
  te: number;
}

function linesOf(text: string, start: number, end: number): Line[] {
  const out: Line[] = [];
  let o = start;
  for (const raw of text.slice(start, end).split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    out.push({ t, ts: o + lead, te: o + lead + t.length });
    o += raw.length + 1;
  }
  return out;
}

export function parseBlock(text: string, start: number, end: number): Node[] {
  const L = linesOf(text, start, end);
  const nodes: Node[] = [];
  let depth = 0;
  let i = 0;
  const isBreak = (t: string) => t === '|' || MARKER.test(t) || HEADING.test(t);
  while (i < L.length) {
    const l = L[i];
    if (!l.t) {
      i++;
      continue;
    }
    if (l.t === '|') {
      // One table row: cells end with " |"; the last cell of a row doesn't.
      const cells: Piece[][] = [];
      let cur: Piece[] = [];
      let open = false;
      let j = i + 1;
      while (j < L.length && !isBreak(L[j].t)) {
        const m = L[j];
        j++;
        if (!m.t) continue;
        if (m.t.endsWith('|')) {
          const content = m.t.slice(0, -1).trimEnd();
          if (content) cur.push([m.ts, m.ts + content.length]);
          cells.push(cur);
          cur = [];
          open = true;
        } else {
          cur.push([m.ts, m.te]);
          open = false;
        }
      }
      if (cur.length) cells.push(cur);
      const filled = cells.filter((c) => c.length);
      if (filled.length) {
        const type = filled.length >= 2 ? 'row' : open ? 'sub' : 'note';
        const last = nodes[nodes.length - 1];
        const row = { cells: filled, type } as const;
        if (last?.kind === 'table') last.rows.push(row);
        else nodes.push({ kind: 'table', rows: [row] });
      }
      i = j;
      continue;
    }
    if (HEADING.test(l.t)) {
      const pieces: Piece[] = [[l.ts, l.te]];
      let j = i + 1;
      while (j < L.length && !L[j].t) j++;
      if (j < L.length && !isBreak(L[j].t)) {
        pieces.push([L[j].ts, L[j].te]);
        j++;
      }
      nodes.push({ kind: 'heading', pieces });
      depth = 0;
      i = j;
      continue;
    }
    let marker: Piece | null = null;
    if (MARKER.test(l.t)) {
      marker = [l.ts, l.te];
      depth = depthOf(l.t.replace(/\.$/, ''));
      i++;
      while (i < L.length && !L[i].t) i++;
    }
    const pieces: Piece[] = [];
    while (i < L.length && L[i].t && !isBreak(L[i].t)) {
      pieces.push([L[i].ts, L[i].te]);
      i++;
    }
    if (marker || pieces.length) {
      const first = pieces.length ? text.slice(pieces[0][0], pieces[0][1]) : '';
      nodes.push({ kind: 'para', depth, marker, pieces, note: /^\[(Ord|Amended|Added)/.test(first) });
    }
  }
  return nodes;
}

// Which style wins where highlights overlap: the weakest one (pencil, then red, then ink).
const RANK: Record<HlStyle, number> = { pencil: 4, red: 3, ink: 2, sealed: 2, struck: 1 };

function Pieces({ text, pieces, hls, active, onPick }: { text: string; pieces: Piece[]; hls: Highlight[]; active: Set<string>; onPick: (ids: string[]) => void }) {
  const out: ReactNode[] = [];
  pieces.forEach(([a, b], pi) => {
    if (pi > 0) out.push(' ');
    const near = hls.filter((h) => h.start < b && h.end > a);
    const cuts = [...new Set([a, b, ...near.flatMap((h) => [h.start, h.end]).filter((x) => x > a && x < b)])].sort((x, y) => x - y);
    for (let k = 0; k < cuts.length - 1; k++) {
      const x = cuts[k];
      const y = cuts[k + 1];
      const s = text.slice(x, y);
      const cover = near.filter((h) => h.start <= x && h.end >= y);
      if (!cover.length) {
        out.push(s);
        continue;
      }
      const top = [...cover].sort((p, q) => RANK[q.style] - RANK[p.style])[0];
      const ids = cover.map((h) => h.id);
      const ruleId = cover.find((h) => !h.id.startsWith('q:'))?.id;
      const trust = top.style === 'sealed' ? 'ink' : top.style;
      out.push(
        <mark
          key={`${x}-${ids.join(',')}`}
          className={`hl hl-${top.style} ${ids.some((id) => active.has(id)) ? 'is-active' : ''}`}
          data-hl={ids.join(' ')}
          data-rule-id={ruleId}
          data-question-id={cover.find((h) => h.id.startsWith('q:'))?.id.slice(2)}
          data-trust={trust}
          onClick={() => onPick(ids)}
        >
          {s}
        </mark>,
      );
    }
  });
  return <>{out}</>;
}

function sourceLine(text: string): { url: string | null; retrieved: string | null } {
  const head = text.slice(0, 600);
  return { url: head.match(/^Source: (\S+)/m)?.[1] ?? null, retrieved: head.match(/^Retrieved: (\d{4}-\d{2}-\d{2})/m)?.[1] ?? null };
}

export function CodeText({
  block,
  text,
  hls,
  active,
  onPick,
}: {
  block: CodeBlock;
  text: string;
  hls: Highlight[];
  active: Set<string>;
  onPick: (ids: string[]) => void;
}) {
  const nodes = parseBlock(text, block.start, block.end);
  const mine = hls.filter((h) => h.start < block.end && h.end > block.start);
  const src = sourceLine(text);
  const P = (pieces: Piece[]) => <Pieces text={text} pieces={pieces} hls={mine} active={active} onPick={onPick} />;
  return (
    <section className="ct-block" data-file={block.file} data-section={block.label} aria-label={`Saved text of §${block.label}`}>
      <header className="ct-head">
        <h3 className="ct-sec">§{block.label}</h3>
        <p className="ct-src">
          {block.sections.length > 1 ? `cited as ${block.sections.map((s) => `§${s}`).join(', ')} · ` : ''}
          saved text, {block.file.split('/').pop()}
          {src.url ? (
            <>
              {' · '}
              <a href={src.url} target="_blank" rel="noreferrer">
                ecode360
              </a>
            </>
          ) : null}
          {src.retrieved ? `, retrieved ${src.retrieved}` : ''}
        </p>
      </header>
      <div className="ct-body">
        {nodes.map((n, i) => {
          if (n.kind === 'heading') return <p key={i} className="ct-h">{P(n.pieces)}</p>;
          if (n.kind === 'para')
            return (
              <p key={i} className={`ct-p d${n.depth} ${n.note ? 'ct-note' : ''}`}>
                {n.marker && <span className="ct-m">{P([n.marker])}</span>}
                {P(n.pieces)}
              </p>
            );
          return (
            <div key={i} className="ct-table" role="table">
              {n.rows.map((r, k) => (
                <div key={k} className={`ct-row ct-${r.type}`} role="row">
                  {r.cells.map((c, ci) => (
                    <span key={ci} className="ct-cell" role="cell">
                      {P(c)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
