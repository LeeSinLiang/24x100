// The citywide inputs, loaded lazily (each file is its own chunk) so the lot view never pays for
// ~11,000 lots. Both files may be missing while the pipeline is still running; the map then says so
// in plain words instead of drawing a guess.
import { useEffect, useState } from 'react';
import type { CityLot } from '@engine/city';

export interface CityMeta {
  built?: string;
  pulled?: string;
  source?: string;
  sources?: { id?: string; name: string; url?: string; pulled?: string }[];
  count?: number;
  edges_not_computed?: number;
  note?: string;
}

export type CityLotRow = CityLot & { block?: string | null };

export interface Hood {
  name: string;
  rings: [number, number][][];
}

export type CityData =
  | { state: 'loading' }
  | { state: 'absent' }
  | { state: 'error'; message: string }
  | { state: 'ready'; meta: CityMeta; lots: CityLotRow[]; hoods: Hood[]; water: Hood[] };

type Loader<T> = () => Promise<T>;
const lotFiles = import.meta.glob('../../../../data/city/lots.json', { import: 'default' }) as Record<string, Loader<{ meta: CityMeta; lots: CityLotRow[] }>>;
const hoodFiles = import.meta.glob('../../../../data/city/neighborhoods.json', { import: 'default' }) as Record<string, Loader<Hood[]>>;
const waterFiles = import.meta.glob('../../../../data/city/water.json', { import: 'default' }) as Record<string, Loader<Hood[]>>;

let cache: Promise<CityData> | null = null;

function load(): Promise<CityData> {
  const lotsLoader = Object.values(lotFiles)[0];
  if (!lotsLoader) return Promise.resolve({ state: 'absent' });
  const optional = (l: Loader<Hood[]> | undefined) => (l ? l().catch(() => [] as Hood[]) : Promise.resolve([] as Hood[]));
  const shapes = (xs: Hood[]) => (Array.isArray(xs) ? xs.filter((h) => h && h.name && Array.isArray(h.rings)) : []);
  return Promise.all([lotsLoader(), optional(Object.values(hoodFiles)[0]), optional(Object.values(waterFiles)[0])])
    .then(([f, hoods, water]): CityData => ({
      state: 'ready',
      meta: f.meta ?? {},
      lots: (f.lots ?? []).filter((l) => Array.isArray(l.ll) && Number.isFinite(l.ll[0]) && Number.isFinite(l.ll[1]) && (l.ll[0] !== 0 || l.ll[1] !== 0)),
      hoods: shapes(hoods),
      water: shapes(water),
    }))
    .catch((e: unknown): CityData => ({ state: 'error', message: String((e as Error)?.message ?? e) }));
}

/** The citywide file, loaded the first time `on` is true (the lot view's Plan canvas never pays for it). */
export function useCityData(on = true): CityData {
  const [d, setD] = useState<CityData>({ state: 'loading' });
  useEffect(() => {
    if (!on) return;
    let alive = true;
    cache = cache ?? load();
    cache.then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, [on]);
  return d;
}

/** Start (or reuse) the citywide load outside a component, e.g. when the search box gets focus. */
export function loadCityData(): Promise<CityData> {
  cache = cache ?? load();
  return cache;
}
