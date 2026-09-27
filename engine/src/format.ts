// Number and formula formatting. Every formula string on screen is built here from the same numbers
// that sit in the result object, and `parseFormula` reads them back for the round-trip tests.

export const MINUS = '−'; // U+2212, between terms: "24 − 10 − 10 = 4"
/** The sign of a negative amount: a hyphen-minus. Old Standard draws U+2212 as wide as a plus sign, so "−$30k" read
 *  as a dash ("$24k to —$30k"); the hyphen reads as a sign at every size and in every font. */
export const NEG = '-';
export const TIMES = '×'; // U+00D7

/** Deed-based feet are integers. */
export function ftInt(n: number): string {
  return `${Math.round(n)}`;
}
/** Mapped feet: one decimal. */
export function ft1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
export function usd(n: number, round = 1000): string {
  const v = Math.round(n / round) * round;
  const s = Math.abs(v).toLocaleString('en-US');
  return v < 0 ? `${NEG}$${s}` : `$${s}`;
}
export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** "24 − 10 − 10 = 4" from [24, 10, 10] (first minus the rest). Values are printed as given. */
export function minusFormula(terms: number[], result: number, fmt: (n: number) => string = ftInt): string {
  return `${terms.map(fmt).join(` ${MINUS} `)} = ${fmt(result)}`;
}

/** Parse "a − b − c = d" (thousands separators and $ allowed) back into numbers. */
export function parseFormula(s: string): { terms: number[]; result: number } | null {
  const m = s.split('=');
  if (m.length !== 2) return null;
  const num = (t: string) => Number(t.replace(/[$,\s]/g, '').replace(MINUS, '-'));
  const terms = m[0].split(MINUS).map((t) => num(t));
  const result = num(m[1]);
  if (terms.some((t) => Number.isNaN(t)) || Number.isNaN(result)) return null;
  return { terms, result };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function listAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The calendar day of a timestamp in Pittsburgh (ET), as YYYY-MM-DD; a bare date is returned as is. A signature
 *  made at 23:49 ET on 26 Sep is stored as 03:49Z on the 27th, so slicing the ISO string dates it a day late. */
export function dayOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
