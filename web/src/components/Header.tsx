import { useMemo, useState } from 'react';
import { buildSearchIndex, searchLots, type SearchHit } from '@engine/search';
import { BLOCKS } from '../lib/data';
import { loadCityData } from './city/cityData';
import { lotKey } from '../lib/model';
import type { UrlState } from '../lib/url';

export function Cartouche() {
  return (
    <a className="cartouche" href="?view=city" aria-label="24×100, home: the city map">
      <span className="cartouche-num">24×100</span>
      <span className="cartouche-sub">Pittsburgh lot atlas</span>
    </a>
  );
}

/** The command search: every lot on a detailed block, and every City-owned vacant lot once the citywide
 *  file has loaded. A lot on a detailed block opens the lot view; any other opens its city card. */
export function Search({ update }: { update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  // Every lot on a detailed block at once; every City-owned vacant lot once the citywide file has loaded
  // (it loads when the search box is first used, not on every page).
  const [cityLots, setCityLots] = useState<{ pin: string; addr: string; hood: string }[] | null>(null);
  const warm = () => {
    if (cityLots) return;
    loadCityData().then((d) => d.state === 'ready' && setCityLots(d.lots.map((l) => ({ pin: l.pin, addr: l.addr, hood: l.hood ?? '' }))));
  };
  const index = useMemo(() => buildSearchIndex(Object.values(BLOCKS), cityLots ?? []), [cityLots]);
  const hits: SearchHit[] = useMemo(() => searchLots(index, q), [index, q]);
  const covers = Object.values(BLOCKS)
    .map((b) => `${b.meta.name} (${b.meta.neighborhood})`)
    .join(' and ');
  const go = (h: SearchHit) => {
    const block = h.entry.detail ? Object.values(BLOCKS).find((b) => b.parcels.some((p) => p.pin === h.entry.pin)) : undefined;
    const p = block?.parcels.find((x) => x.pin === h.entry.pin);
    if (block && p) update({ view: 'lot', block: block.meta.id, lot: lotKey(p), lots: [], drawer: null }, { push: true });
    else update({ view: 'city', pin: h.entry.pin, hood: h.entry.hood || null, layer: null, run: null, drawer: null }, { push: true });
    setQ('');
    setOpen(false);
  };
  return (
    <div className="search" role="search">
      <label className="visually-hidden" htmlFor="search">
        Find a lot by address or lot number
      </label>
      <input
        id="search"
        value={q}
        placeholder="Search a lot, street or block…"
        autoComplete="off"
        onFocus={warm}
        onChange={(e) => {
          warm();
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) go(hits[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
        aria-describedby="search-cover"
        aria-expanded={open && q.length >= 2}
        aria-controls="search-results"
      />
      <p id="search-cover" className="visually-hidden">
        Address or lot, e.g. 2241 Mahon. Lot detail covers {covers}.
      </p>
      {open && q.trim().length >= 2 && (
        <ul id="search-results" className="search-results" role="listbox">
          <li className="search-note" role="presentation">
            Lot detail covers {covers}; every other City-owned vacant lot opens its city card.
          </li>
          {hits.map((h) => (
            <li key={h.entry.pin} role="option" aria-selected="false">
              <button onClick={() => go(h)}>
                <strong>{h.entry.addr}</strong>
                {h.entry.detail ? ` · lot ${h.entry.lot} · ${h.entry.place}` : ` · ${h.entry.hood || 'City-owned vacant lot'} · city card`}
              </button>
            </li>
          ))}
          {!hits.length && (
            <li className="no-match">
              {cityLots ? `No match for “${q}” among the lots on detailed blocks and every City-owned vacant lot.` : `No match for “${q}” yet; loading every City-owned vacant lot…`} Lot detail covers {covers}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
