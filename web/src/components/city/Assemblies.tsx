// "Combine to fit" (C15, spec §0.14): runs of 2–3 lots on one block face that fit as of right when
// combined, where the City lot alone doesn't. Data: data/city/assemblies.json (scripts/build-assemblies.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ev } from '../ui';

export interface AssemblyLot {
  pin: string;
  addr: string | null;
  lot: string | null;
  owner_type: string;
  owner_type_words: string;
  city: boolean;
}
export interface AssemblyRunRow {
  pins: string[];
  lots: AssemblyLot[];
  type: string;
  width: number;
  formula: string;
  trust: 'ink' | 'pencil';
  trust_note: string | null;
  non_city: number;
  candidate_alone: string;
  still_to_check: string[];
  candidates: string[];
  block: string | null;
  lot_key: string | null;
  lots_param: string | null;
}
export interface AssemblyFile {
  meta: { district: string; candidates: number; skipped: Record<string, number>; partners_ruled_out: Record<string, number>; built_neighbours: string; corners: string; note?: string; pulled?: string; sources?: { id?: string; name: string; pulled?: string; url?: string }[] };
  runs: AssemblyRunRow[];
}

type Loader = () => Promise<AssemblyFile>;
const files = import.meta.glob('../../../../data/city/assemblies.json', { import: 'default' }) as Record<string, Loader>;
let cache: Promise<AssemblyFile | null> | null = null;

export function useAssemblies(on: boolean): AssemblyFile | null | 'loading' {
  const [d, setD] = useState<AssemblyFile | null | 'loading'>('loading');
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const l = Object.values(files)[0];
    cache = cache ?? (l ? l().catch(() => null) : Promise.resolve(null));
    cache.then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, [on]);
  return d;
}

const n = (x: number) => x.toLocaleString('en-US');
const runKey = (r: AssemblyRunRow) => r.pins.join(',');

export function AssemblyPanel(props: {
  data: AssemblyFile | null | 'loading';
  type: string;
  typeName: string;
  focus: string | null;
  hoodOf: Map<string, string | null>; // pin → neighbourhood, for City lots
  selected: string | null;
  onSelect: (r: AssemblyRunRow) => void;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<'owners' | 'width'>('owners');
  const { data } = props;
  const list = useRef<HTMLOListElement>(null);
  const runs = useMemo(() => {
    if (!data || data === 'loading') return [];
    const rs = data.runs.filter((r) => r.type === props.type && (!props.focus || r.lots.some((l) => props.hoodOf.get(l.pin) === props.focus)));
    return [...rs].sort((a, b) => (sort === 'owners' ? a.non_city - b.non_city || b.width - a.width : b.width - a.width || a.non_city - b.non_city));
  }, [data, props.type, props.focus, props.hoodOf, sort]);
  // Keep the selected run in view inside the list (the list scrolls; the page doesn't).
  useEffect(() => {
    const el = list.current;
    const row = el?.querySelector<HTMLElement>('.asm-row.is-sel');
    if (el && row) el.scrollTop = Math.max(0, row.offsetTop - el.offsetTop - 8);
  }, [props.selected, runs.length]);
  if (data === 'loading') return <p className="small muted" role="status">Loading the lots that fit when combined…</p>;
  if (!data) return <p className="small muted">The assembly file hasn’t been built (scripts/build-assemblies.ts).</p>;
  const allCity = runs.filter((r) => r.non_city === 0).length;
  const skipped = Object.entries(data.meta.skipped).map(([k, v]) => `${n(v)} ${k === 'records' ? 'whose records disagree' : k === 'edges' ? 'whose edges couldn’t be computed' : k}`);
  return (
    <section className="asm" aria-labelledby="asm-h">
      <h2 id="asm-h" className="label">
        Combine to fit · {props.typeName.toLowerCase()}
        {props.focus ? ` · ${props.focus}` : ''}
      </h2>
      <p className="sentence asm-sentence">
        <Ev num>{n(runs.length)}</Ev> {runs.length === 1 ? 'run' : 'runs'} of 2–3 lots fit a {props.typeName.toLowerCase()} as of right when combined, where the City lot alone doesn’t;{' '}
        <Ev num>{n(allCity)}</Ev> {allCity === 1 ? 'is' : 'are'} all City-owned.
      </p>
      <p className="small">Combining lots needs a lot consolidation and the owners’ agreement; this is not an offer, and it hasn’t been checked with the City.</p>
      <p className="small muted">
        Rules loaded for RM‑M only; other districts not assessed. Checked {n(data.meta.candidates)} City-owned vacant lots; skipped {skipped.join(' and ')}. Built neighbours are not partners (buying or demolishing a home is a
        different decision). Use, parking and grading are still to check. Owner type only, never names.
      </p>
      <div className="asm-sort" role="group" aria-label="Sort">
        <button type="button" aria-pressed={sort === 'owners'} onClick={() => setSort('owners')}>
          Fewest lots not City-owned
        </button>
        <button type="button" aria-pressed={sort === 'width'} onClick={() => setSort('width')}>
          Widest
        </button>
      </div>
      <ol className="asm-list" ref={list}>
        {runs.map((r) => {
          const href = r.block && r.lots_param ? `?view=lot&block=${r.block}&lot=${r.lot_key}&type=${r.type}&lots=${r.lots_param}` : `?view=city&type=${r.type}&pin=${r.candidates[0]}`;
          const sel = props.selected === runKey(r);
          return (
            <li key={runKey(r)} className={`asm-row${sel ? ' is-sel' : ''}`} data-run={runKey(r)} aria-current={sel ? 'true' : undefined}>
              <button type="button" className="asm-pick" onClick={() => props.onSelect(r)}>
                <span className="asm-addr">{r.lots.map((l) => l.addr ?? l.pin).join(' · ')}</span>
              </button>
              <span className="asm-meta">
                <Ev trust={r.trust} num>
                  {r.width} ft
                </Ev>{' '}
                ({r.formula}){r.trust_note ? `: ${r.trust_note}` : ''} ·{' '}
                {r.non_city === 0 ? 'all City-owned' : `${r.non_city} not City-owned: ${r.lots.filter((l) => !l.city).map((l) => l.owner_type_words).join('; ')}`}
              </span>
              <a className="asm-link" href={href}>
                {r.block ? 'Open the combined lot' : 'Open the City lot'}
              </a>
            </li>
          );
        })}
      </ol>
      <button type="button" className="asm-close" onClick={props.onClose}>
        ← Back to what blocks each lot
      </button>
    </section>
  );
}
