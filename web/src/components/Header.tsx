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

interface Crumb {
  label: string;
  href?: string;
}

export function Header({ crumbs, s, update }: { crumbs: Crumb[]; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
  return (
    <header className="app-head">
      <Cartouche />
      <nav className="crumbs" aria-label="Where you are">
        <ol>
          {crumbs.map((c, i) => (
            <li key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      {!s.record && <Search update={update} />}
      {!s.record && (
        <div className="head-tools">
          <a className="btn btn-quiet" href="?view=review&district=RM-M">
            Rules
          </a>
          <button className="btn btn-quiet" onClick={() => update({ present: !s.present })} aria-pressed={s.present}>
            {s.present ? 'Exit presentation' : 'Present'}
          </button>
        </div>
      )}
    </header>
  );
}

function Search({ update }: { update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
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
        placeholder="Address or lot, e.g. 2241 Mahon"
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
      <p id="search-cover" className="search-cover">
        Lot detail covers {covers}.
      </p>
      {open && q.trim().length >= 2 && (
        <ul id="search-results" className="search-results" role="listbox">
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
