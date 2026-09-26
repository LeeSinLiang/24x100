// The block view: the block's plate with no lot selected, every lot's envelope for the chosen building
// type (each lot alone), and the table of lots. Clicking a lot, on the plate or in the table, opens the
// lot view. Every number is the engine's.
import { useMemo } from 'react';
import { evaluate, placeName, proposalFor } from '@engine/index';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, LotResult, Parcel } from '@engine/types';
import { Plate } from '../components/Plate';
import { DISCLAIMER, Ev, ftFmt, Label, dateFmt } from '../components/ui';
import { TypeRail } from '../components/city/TypeRail';
import { contextFor, lotKey, mainRow } from '../lib/model';
import { BLOCKS } from '../lib/data';
import type { ViewProps } from './types';
import '../styles/block.css';

function statusWords(r: LotResult, p: Parcel): string {
  if (r.state !== 'ok') return r.refusal?.code === 'missing_rule' ? `rules not loaded (${(p.zone ?? '—').replace(/-/g, '‑')})` : `can’t score: ${r.refusal?.code.replace(/_/g, ' ')}`;
  const w = r.checks.find((c) => c.id === 'width')!;
  if (w.status === 'open') return 'open question';
  return w.status === 'pass' ? 'fits' : `short ${ftFmt(w.shortfall ?? 0)} ft`;
}

function byLot(a: Parcel, b: Parcel): number {
  return (a.lot ?? 0) - (b.lot ?? 0) || (a.lot_suffix ?? '').localeCompare(b.lot_suffix ?? '');
}

function useBlockModel(block: BlockFile | undefined, type: ViewProps['s']['type'], audit: ViewProps['audit'], tol: number | null) {
  return useMemo(() => {
    if (!block) return null;
    const row = mainRow(block);
    const zoneCount = new Map<string, number>();
    for (const p of row) zoneCount.set(p.zone ?? '—', (zoneCount.get(p.zone ?? '—') ?? 0) + 1);
    const zone = [...zoneCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ctxs = new Map<string, ReturnType<typeof contextFor>>();
    const ctx = (z: string | null) => {
      const k = z ?? '—';
      if (!ctxs.has(k)) ctxs.set(k, contextFor(block, z, audit, tol));
      return ctxs.get(k)!;
    };
    const proposal = proposalFor(type);
    const results = new Map<string, LotResult>();
    for (const p of block.parcels) results.set(p.pin, evaluate(ctx(p.zone), { type, pins: [p.pin], proposal }));
    const plateRow = row.filter((p) => p.zone === zone).map((p) => ({ parcel: p, result: results.get(p.pin)! }));
    const rest = block.parcels.filter((p) => !row.includes(p)).sort(byLot);
    return { row, zone, results, plateRow, rest };
  }, [block, type, audit, tol]);
}

export function BlockView({ s, update, block, audit }: ViewProps) {
  const m = useBlockModel(block, s.type, audit, s.tol);
  if (!block || !m) {
    return (
      <main className="empty" id="main">
        <p>
          Block {s.block} isn’t loaded. Lot detail covers {Object.values(BLOCKS).map((b) => b.meta.name).join(' and ')}. <a href="?view=city">See every City-owned lot on the city map</a>.
        </p>
      </main>
    );
  }
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const open = (p: Parcel) => {
    update({ view: 'lot', lot: lotKey(p), lots: [], drawer: null }, { push: true });
    window.scrollTo(0, 0);
  };
  const hrefFor = (p: Parcel) => `?view=lot&block=${block.meta.id}&lot=${lotKey(p)}&type=${s.type}`;
  const street = block.meta.main_street;
  const scored = m.plateRow.filter((x) => x.result.state === 'ok');
  const fits = scored.filter((x) => x.result.checks.find((c) => c.id === 'width')?.status === 'pass');
  const short = scored.filter((x) => x.result.checks.find((c) => c.id === 'width')?.status === 'fail');
  const refused = m.plateRow.filter((x) => x.result.state !== 'ok');
  const widths = [...new Set(short.map((x) => x.result.width?.deed ?? x.result.width?.mapped ?? 0))];
  const zoneWord = (m.zone ?? '—').replace(/-/g, '‑');
  const anySelected = m.plateRow[0]?.result ?? m.results.get(block.parcels[0].pin)!;

  const rowFor = (p: Parcel) => {
    const r = m.results.get(p.pin)!;
    const w = r.width;
    const wcheck = r.checks.find((c) => c.id === 'width');
    return (
      <tr key={p.pin}>
        <td>
          <a
            href={hrefFor(p)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              open(p);
            }}
          >
            {placeName(p)}
          </a>
        </td>
        <td>{lotKey(p)}</td>
        <td>
          <em className="plan-lot-cell">{p.deed?.plan_lot ?? '—'}</em>
        </td>
        <td className="num">
          {r.state === 'ok' && w ? (
            <Ev trust={wcheck?.trust === 'red' ? 'red' : wcheck?.trust === 'pencil' ? 'pencil' : 'ink'} num>
              {ftFmt(w.deed ?? w.mapped)} ft
            </Ev>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className={r.state !== 'ok' ? 'muted' : wcheck?.status === 'fail' ? 'red-text' : undefined}>{statusWords(r, p)}</td>
        <td>{p.city ? `City · ${p.city.status}` : `other (${(p.assess?.ownercat ?? '—').toLowerCase()})`}</td>
      </tr>
    );
  };

  const table = (title: string, ps: Parcel[], id: string) => (
    <section className="block-table" aria-labelledby={id}>
      <h3 id={id} className="label">
        {title} · {ps.length}
      </h3>
      <table className="lots-table">
        <thead>
          <tr>
            <th scope="col">Address</th>
            <th scope="col">Lot</th>
            <th scope="col">Plan lot</th>
            <th scope="col" className="num">
              Width available
            </th>
            <th scope="col">Status</th>
            <th scope="col">Owner</th>
          </tr>
        </thead>
        <tbody>{ps.map(rowFor)}</tbody>
      </table>
    </section>
  );

  return (
    <main className="block-view" id="main">
      <header className="block-head">
        <div>
          <h1 className="block-title">{block.meta.name.replace(/-/g, '‑')}</h1>
          <p className="small muted">
            {block.meta.neighborhood}
            {block.meta.ward != null ? ` · Ward ${block.meta.ward}` : ''}
            {block.meta.bounding_streets?.length ? ` · bounded by ${block.meta.bounding_streets.slice(0, -1).join(', ')} and ${block.meta.bounding_streets.slice(-1)[0]}` : ''} · {block.parcels.length} County parcels · pulled {dateFmt(block.meta.pulled)}
          </p>
        </div>
        <a className="btn" href={`?view=about&block=${block.meta.id}`}>
          About this block
        </a>
      </header>

      <p className="sentence block-sentence">
        {scored.length ? (
          <>
            On {street}, a {tname} fits as of right on <Ev num>{fits.length}</Ev> of {m.plateRow.length} lots in {zoneWord}
            {short.length ? (
              <>
                ; <Ev num>{short.length}</Ev> {short.length === 1 ? 'is' : 'are'} short of width
                {widths.length === 1 ? (
                  <>
                    {' '}
                    (<Ev num>{ftFmt(widths[0])} ft</Ev> as of right)
                  </>
                ) : null}
              </>
            ) : null}
            {refused.length ? `; ${refused.length} can’t be scored` : ''}.
          </>
        ) : (
          <span className="pencil-text">
            No lot on {street} can be scored yet: {refused[0]?.result.refusal?.code === 'missing_rule' ? `the ${zoneWord} rules aren’t signed` : 'records disagree or rules are missing'}.
          </span>
        )}
      </p>

      <TypeRail type={s.type} onType={(t) => update({ type: t })} />

      <div className="block-plate-scroll">
      <Plate
        block={block}
        frameLots={m.plateRow.map((x) => x.parcel)}
        row={m.plateRow}
        selected={anySelected}
        onSelect={open}
        present={s.present}
        record={s.record}
        still={s.still}
        slope={s.slope}
        hideSelection
        label={`Plate of ${block.meta.name}, ${block.meta.neighborhood}: every lot on ${street} with its buildable envelope for a ${tname}, each lot alone. Choose a lot to open it.`}
      />
      </div>
      <p className="plate-legend">
        <span className="lg lg-short" /> narrower than a {tname} <span className="lg lg-fits" /> fits <span className="lg lg-open" /> pencil: open question <span className="lg lg-coin" /> City-owned, for sale <span className="lg lg-held" /> City-owned, held
      </p>

      <div className="block-body">
        <div className="block-tables">
          <Label as="h2">Lots · {tname}, each lot alone</Label>
          {table(`On ${street}`, [...m.row].sort(byLot), 'bt-main')}
          {m.rest.length > 0 && table('Rest of the block', m.rest, 'bt-rest')}
        </div>
        <aside className="block-aside" aria-label="About the lot count">
          <Label as="h2">Why the lot count differs</Label>
          {block.meta.counts_note ? <p className="block-note">{block.meta.counts_note}</p> : <p className="muted">No count note for this block.</p>}
          <p className="small">
            <a href={`?view=about&block=${block.meta.id}`}>About this block</a>: its zoning history, sources and what 24×100 doesn’t know.
          </p>
        </aside>
      </div>

      <footer className="lot-foot">
        <p>{DISCLAIMER}</p>
      </footer>
    </main>
  );
}
