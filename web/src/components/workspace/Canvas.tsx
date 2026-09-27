// The centre canvas (spec §0.15): Map (the city, its layers and the selection), Plan (the plat drawing),
// Graph (P1's slot) and Table (sortable lots or runs). Each fits its box; the page never scrolls.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { placeName } from '@engine/index';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, LotResult, Parcel } from '@engine/types';
import type { AssemblyFile, AssemblyRunRow } from '../city/Assemblies';
import { CityMap, InsetRoom, MAP_ASPECT } from '../city/CityMap';
import { LotTable } from '../city/LotTable';
import { lotsWord, n, zoneName } from '../city/blockers';
import { Plate } from '../Plate';
import { BLOCKS, WHATIF } from '../../lib/data';
import { Ev, ftFmt, Label } from '../ui';
import { byLot, type BlockModel } from '../../lib/block';
import type { CityModel } from '../../lib/city';
import { lotKey, mainRow, type LotModel } from '../../lib/model';
import type { UrlState } from '../../lib/url';
import { GraphSlot } from './GraphSlot';
import { stageFor } from './stage';
import { runAddrs, runLotsLabel } from './plain';

/** The box a canvas can fill (content size of the element), kept current. */
export function useBox<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setBox((b) => (Math.abs(b.w - w) < 1 && Math.abs(b.h - h) < 1 ? b : { w, h }));
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/** Is the screen at most `px` wide? Never on a staged page (present or record): the stage is desktop. */
function useNarrow(px: number, s: Pick<UrlState, 'present' | 'record'>): boolean {
  const q = `(max-width: ${px}px)`;
  const [v, setV] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return v && !stageFor(s, true, window.innerWidth, window.innerHeight);
}

// ── Map ──────────────────────────────────────────────────────────────────────────────────────────
export function MapCanvas({
  cm,
  s,
  selectedPins,
  runPins,
  asmPins,
  onSelect,
  onZoom,
  inset,
  onInsetOpen,
  hood,
}: {
  cm: CityModel;
  s: UrlState;
  selectedPins: string[];
  runPins: string[];
  asmPins: string[];
  onSelect: (i: number | null) => void; // index into cm.lots
  onZoom: (hood: string | null) => void;
  inset?: ReactNode; // the selection's plan (or run card), linked to its dot by a leader line (P2)
  onInsetOpen?: () => void;
  hood?: string | null; // the neighbourhood to zoom to when the URL names none (a lot's own)
}) {
  const stacked = useNarrow(1023, s);
  const [ref, box] = useBox<HTMLDivElement>();
  const hide = useMemo(() => new Set(s.hide), [s.hide.join(',')]);
  const vis = useMemo(() => cm.inFilter.filter((i) => !hide.has(cm.classes[i].blocker)), [cm.inFilter, cm.classes, hide]);
  const lotsV = useMemo(() => vis.map((i) => cm.lots[i]), [vis, cm.lots]);
  const classesV = useMemo(() => vis.map((i) => cm.classes[i]), [vis, cm.classes]);
  const at = useMemo(() => new Map(vis.map((i, j) => [cm.lots[i].pin, j])), [vis, cm.lots]);
  const idx = (pins: string[]) => pins.map((p) => at.get(p)).filter((j): j is number => j != null);
  const sel = idx(selectedPins)[0] ?? (inset ? idx(runPins)[0] : undefined) ?? null;
  const marks = useMemo(() => idx(asmPins), [asmPins.join(','), at]);
  const whatIfPins = (s.whatif && WHATIF.scenarios?.find((x) => x.id === s.whatif)?.by_type[s.type]?.pins) || [];
  const whatIf = useMemo(() => idx(whatIfPins), [whatIfPins.join(','), at]);
  const strong = useMemo(() => idx([...runPins, ...(selectedPins.length > 1 ? selectedPins : [])]), [runPins.join(','), selectedPins.join(','), at]);
  const w = stacked ? box.w : Math.max(0, Math.min(box.w, box.h / MAP_ASPECT));
  const tname = TEMPLATES[s.type].name.toLowerCase();
  if (cm.data.state !== 'ready')
    return (
      <div className="ws-canvas-body" ref={ref}>
        <MapPlaceholder state={cm.data.state} message={cm.data.state === 'error' ? cm.data.message : ''} />
      </div>
    );
  return (
    <div className="ws-canvas-body is-map" ref={ref}>
      <div className="ws-map-box" style={{ width: w || undefined }}>
        {w > 0 && (
          <CityMap
            lots={lotsV}
            water={cm.data.water}
            classes={classesV}
            hoods={cm.hoods}
            focus={s.hood ?? hood ?? null}
            focusIsFilter={!!s.hood}
            stacked={stacked}
            selected={sel}
            onSelect={(j) => onSelect(j == null ? null : vis[j])}
            onZoom={onZoom}
            present={s.present}
            record={s.record}
            animate={s.anim}
            inset={inset && sel != null ? inset : null}
            insetWide={!!inset}
            onInsetOpen={onInsetOpen}
            marks={marks}
            whatIf={whatIf}
            markStrong={strong}
            label={`Map of ${s.hood ?? 'Pittsburgh'}: ${n(lotsV.length)} City-owned vacant ${lotsWord(lotsV.length)} as dots, colored by what first blocks a ${tname}. The Table view lists the same lots.`}
          />
        )}
      </div>
    </div>
  );
}

function MapPlaceholder({ state, message }: { state: 'loading' | 'absent' | 'error'; message: string }) {
  return (
    <div className="city-plate city-empty ws-empty" role="status">
      {state === 'loading' ? (
        <p className="label">Loading the city map</p>
      ) : state === 'absent' ? (
        <div>
          <p className="city-empty-title">The citywide lot file hasn’t been built yet.</p>
          <p className="small">
            Run <code>npm run build:data</code> to write <code>data/city/lots.json</code>. Until then, lot detail covers{' '}
            {Object.values(BLOCKS)
              .map((b) => b.meta.name)
              .join(' and ')}
            .
          </p>
        </div>
      ) : (
        <div>
          <p className="city-empty-title">The city map could not load.</p>
          <p className="small">{message}</p>
        </div>
      )}
    </div>
  );
}

/** The lots a cropped plan shows: the selection and one lot either side, on its frontage. */
function planFocus(block: BlockFile, r: LotResult): string[] {
  const sel = block.parcels.find((p) => p.pin === r.pins[0])!;
  const order = mainRow(block).filter((p) => p.zone === sel.zone).map((p) => p.pin);
  const ix = r.pins.map((pin) => order.indexOf(pin)).filter((i) => i >= 0);
  if (!ix.length) return r.pins;
  return order.slice(Math.max(0, Math.min(...ix) - 1), Math.min(order.length - 1, Math.max(...ix) + 1) + 1);
}

/** The map's inset plan (spec §0.15 P2): the selected lot or group, cropped, with its width. */
export function MapInsetPlan({ block, model, s }: { block: BlockFile; model: LotModel; s: UrlState }) {
  const room = useContext(InsetRoom);
  const r = model.result;
  const sel = block.parcels.find((p) => p.pin === r.pins[0])!;
  const frameLots = mainRow(block).filter((p) => p.zone === sel.zone);
  const focus = useMemo(() => planFocus(block, r), [block, r.pins.join(',')]);
  const w = r.width ? r.width.deed ?? r.width.mapped : null;
  return (
    <div className="map-inset-plan">
      <p className="map-inset-head">
        <strong>{block.meta.name}</strong>
        <span className="muted">{r.state === 'ok' && w != null ? `${ftFmt(w)} ft of width · double-click for the plan` : 'double-click for the plan'}</span>
      </p>
      <Plate
        block={block}
        frameLots={frameLots}
        row={model.row.filter((x) => x.parcel.zone === sel.zone)}
        selected={r}
        onSelect={() => {}}
        interactive={false}
        present={s.present}
        record={s.record}
        still
        slope={false}
        focus={focus}
        maxHeight={room?.maxH}
        label={`Inset plan of ${block.meta.name}: the selected lots and one lot either side.`}
      />
    </div>
  );
}

/** The map's inset for a run without lot detail: its lots, owners and width. */
export function MapInsetRun({ run }: { run: AssemblyRunRow }) {
  return (
    <div className="map-inset-plan">
      <p className="map-inset-head">
        <strong>{run.lots.length} lots combined</strong>
        <span className="muted">{run.block ? 'double-click for the plan' : 'no block drawing yet'}</span>
      </p>
      <p className="small">
        {runLotsLabel(run.lots)} <span className="muted">· {runAddrs(run.lots)}</span>
      </p>
      <p className="small">
        <Ev trust={run.trust} num>
          {run.width} ft
        </Ev>{' '}
        ({run.formula}) · {run.non_city === 0 ? 'all City-owned' : `${run.non_city} not City-owned`}
      </p>
    </div>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────
export function PlanCanvas({ block, model, s, onSelectLot }: { block: BlockFile; model: LotModel; s: UrlState; onSelectLot: (p: Parcel) => void }) {
  const stacked = useNarrow(1023, s);
  const phone = useNarrow(767, s);
  const [ref, box] = useBox<HTMLDivElement>();
  const r = model.result;
  const sel = block.parcels.find((p) => p.pin === r.pins[0])!;
  const rowLots = useMemo(() => mainRow(block), [block]);
  const frameLots = rowLots.filter((p) => p.zone === sel.zone);
  const focus = useMemo(() => {
    const order = frameLots.map((p) => p.pin);
    const ix = r.pins.map((pin) => order.indexOf(pin)).filter((i) => i >= 0);
    if (!ix.length) return r.pins;
    const lo = Math.max(0, Math.min(...ix) - 1);
    const hi = Math.min(order.length - 1, Math.max(...ix) + 1);
    return order.slice(lo, hi + 1);
  }, [r.pins.join(','), frameLots.map((p) => p.pin).join(',')]);
  return (
    <div className="ws-canvas-body is-plan" ref={ref}>
      <div className="ws-plan-box">
        <Plate
          block={block}
          frameLots={frameLots}
          row={model.row.filter((x) => x.parcel.zone === sel.zone)}
          selected={r}
          onSelect={onSelectLot}
          present={s.present}
          record={s.record}
          still={s.still}
          slope={s.slope}
          focus={phone ? focus : undefined}
          maxHeight={stacked || !(box.h > 0) ? undefined : box.h}
          label={`Plate of ${block.meta.name}, ${block.meta.neighborhood}: every lot on ${block.meta.main_street} with its buildable envelope for a ${TEMPLATES[s.type].name.toLowerCase()}.`}
        />
      </div>
    </div>
  );
}

export function BlockPlanCanvas({ block, bm, s, onOpen }: { block: BlockFile; bm: BlockModel; s: UrlState; onOpen: (p: Parcel) => void }) {
  const stacked = useNarrow(1023, s);
  const [ref, box] = useBox<HTMLDivElement>();
  const anySelected: LotResult = bm.plateRow[0]?.result ?? bm.results.get(block.parcels[0].pin)!;
  const tname = TEMPLATES[s.type].name.toLowerCase();
  return (
    <div className="ws-canvas-body is-plan" ref={ref}>
      <div className="ws-plan-box">
        <Plate
          block={block}
          frameLots={bm.plateRow.map((x) => x.parcel)}
          row={bm.plateRow}
          selected={anySelected}
          onSelect={onOpen}
          present={s.present}
          record={s.record}
          still={s.still}
          slope={s.slope}
          hideSelection
          maxHeight={stacked || !(box.h > 0) ? undefined : box.h}
          label={`Plate of ${block.meta.name}, ${block.meta.neighborhood}: every lot on ${block.meta.main_street} with its buildable envelope for a ${tname}, each lot alone. Choose a lot to open it.`}
        />
      </div>
    </div>
  );
}

/** The Plan canvas when the selection has no block drawing (a city lot, a run, the city). */
export function NoPlan({ children }: { children?: ReactNode }) {
  return (
    <div className="ws-canvas-body">
      <div className="ws-empty-note" role="status">
        <p className="label">Plan</p>
        <p>
          The block drawing needs lot detail, which covers{' '}
          {Object.values(BLOCKS)
            .map((b) => b.meta.name.replace(/-/g, '‑'))
            .join(' and ')}
          .
        </p>
        <ul className="ws-list small">
          {Object.values(BLOCKS).map((b) => (
            <li key={b.meta.id}>
              <a href={`?view=block&block=${b.meta.id}`}>
                Open {b.meta.name.replace(/-/g, '‑')} ({b.meta.neighborhood})
              </a>
            </li>
          ))}
        </ul>
        {children}
      </div>
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────────────────────────
function statusWords(r: LotResult): string {
  const w = r.checks.find((c) => c.id === 'width')!;
  if (w.status === 'open') return 'open question';
  return w.status === 'pass' ? 'fits' : `short ${ftFmt(w.shortfall ?? 0)} ft`;
}

/** The lot view's list of lots on the main street, each lot alone (moved from the lot page). */
export function LotListTable({ block, model, s, onSelectLot }: { block: BlockFile; model: LotModel; s: UrlState; onSelectLot: (p: Parcel) => void }) {
  const r = model.result;
  return (
    <div className="ws-canvas-body is-table">
      <section className="lot-list" aria-labelledby="lot-list-h">
        <h2 id="lot-list-h" className="label">
          Lots on {block.meta.main_street} · {TEMPLATES[s.type].name.toLowerCase()}, each lot alone
        </h2>
        <p className="small muted">{block.meta.counts_note}</p>
        <table className="lots-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Lot</th>
              <th>Plan lot</th>
              <th>Width available</th>
              <th>Status</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {model.row.map(({ parcel, result }) => (
              <tr key={parcel.pin} className={r.pins.includes(parcel.pin) ? 'is-selected' : ''}>
                <td>
                  <button className="link" onClick={() => onSelectLot(parcel)} aria-pressed={r.pins.includes(parcel.pin)}>
                    {placeName(parcel)}
                  </button>
                </td>
                <td>{lotKey(parcel)}</td>
                <td>
                  <em>{parcel.deed?.plan_lot ?? '—'}</em>
                </td>
                <td className="num">{result.state === 'ok' ? `${ftFmt(result.width!.deed ?? result.width!.mapped)} ft` : '—'}</td>
                <td>{result.state === 'ok' ? statusWords(result) : result.refusal?.code === 'missing_rule' ? `rules not loaded (${parcel.zone})` : `can't score: ${result.refusal?.code.replace('_', ' ')}`}</td>
                <td>{parcel.city ? `City · ${parcel.city.status}` : `other (${(parcel.assess?.ownercat ?? '—').toLowerCase()})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** The block's lots, each alone: the main street, then the rest of the block (moved from the block page). */
export function BlockTables({ block, bm, s, onOpen }: { block: BlockFile; bm: BlockModel; s: UrlState; onOpen: (p: Parcel) => void }) {
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const rowFor = (p: Parcel) => {
    const r = bm.results.get(p.pin)!;
    const w = r.width;
    const wcheck = r.checks.find((c) => c.id === 'width');
    return (
      <tr key={p.pin}>
        <td>
          <a
            href={`?view=lot&block=${block.meta.id}&lot=${lotKey(p)}&type=${s.type}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onOpen(p);
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
        <td className={r.state !== 'ok' ? 'muted' : wcheck?.status === 'fail' ? 'red-text' : undefined}>
          {r.state !== 'ok' ? (r.refusal?.code === 'missing_rule' ? `rules not loaded (${zoneName(p.zone)})` : `can’t score: ${r.refusal?.code.replace(/_/g, ' ')}`) : statusWords(r)}
        </td>
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
    <div className="ws-canvas-body is-table">
      <Label as="h2">Lots · {tname}, each lot alone</Label>
      {table(`On ${block.meta.main_street}`, [...bm.row].sort(byLot), 'bt-main')}
      {bm.rest.length > 0 && table('Rest of the block', bm.rest, 'bt-rest')}
    </div>
  );
}

export function CityTable({ cm, s, selected, onSelect }: { cm: CityModel; s: UrlState; selected: number | null; onSelect: (i: number) => void }) {
  const hide = useMemo(() => new Set(s.hide), [s.hide.join(',')]);
  const rows = useMemo(() => cm.inFilter.filter((i) => !hide.has(cm.classes[i].blocker)), [cm.inFilter, cm.classes, hide]);
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const stacked = useNarrow(767, s);
  if (cm.data.state !== 'ready') return <div className="ws-canvas-body" />;
  return (
    <div className="ws-canvas-body is-table">
      <h2 className="label">
        {s.hood ? `Lots in ${s.hood}` : 'Every lot on the map'} · {n(rows.length)} · {tname}
      </h2>
      <LotTable lots={cm.lots} classes={cm.classes} rows={rows} selected={selected} onSelect={onSelect} caption={`City-owned vacant lots${s.hood ? ` in ${s.hood}` : ''}, first blocker for a ${tname}`} pageSize={stacked ? 20 : 50} />
    </div>
  );
}

/** C15 runs as a sortable table (the "Combine to fit" list, in rows). */
export function RunsTable({ asm, cm, s, onSelect }: { asm: AssemblyFile | null | 'loading'; cm: CityModel; s: UrlState; onSelect: (r: AssemblyRunRow) => void }) {
  const [sort, setSort] = useState<'owners' | 'width'>('owners');
  const hoodByPin = useMemo(() => new Map(cm.lots.map((l) => [l.pin, l.hood ?? null])), [cm.lots]);
  const runs = useMemo(() => {
    if (!asm || asm === 'loading') return [];
    const rs = asm.runs.filter((r) => r.type === s.type && (!s.hood || r.lots.some((l) => hoodByPin.get(l.pin) === s.hood)));
    return [...rs].sort((a, b) => (sort === 'owners' ? a.non_city - b.non_city || b.width - a.width : b.width - a.width || a.non_city - b.non_city));
  }, [asm, s.type, s.hood, hoodByPin, sort]);
  if (asm === 'loading') return <div className="ws-canvas-body small muted">Loading the lots that fit when combined…</div>;
  if (!asm) return <div className="ws-canvas-body small muted">The assembly file hasn’t been built (scripts/build-assemblies.ts).</div>;
  const th = (k: 'owners' | 'width', label: string) => (
    <th scope="col" aria-sort={sort === k ? (k === 'owners' ? 'ascending' : 'descending') : undefined} className={k === 'width' ? 'num' : undefined}>
      <button className="th-sort" onClick={() => setSort(k)}>
        {label}
        <span aria-hidden="true" className="th-arrow">
          {sort === k ? (k === 'owners' ? ' ↑' : ' ↓') : ''}
        </span>
      </button>
    </th>
  );
  return (
    <div className="ws-canvas-body is-table">
      <h2 className="label">
        Combine to fit · {TEMPLATES[s.type].name.toLowerCase()} · <span data-count="lot-groups">{n(runs.length)} lot groups</span>
        {s.hood ? ` · ${s.hood}` : ' · citywide'}
      </h2>
      <table className="lots-table ws-runs">
        <thead>
          <tr>
            <th scope="col">Lots side by side (County numbers)</th>
            {th('width', 'Width')}
            {th('owners', 'Not City-owned')}
            <th scope="col">Open</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const key = r.pins.join(',');
            const href = r.block && r.lots_param ? `?view=lot&block=${r.block}&lot=${r.lot_key}&type=${r.type}&lots=${r.lots_param}` : null;
            return (
              <tr key={key} className={s.run === key ? 'is-selected' : ''} data-run={key}>
                <td>
                  <button className="link" onClick={() => onSelect(r)} aria-pressed={s.run === key}>
                    {runLotsLabel(r.lots)}
                  </button>
                  <span className="ws-run-addr small muted">{runAddrs(r.lots)}</span>
                </td>
                <td className="num">
                  <Ev trust={r.trust} num>
                    {r.width} ft
                  </Ev>
                </td>
                <td>{r.non_city === 0 ? 'none: all City-owned' : `${r.non_city}: ${r.lots.filter((l) => !l.city).map((l) => l.owner_type_words).join('; ')}`}</td>
                <td>{href ? <a href={href}>Combined lot</a> : <a href={`?view=city&type=${r.type}&pin=${r.candidates[0]}`}>City lot</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { GraphSlot };
