// All state lives in the URL, so every screenshot and demo beat is a reproducible link.
import { useCallback, useEffect, useState } from 'react';
import type { TemplateId } from '@engine/types';

export type View = 'city' | 'block' | 'lot' | 'review' | 'inquiry' | 'changes' | 'about';

export interface UrlState {
  view: View;
  block: string;
  lot: string; // County lot number within the block, with suffix: "25", "28A"
  lots: string[]; // group for combined / rowhouse scenarios
  type: TemplateId;
  w?: number;
  d?: number;
  st?: number;
  h?: number;
  assume: string[]; // "q.single_unit_includes_attached:yes"
  drawer: string | null;
  district: string | null;
  present: boolean;
  record: boolean;
  still: boolean;
  theme: 'light' | 'dark' | null;
  slope: boolean;
  section: string | null;
  tol: number | null; // reconciliation tolerance override (red)
  hood: string | null; // city view: zoomed neighborhood
  pin: string | null; // city view: selected lot
}

const TYPES: TemplateId[] = ['detached', 'two', 'row', 'three'];
const VIEWS: View[] = ['city', 'block', 'lot', 'review', 'inquiry', 'changes', 'about'];

export function parseUrl(search: string): UrlState {
  const q = new URLSearchParams(search);
  const num = (k: string) => (q.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const view = (q.get('view') as View) ?? (q.get('lot') ? 'lot' : 'city');
  const type = (q.get('type') as TemplateId) ?? 'two';
  return {
    view: VIEWS.includes(view) ? view : 'city',
    block: q.get('block') ?? '10K',
    lot: q.get('lot') ?? '25',
    lots: (q.get('lots') ?? '').split(',').filter(Boolean),
    type: TYPES.includes(type) ? type : 'two',
    w: num('w'),
    d: num('d'),
    st: num('st'),
    h: num('h'),
    assume: (q.get('assume') ?? '').split(',').filter(Boolean),
    drawer: q.get('drawer'),
    district: q.get('district'),
    present: q.get('present') === '1' || q.get('record') === '1',
    record: q.get('record') === '1',
    still: q.get('still') === '1',
    theme: (q.get('theme') as 'light' | 'dark') ?? null,
    slope: q.get('slope') === '1',
    section: q.get('section'),
    tol: num('tol') ?? null,
    hood: q.get('hood'),
    pin: q.get('pin'),
  };
}

export function toSearch(s: Partial<UrlState> & { view: View }): string {
  const q = new URLSearchParams();
  q.set('view', s.view);
  if (s.view !== 'city' && s.view !== 'changes') {
    if (s.block) q.set('block', s.block);
  }
  if (s.view === 'lot' || s.view === 'inquiry') {
    if (s.lot) q.set('lot', s.lot);
    if (s.type) q.set('type', s.type);
    if (s.lots && s.lots.length > 1) q.set('lots', s.lots.join(','));
    for (const k of ['w', 'd', 'st', 'h'] as const) if (s[k] != null) q.set(k, String(s[k]));
  }
  if ((s.view === 'city' || s.view === 'block') && s.type) q.set('type', s.type);
  if (s.view === 'city' && s.hood) q.set('hood', s.hood);
  if (s.view === 'city' && s.pin) q.set('pin', s.pin);
  if (s.assume && s.assume.length) q.set('assume', s.assume.join(','));
  if (s.drawer) q.set('drawer', s.drawer);
  if (s.district) q.set('district', s.district);
  if (s.section) q.set('section', s.section);
  if (s.slope) q.set('slope', '1');
  if (s.tol != null) q.set('tol', String(s.tol));
  if (s.record) q.set('record', '1');
  else if (s.present) q.set('present', '1');
  if (s.still) q.set('still', '1');
  if (s.theme) q.set('theme', s.theme);
  return `?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`;
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>, opts?: { push?: boolean }) => void] {
  const [state, setState] = useState(() => parseUrl(window.location.search));
  useEffect(() => {
    const on = () => setState(parseUrl(window.location.search));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const update = useCallback((patch: Partial<UrlState>, opts?: { push?: boolean }) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const search = toSearch(next);
      if (search !== window.location.search) {
        if (opts?.push) window.history.pushState(null, '', search);
        else window.history.replaceState(null, '', search);
      }
      return next;
    });
  }, []);
  return [state, update];
}
