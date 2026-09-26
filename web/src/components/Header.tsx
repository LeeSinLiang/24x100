import { useMemo, useState } from 'react';
import type { BlockFile, Parcel } from '@engine/types';
import { BLOCKS } from '../lib/data';
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

function allLots(): { block: BlockFile; p: Parcel; text: string }[] {
  return Object.values(BLOCKS).flatMap((block) =>
    block.parcels.map((p) => ({ block, p, text: `${p.addr} ${lotKey(p)} lot ${p.lot} ${p.pin} ${block.meta.name} ${block.meta.neighborhood}`.toLowerCase() })),
  );
}

function Search({ update }: { update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const index = useMemo(allLots, []);
  const hits = q.trim().length >= 2 ? index.filter((x) => q.toLowerCase().split(/\s+/).every((t) => x.text.includes(t))).slice(0, 7) : [];
  const covers = Object.values(BLOCKS)
    .map((b) => `${b.meta.name} (${b.meta.neighborhood})`)
    .join(' and ');
  const go = (x: { block: BlockFile; p: Parcel }) => {
    update({ view: 'lot', block: x.block.meta.id, lot: lotKey(x.p), lots: [], drawer: null }, { push: true });
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
        onChange={(e) => {
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
          {hits.map((x) => (
            <li key={x.p.pin} role="option" aria-selected="false">
              <button onClick={() => go(x)}>
                <strong>{x.p.addr}</strong> · lot {lotKey(x.p)} · {x.block.meta.name}
              </button>
            </li>
          ))}
          {!hits.length && (
            <li className="no-match">
              No match for “{q}”. Lot detail covers {covers}. The city map shows every City-owned vacant lot.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
