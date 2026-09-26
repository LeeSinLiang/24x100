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
  | { state: 'ready'; meta: CityMeta; lots: CityLotRow[]; hoods: Hood[] };

type Loader<T> = () => Promise<T>;
const lotFiles = import.meta.glob('../../../../data/city/lots.json', { import: 'default' }) as Record<string, Loader<{ meta: CityMeta; lots: CityLotRow[] }>>;
const hoodFiles = import.meta.glob('../../../../data/city/neighborhoods.json', { import: 'default' }) as Record<string, Loader<Hood[]>>;

let cache: Promise<CityData> | null = null;

function load(): Promise<CityData> {
  const lotsLoader = Object.values(lotFiles)[0];
  if (!lotsLoader) return Promise.resolve({ state: 'absent' });
  const hoodsLoader = Object.values(hoodFiles)[0];
  return Promise.all([lotsLoader(), hoodsLoader ? hoodsLoader().catch(() => [] as Hood[]) : Promise.resolve([] as Hood[])])
    .then(([f, hoods]): CityData => ({
      state: 'ready',
      meta: f.meta ?? {},
      lots: (f.lots ?? []).filter((l) => Array.isArray(l.ll) && Number.isFinite(l.ll[0]) && Number.isFinite(l.ll[1]) && (l.ll[0] !== 0 || l.ll[1] !== 0)),
      hoods: Array.isArray(hoods) ? hoods.filter((h) => h && h.name && Array.isArray(h.rings)) : [],
    }))
    .catch((e: unknown): CityData => ({ state: 'error', message: String((e as Error)?.message ?? e) }));
}

export function useCityData(): CityData {
  const [d, setD] = useState<CityData>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    cache = cache ?? load();
    cache.then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}
