// Search finds the lots the app knows, typed the way people type them (judge panel round 1: "2241 Mahon
// Street", "1926 Arlington Ave" and "7406 Race St" all returned "No match").
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addressTokens, buildSearchIndex, normalizeAddress, pinPrefix, searchLots, searchEntry } from '../src/search';
import type { BlockFile, CityLot } from '../src';

const blocks: BlockFile[] = readdirSync('data/blocks')
  .filter((f) => f.endsWith('.json') && !f.includes('crosscheck'))
  .map((f) => JSON.parse(readFileSync(`data/blocks/${f}`, 'utf8')));
const city = JSON.parse(readFileSync('data/city/lots.json', 'utf8')) as { lots: CityLot[] };
const index = buildSearchIndex(blocks, city.lots);
const top = (q: string) => searchLots(index, q)[0]?.entry;

describe('normalizing an address', () => {
  it('case, punctuation, spacing and street types meet in one form', () => {
    for (const q of ['2241 Mahon Street', '2241 mahon street', '2241 Mahon St.', '  2241   MAHON  st ', '2241 Mahon St'])
      expect(normalizeAddress(q)).toBe('2241 mahon st');
    expect(normalizeAddress('1926 Arlington Avenue')).toBe(normalizeAddress('1926 Arlington Ave'));
    expect(normalizeAddress('2250 Wylie Av')).toBe(normalizeAddress('2250 Wylie Ave.'));
    expect(addressTokens("Children's Way West Boulevard Road Drive Place Terrace Lane Court")).toEqual(['childrens', 'way', 'w', 'blvd', 'rd', 'dr', 'pl', 'ter', 'ln', 'ct']);
  });

  it('parcel IDs with or without dashes, and the block-and-lot shorthand', () => {
    expect(pinPrefix('0010K00025000000')).toBe('0010K00025000000');
    expect(pinPrefix('0010-K-00025-0000-00')).toBe('0010K00025000000');
    expect(pinPrefix('10-K-25')).toBe('0010K00025');
    expect(pinPrefix('10K 28A')).toBe('0010K00028000A');
    expect(pinPrefix('2241 Mahon St')).toBeNull();
  });
});

describe('search over every lot the app knows', () => {
  it('indexes every City-owned vacant lot, not just the two detailed blocks', () => {
    expect(city.lots.length).toBe(11247);
    for (const l of city.lots) expect(index.some((e) => e.pin === l.pin)).toBe(true);
    expect(index.filter((e) => e.detail).length).toBe(blocks.reduce((a, b) => a + b.parcels.length, 0));
  });

  it('finds 2241 Mahon St however it is typed, and opens its lot detail', () => {
    for (const q of ['2241 Mahon Street', '2241 mahon street', '2241 Mahon St.', '2241 mahon', '2241 Mahon Stre'])
      expect(top(q)).toMatchObject({ pin: '0010K00025000000', detail: true, lot: '25' });
  });

  it('finds lots from the home page table that have no block detail, as city cards', () => {
    expect(top('1926 Arlington Ave')).toMatchObject({ pin: '0013J00113000000', detail: false });
    expect(top('1926 arlington avenue')).toMatchObject({ pin: '0013J00113000000' });
    expect(top('7406 Race St')).toMatchObject({ pin: '0174L00001000000', detail: false });
    expect(top('7400 Race Street')).toMatchObject({ pin: '0174F00278000000', detail: false });
  });

  it('matches PINs with or without dashes', () => {
    expect(top('0010K00025000000')).toMatchObject({ pin: '0010K00025000000' });
    expect(top('0010-K-00025-0000-00')).toMatchObject({ pin: '0010K00025000000' });
    expect(top('0174-L-00001-0000-00')).toMatchObject({ pin: '0174L00001000000', addr: '7406 Race St' });
    expect(top('10-K-25')).toMatchObject({ pin: '0010K00025000000' });
  });

  it('“lot 26” is lot 26 of a detailed block, not a house number that contains 26', () => {
    const hits = searchLots(index, 'lot 26');
    expect(hits[0].entry).toMatchObject({ detail: true, lot: '26', pin: '0010K00026000000' });
    expect(hits.some((h) => h.entry.addr.startsWith('6426 Winslow'))).toBe(false);
  });

  it('exact address matches and detailed lots rank first', () => {
    const hits = searchLots(index, 'Mahon St');
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.slice(0, 3).every((h) => h.entry.detail)).toBe(true);
    const exact = searchLots(index, '7406 Race St');
    expect(exact[0].exact).toBe(true);
    expect(exact.slice(1).every((h) => !h.exact)).toBe(true);
  });

  it('a house number must match whole, and nothing is invented', () => {
    expect(searchLots(index, '74 Race St').some((h) => h.entry.addr.startsWith('7406'))).toBe(false);
    expect(searchLots(index, 'Nowhere Boulevard 99999')).toEqual([]);
    expect(searchLots(index, 'x')).toEqual([]);
  });
});

describe('ranking: a lot with full detail comes before a city card with the same words', () => {
  it('ranks by detail, not by position in the index', () => {
    const entries = [
      searchEntry({ pin: '0999Z00001000000', addr: '100 Sample St', hood: 'Elsewhere', detail: false }),
      searchEntry({ pin: '0999Z00002000000', addr: '100 Sample St', hood: 'Here', detail: true, lot: '2', place: 'Block 999-Z' }),
    ];
    expect(searchLots(entries, '100 Sample St')[0].entry.detail).toBe(true);
  });
});

