// A City lot's outline (its parcel polygon, its immediate neighbours and the nearby streets, in local feet),
// fetched on demand from the static API (api/lots/<pin>.json, written by scripts/build-api.ts). One small file
// per lot, so the city map never pays for 11,000 outlines; each is fetched once per page.
import { useEffect, useState } from 'react';
import type { LotOutline } from '@engine/outline';

export type OutlineState = { state: 'loading' } | { state: 'absent'; why: string } | { state: 'ready'; outline: LotOutline };

const cache = new Map<string, Promise<OutlineState>>();

function load(pin: string): Promise<OutlineState> {
  const hit = cache.get(pin);
  if (hit) return hit;
  const p = fetch(`${import.meta.env.BASE_URL}api/lots/${encodeURIComponent(pin)}.json`)
    .then(async (r): Promise<OutlineState> => {
      if (!r.ok) return { state: 'absent', why: 'this build has no lot file for it (run npm run build:data)' };
      const j = (await r.json()) as { outline?: LotOutline };
      return j.outline && Array.isArray(j.outline.ring) && j.outline.ring.length >= 3 ? { state: 'ready', outline: j.outline } : { state: 'absent', why: 'its lot file carries no outline (the citywide work file was missing at build time)' };
    })
    .catch((): OutlineState => ({ state: 'absent', why: 'the lot file could not be loaded' }));
  cache.set(pin, p);
  return p;
}

export function useLotOutline(pin: string | null): OutlineState {
  const [s, setS] = useState<OutlineState>({ state: 'loading' });
  useEffect(() => {
    if (!pin) return;
    let alive = true;
    setS({ state: 'loading' });
    load(pin).then((x) => alive && setS(x));
    return () => {
      alive = false;
    };
  }, [pin]);
  return s;
}
