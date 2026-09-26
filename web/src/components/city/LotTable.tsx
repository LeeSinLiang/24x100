// The keyboard way into the city map: every lot on the map as a row, sortable and paged, selecting
// in sync with the dots.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CityClass } from '@engine/city';
import { Ev } from '../ui';
import { LEGEND_ORDER, STYLE, n, zoneName } from './blockers';
import type { CityLotRow } from './cityData';

type SortKey = 'blocker' | 'hood' | 'addr' | 'width';
const PAGE = 50;

const COLS: { key: SortKey | null; label: string; cls?: string }[] = [
  { key: 'addr', label: 'Address' },
  { key: 'hood', label: 'Neighborhood' },
  { key: null, label: 'Zone' },
  { key: 'blocker', label: 'First blocker' },
  { key: 'width', label: 'Width as of right', cls: 'num' },
  { key: null, label: 'City status' },
];

export function LotTable({
  lots,
  classes,
  rows,
  selected,
  onSelect,
  caption,
}: {
  lots: CityLotRow[];
  classes: CityClass[];
  rows: number[]; // indices into lots, already filtered to the view
  selected: number | null;
  onSelect: (i: number) => void;
  caption: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'blocker', dir: 1 });
  const [page, setPage] = useState(0);
  const selRow = useRef<HTMLTableRowElement>(null);

  const sorted = useMemo(() => {
    const rank = (i: number) => LEGEND_ORDER.indexOf(classes[i].blocker);
    const by: Record<SortKey, (a: number, b: number) => number> = {
      blocker: (a, b) => rank(a) - rank(b),
      hood: (a, b) => lots[a].hood.localeCompare(lots[b].hood),
      addr: (a, b) => lots[a].addr.localeCompare(lots[b].addr, 'en', { numeric: true }),
      width: (a, b) => (classes[a].width ?? -1) - (classes[b].width ?? -1),
    };
    const tie = (a: number, b: number) => lots[a].hood.localeCompare(lots[b].hood) || lots[a].addr.localeCompare(lots[b].addr, 'en', { numeric: true }) || lots[a].pin.localeCompare(lots[b].pin);
    return [...rows].sort((a, b) => by[sort.key](a, b) * sort.dir || tie(a, b));
  }, [rows, classes, lots, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  // Selecting on the map turns to the page that holds the lot.
  useEffect(() => {
    if (selected == null) return;
    const at = sorted.indexOf(selected);
    if (at >= 0) setPage(Math.floor(at / PAGE));
  }, [selected, sorted]);
  useEffect(() => {
    if (page >= pages) setPage(0);
  }, [pages, page]);

  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }));

  const pager = (where: string) =>
    pages > 1 ? (
      <nav className="city-pager" aria-label={`Pages of lots (${where})`}>
        <button className="btn btn-small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          Previous
        </button>
        <span className="small">
          {n(page * PAGE + 1)}–{n(Math.min(sorted.length, page * PAGE + PAGE))} of {n(sorted.length)}
        </span>
        <button className="btn btn-small" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
          Next
        </button>
      </nav>
    ) : null;

  return (
    <div className="city-table-wrap">
      {pager('top')}
      <table className="lots-table city-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.label} className={c.cls} aria-sort={c.key && sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} scope="col">
                {c.key ? (
                  <button className="th-sort" onClick={() => toggle(c.key!)}>
                    {c.label}
                    <span aria-hidden="true" className="th-arrow">
                      {sort.key === c.key ? (sort.dir === 1 ? ' ↓' : ' ↑') : ''}
                    </span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => {
            const l = lots[i];
            const c = classes[i];
            const st = STYLE[c.blocker];
            const on = i === selected;
            return (
              <tr key={l.pin} className={on ? 'is-selected' : ''} ref={on ? selRow : undefined}>
                <td>
                  <button className="link" onClick={() => onSelect(i)} aria-pressed={on}>
                    {l.addr}
                  </button>
                </td>
                <td>{l.hood}</td>
                <td className="nowrap">{zoneName(l.zone)}</td>
                <td>
                  <span className={`bk bk-${st.id}`} aria-hidden="true" /> {st.words}
                </td>
                <td className="num">
                  {c.width != null && !st.grey ? (
                    <Ev trust={c.trust} num>
                      {c.width} ft
                    </Ev>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{l.status}</td>
              </tr>
            );
          })}
          {!shown.length && (
            <tr>
              <td colSpan={COLS.length} className="muted">
                No lots here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {pager('bottom')}
    </div>
  );
}
