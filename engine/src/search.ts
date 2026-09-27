// Lot search: forgiving about case, punctuation, spacing and street types ("2241 Mahon Street",
// "2241 mahon st."), and about parcel IDs with or without dashes ("0010-K-00025-0000-00", "10-K-25").
// Pure, so the header and the tests use the same code.
import type { BlockFile } from './types';

/** Street types and directions, each spelling mapped to one form. Applied to both the query and the
 *  address, so "Street" and "St." meet at "st" (as does "Saint": harmless, since both sides agree). */
const CANON: Record<string, string> = {};
const FULL: Record<string, string> = {}; // full word → canonical, for words still being typed ("Stre…")
for (const [canon, spellings] of Object.entries({
  st: ['street', 'str', 'st', 'saint'],
  ave: ['avenue', 'aven', 'avn', 'av', 'ave'],
  rd: ['road', 'rd'],
  dr: ['drive', 'drv', 'dr'],
  way: ['way', 'wy'],
  pl: ['place', 'pl'],
  blvd: ['boulevard', 'boul', 'blv', 'blvd'],
  ter: ['terrace', 'terr', 'ter'],
  ln: ['lane', 'ln'],
  ct: ['court', 'ct'],
  cir: ['circle', 'cir'],
  sq: ['square', 'sq'],
  aly: ['alley', 'aly'],
  hwy: ['highway', 'hwy'],
  pkwy: ['parkway', 'pkwy', 'pky'],
  ext: ['extension', 'ext'],
  hts: ['heights', 'hts'],
  mt: ['mount', 'mt'],
  pt: ['point', 'pt'],
  plz: ['plaza', 'plz'],
  trl: ['trail', 'trl'],
  n: ['north', 'n'],
  s: ['south', 's'],
  e: ['east', 'e'],
  w: ['west', 'w'],
})) {
  for (const sp of spellings) CANON[sp] = canon;
  FULL[spellings[0]] = canon;
}

/** Lowercase words, apostrophes dropped, other punctuation as spaces, street types in one form. */
export function addressTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => CANON[t] ?? t);
}

export function normalizeAddress(s: string): string {
  return addressTokens(s.replace(/\(no number\)/i, '')).join(' ');
}

/** Words a pasted mailing address carries after the street: the city, the state and the ZIP code. */
const PLACE = new Set(['pittsburgh', 'pgh', 'pa', 'pennsylvania', 'usa']);
const PLACE_WORDS = ['pittsburgh', 'pennsylvania'];

/** Query tokens without a trailing ", Pittsburgh, PA 15219" (city, state, ZIP or ZIP+4, in any mix), so a
 *  pasted full address matches the lot's own address. Only trailing words go, and only while a street
 *  name is left before them: "Pennsylvania Ave" and a lone "15219" stay as typed. A last word still
 *  being typed ("…St, Pitts") goes when it follows a street type or a place word. */
export function stripPlace(tokens: string[]): string[] {
  const out = [...tokens];
  const streetType = new Set(Object.values(CANON));
  const left = (n: number) => out.slice(0, n).some((t) => /[a-z]/.test(t));
  for (;;) {
    const n = out.length;
    const t = out[n - 1];
    if (n < 2 || !left(n - 1)) break;
    const zip4 = /^\d{4}$/.test(t) && /^\d{5}$/.test(out[n - 2] ?? '');
    const partial = t.length >= 3 && PLACE_WORDS.some((w) => w.startsWith(t)) && (streetType.has(out[n - 2]) || PLACE.has(out[n - 2]) || /^\d{5}$/.test(out[n - 2]));
    if (PLACE.has(t) || /^\d{5}$/.test(t) || zip4 || partial) out.pop();
    else break;
  }
  return out;
}

/** A parcel ID typed any way ("0010K00025000000", "0010-K-00025-0000-00", "10-K-25", "10K 25A") as a
 *  PIN prefix, or null when the query isn't shaped like one. */
export function pinPrefix(q: string): string | null {
  const raw = q.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // County PIN: 4-digit block, block letter, 5-digit lot, then 6 more (a lot suffix letter may sit among them).
  if (/^\d{4}[A-Z](\d{0,4}|\d{5}[0-9A-Z]{0,6})$/.test(raw)) return raw;
  // Block-and-lot shorthand: block number, block letter, lot number, optional lot suffix.
  const m = q.toUpperCase().match(/^\s*(?:BLOCK\s*)?0*(\d{1,4})\s*-?\s*([A-Z])\s*[-\s]\s*(?:LOT\s*)?0*(\d{1,5})\s*-?\s*([A-Z])?\s*$/);
  if (m) return `${m[1].padStart(4, '0')}${m[2]}${m[3].padStart(5, '0')}${m[4] ? `000${m[4]}` : ''}`;
  return null;
}

export interface SearchEntry {
  pin: string;
  addr: string;
  hood: string;
  detail: boolean; // the lot view has this lot (a block file); otherwise its city card
  lot?: string; // County lot number within its block, for lots with detail
  place?: string; // "Block 10-K"
  tokens: string[]; // address tokens (plus "lot <n>" for lots with detail)
  norm: string; // normalized address
}

export function searchEntry(x: { pin: string; addr: string; hood: string; detail: boolean; lot?: string; place?: string }): SearchEntry {
  const addr = addressTokens(x.addr);
  return { ...x, tokens: [...addr, ...(x.lot ? ['lot', x.lot.toLowerCase()] : [])], norm: normalizeAddress(x.addr) };
}

/** One entry per PIN: every parcel in a block file (lot detail), then every City-owned vacant lot
 *  in data/city/lots.json that isn't in one (its city card). */
export function buildSearchIndex(blocks: BlockFile[], cityLots: { pin: string; addr: string; hood: string }[]): SearchEntry[] {
  const out: SearchEntry[] = [];
  const seen = new Set<string>();
  for (const b of blocks)
    for (const p of b.parcels) {
      if (seen.has(p.pin)) continue;
      seen.add(p.pin);
      out.push(searchEntry({ pin: p.pin, addr: p.addr, hood: b.meta.neighborhood, detail: true, lot: `${p.lot ?? ''}${p.lot_suffix ?? ''}`, place: b.meta.name }));
    }
  for (const l of cityLots) {
    if (seen.has(l.pin)) continue;
    seen.add(l.pin);
    out.push(searchEntry({ pin: l.pin, addr: l.addr, hood: l.hood, detail: false }));
  }
  return out;
}

/** Does query token q match entry token t? Whole words match; a partly typed last word matches as a
 *  prefix, including the start of a street type ("stre" → st). */
function tokenScore(q: string, t: string, last: boolean): number {
  if (q === t) return 2;
  if (!last) return /^\d+$/.test(q) ? 0 : t.startsWith(q) && q.length >= 3 ? 1 : 0;
  if (t.startsWith(q)) return 1;
  for (const [full, canon] of Object.entries(FULL)) if (q.length >= 2 && full.startsWith(q) && t === canon) return 1;
  return 0;
}

function addressScore(e: SearchEntry, qt: string[], qn: string): { s: number; exact: boolean } | null {
  let words = 0;
  const used = new Set<number>();
  for (let i = 0; i < qt.length; i++) {
    let best = 0;
    let at = -1;
    e.tokens.forEach((t, j) => {
      if (used.has(j)) return;
      const v = tokenScore(qt[i], t, i === qt.length - 1);
      if (v > best) {
        best = v;
        at = j;
      }
    });
    if (!best) return null;
    used.add(at);
    words += best;
  }
  const exact = e.norm === qn;
  return { s: (exact ? 5_000 : 0) + words * 10 + (e.norm.startsWith(qn) ? 5 : 0), exact };
}

export interface SearchHit {
  entry: SearchEntry;
  exact: boolean;
}

/** Ranked matches: exact address or PIN first, then lots with full detail, then the closest words. */
export function searchLots(entries: SearchEntry[], query: string, limit = 7): SearchHit[] {
  const q = query.trim();
  if (q.replace(/[^0-9a-z]/gi, '').length < 2) return [];
  const pin = pinPrefix(q);
  const qt = stripPlace(addressTokens(q));
  const qn = qt.join(' ');
  const scored: { e: SearchEntry; s: number; exact: boolean }[] = [];
  for (const e of entries) {
    let s = 0;
    let exact = false;
    if (pin && e.pin.startsWith(pin)) {
      exact = e.pin === pin || pin.length >= 10;
      s = exact ? 10_000 : 5_000;
    }
    const a = qt.length ? addressScore(e, qt, qn) : null;
    if (a && a.s > s) {
      s = a.s;
      exact = a.exact;
    }
    if (!s) continue;
    if (e.detail) s += 1_000;
    scored.push({ e, s, exact });
  }
  scored.sort((a, b) => b.s - a.s || a.e.addr.localeCompare(b.e.addr, 'en', { numeric: true }) || a.e.pin.localeCompare(b.e.pin));
  return scored.slice(0, limit).map((x) => ({ entry: x.e, exact: x.exact }));
}
