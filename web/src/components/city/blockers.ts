// How each first blocker looks on the city map (DESIGN_GUIDE §2, citywide blocker colors). The
// legend always prints the words; color is never the only carrier.
import { BLOCKER_WORDS, type Blocker } from '@engine/city';

export interface BlockerStyle {
  id: Blocker;
  words: string;
  /** Short gloss for the legend, in plain words. */
  gloss: string;
  token: string; // CSS custom property for the fill or ring
  hollow?: boolean;
  dashed?: boolean;
  ring?: string; // a second ring, e.g. records disagree: ink dot with a red ring
  alpha?: number;
  grey?: boolean; // not computed: never a guess
}

export const STYLE: Record<Blocker, BlockerStyle> = {
  width: { id: 'width', words: BLOCKER_WORDS.width, gloss: 'setbacks leave too little width', token: '--red' },
  area: { id: 'area', words: BLOCKER_WORDS.area, gloss: 'smaller than the minimum lot size', token: '--area' },
  depth: { id: 'depth', words: BLOCKER_WORDS.depth, gloss: 'too shallow after front and rear setbacks', token: '--depth' },
  ownership: { id: 'ownership', words: BLOCKER_WORDS.ownership, gloss: 'fits, but the City is not selling it', token: '--gold' },
  fits: { id: 'fits', words: BLOCKER_WORDS.fits, gloss: 'no dimensional rule stops it, and it is for sale', token: '--ink', hollow: true },
  records: { id: 'records', words: BLOCKER_WORDS.records, gloss: 'County and City areas differ: can’t score', token: '--ink', ring: '--red' },
  edges: { id: 'edges', words: BLOCKER_WORDS.edges, gloss: 'front and sides could not be told apart', token: '--graphite', hollow: true, dashed: true, grey: true },
  rules: { id: 'rules', words: BLOCKER_WORDS.rules, gloss: 'no signed rules for this district', token: '--graphite', alpha: 0.45, grey: true },
};

/** Legend and table order: the dimensional story first, then the honest greys. */
export const LEGEND_ORDER: Blocker[] = ['width', 'area', 'depth', 'ownership', 'fits', 'records', 'edges', 'rules'];

/** Paint order on the canvas: greys underneath, the answer on top. */
export const PAINT_ORDER: Blocker[] = ['rules', 'edges', 'ownership', 'depth', 'area', 'width', 'records', 'fits'];

export const GREY: Blocker[] = ['rules', 'edges', 'records'];

/** District ids read with a non-breaking hyphen in prose: "RM‑M". */
export function zoneName(z: string | null | undefined): string {
  return (z ?? '—').replace(/-/g, '‑');
}

export function n(v: number): string {
  return v.toLocaleString('en-US');
}

export function lotsWord(v: number): string {
  return v === 1 ? 'lot' : 'lots';
}
