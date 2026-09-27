// All state lives in the URL, so every screenshot and demo beat is a reproducible link.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TemplateId } from '@engine/types';

export type View = 'city' | 'block' | 'lot' | 'review' | 'inquiry' | 'changes' | 'about';

/** The workspace's centre canvas (spec §0.15). Defaults: city → map; lot and block → plan. */
export type Canvas = 'map' | 'plan' | 'graph' | 'table';
/** The inspector's tabs, in the order a developer checks them (spec §0.12). */
export type InspectorTab = 'money' | 'rules' | 'site' | 'next' | 'sources' | 'whatif';
/** The bottom tray's tabs; 'closed' collapses it. */
export type TrayTab = 'next' | 'timeline' | 'changes' | 'closed';
export type Office = 'assessment' | 'real_estate' | 'zoning' | 'ura' | 'rco';

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
  layer: 'assemble' | null; // city view: the "Combine to fit" layer (C15)
  run: string | null; // city view, assemble layer: the selected run (its lots' PINs, comma-separated)
  // Workspace (spec §0.15). All optional: every link written before the workspace still works.
  canvas: Canvas | null; // null: the view's default
  tab: InspectorTab | null; // null: the first tab
  tray: TrayTab | null; // null: "What to check next", open
  hide: string[]; // map layers switched off (blocker ids)
  sale: boolean; // filter: listed for sale only
  ward: number | null; // filter
  zone: string | null; // filter: zoning district
  letter: Office | null; // inquiry page: the letter tab to open
  anim: boolean; // film: keep the map's zoom animation in record mode (record mode is otherwise still)
  whatif: WhatIfId | null; // city: the rule what-if whose lots the map shows (spec §0.16)
  quote: number | null; // lot: the user's builder's quote, $ per sq ft (red: theirs, not checked)
  ai: boolean; // city: the "read by AI, awaiting a person" layer (pencil; never in the counts)
  node: string | null; // Graph canvas: the selected node (its id in engine/src/graph.ts)
  ghide: string[]; // Graph canvas: node types hidden from the rail's filters
  focus: string | null; // Graph canvas: show only the chain behind this node's decision (engine/src/graph.ts focusGraph)
  step: number | null; // the route's step shown in the Next tab (1-based); null: the first
}

const TYPES: TemplateId[] = ['detached', 'two', 'row', 'three'];
const VIEWS: View[] = ['city', 'block', 'lot', 'review', 'inquiry', 'changes', 'about'];
const CANVASES: Canvas[] = ['map', 'plan', 'graph', 'table'];
const TABS: InspectorTab[] = ['money', 'rules', 'site', 'next', 'sources', 'whatif'];
export const WHATIFS = ['S1', 'S2', 'S3'] as const;
// The policy agent's committed questions (data/policy/q1-….json → Q1), linkable like S1–S3; only each file's id is imported.
export const POLICY_IDS = Object.values(import.meta.glob('../../../data/policy/q*.json', { eager: true, import: 'id' }) as Record<string, string>);
export type WhatIfId = (typeof WHATIFS)[number] | `Q${number}`;
const TRAYS: TrayTab[] = ['next', 'timeline', 'changes', 'closed'];
const OFFICES: Office[] = ['assessment', 'real_estate', 'zoning', 'ura', 'rco'];
const oneOf = <T extends string>(v: string | null, list: readonly T[]): T | null => (v != null && (list as readonly string[]).includes(v) ? (v as T) : null);

/** The workspace views: city, lot and block render one screen (WorkspaceView). */
export const WORKSPACE_VIEWS: View[] = ['city', 'lot', 'block'];

/** A link parameter that was set but couldn't be used, and why, in plain words. The workspace shows
 *  these in a small, dismissible notice instead of silently falling back to the default. */
export interface Ignored {
  param: string;
  value: string;
  why: string;
}

/** The link's state. Pass `ignored` to collect the parameters that were set but not usable (an
 *  unknown building type, view, canvas or tab; a tolerance that isn't a number from 1 to 50%). An
 *  unknown neighbourhood is caught later, once the citywide file says which names exist (hoodIgnored). */
export function parseUrl(search: string, ignored?: Ignored[]): UrlState {
  const q = new URLSearchParams(search);
  const num = (k: string) => (q.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const view = (q.get('view') as View) ?? (q.get('lot') ? 'lot' : 'city');
  const type = (q.get('type') as TemplateId) ?? 'two';
  const state: UrlState = {
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
    theme: oneOf(q.get('theme'), ['light', 'dark'] as const),
    slope: q.get('slope') === '1',
    section: q.get('section'),
    // Reconciliation tolerance override, as a fraction (0.12) or a percent (12); anything outside 1–50% is ignored.
    tol: (() => {
      const t = num('tol');
      if (t == null || !Number.isFinite(t)) return null;
      const f = t > 1 ? t / 100 : t;
      return f >= 0.01 && f <= 0.5 ? f : null;
    })(),
    hood: q.get('hood'),
    pin: q.get('pin'),
    layer: q.get('layer') === 'assemble' ? 'assemble' : null,
    run: q.get('run'),
    canvas: oneOf(q.get('canvas'), CANVASES),
    tab: oneOf(q.get('tab'), TABS),
    tray: oneOf(q.get('tray'), TRAYS),
    hide: (q.get('hide') ?? '').split(',').filter(Boolean),
    sale: q.get('sale') === '1',
    ward: (() => {
      const w = num('ward');
      return w != null && Number.isInteger(w) && w > 0 ? w : null;
    })(),
    zone: q.get('zone'),
    letter: oneOf(q.get('letter'), OFFICES),
    anim: q.get('anim') === '1',
    whatif: oneOf(q.get('whatif'), [...WHATIFS, ...POLICY_IDS] as WhatIfId[]),
    ai: q.get('ai') === '1',
    quote: (() => {
      const v = Number(q.get('quote'));
      return q.get('quote') != null && Number.isFinite(v) && v >= 20 && v <= 2000 ? v : null;
    })(),
    node: q.get('node'),
    ghide: (q.get('ghide') ?? '').split(',').filter(Boolean),
    focus: q.get('focus'),
    step: (() => {
      const v = num('step');
      return v != null && Number.isInteger(v) && v > 0 ? v : null;
    })(),
  };
  if (ignored) {
    const bad = (param: string, why: string) => ignored.push({ param, value: q.get(param) ?? '', why });
    const unknown = (param: string, list: readonly string[], why: string) => {
      const v = q.get(param);
      if (v != null && !list.includes(v)) bad(param, why);
    };
    unknown('view', VIEWS, 'not a page we have');
    unknown('type', TYPES, 'not a building type we check');
    unknown('canvas', CANVASES, 'not a view we have: map, plan, graph or table');
    unknown('tab', TABS, `not a tab we have: ${TABS.join(', ')}`);
    unknown('tray', TRAYS, `not a tray tab we have: ${TRAYS.join(', ')}`);
    if (q.get('tol') != null && state.tol == null) bad('tol', 'not a tolerance we use: a number from 1 to 50 (percent)');
    if (q.get('step') != null && state.step == null) bad('step', 'not a step of the route: a whole number from 1');
    if (q.get('quote') != null && state.quote == null) bad('quote', 'not a builder’s quote we use: dollars per sq ft, from 20 to 2,000');
  }
  return state;
}

/** The notice entry for a `hood` the citywide file doesn't name, or null when it's known. */
export function hoodIgnored(hood: string | null, known: Iterable<string>): Ignored | null {
  if (!hood) return null;
  for (const k of known) if (k === hood) return null;
  return { param: 'hood', value: hood, why: `no neighbourhood named “${hood}”` };
}

export function toSearch(s: Partial<UrlState> & { view: View }): string {
  const q = new URLSearchParams();
  q.set('view', s.view);
  const ws = WORKSPACE_VIEWS.includes(s.view);
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
  if (s.view === 'city' && s.pin) q.set('pin', s.pin);
  if (s.view === 'city' && s.layer) q.set('layer', s.layer);
  if (s.view === 'city' && s.layer && s.run) q.set('run', s.run);
  if (ws) {
    // The map's zoom and filters ride along in every workspace view (the Map canvas is one click away).
    if (s.hood) q.set('hood', s.hood);
    if (s.canvas) q.set('canvas', s.canvas);
    if (s.tab) q.set('tab', s.tab);
    if (s.tray) q.set('tray', s.tray);
    if (s.hide && s.hide.length) q.set('hide', s.hide.join(','));
    if (s.sale) q.set('sale', '1');
    if (s.ward != null) q.set('ward', String(s.ward));
    if (s.zone) q.set('zone', s.zone);
    if (s.canvas === 'graph' && s.node) q.set('node', s.node);
    if (s.canvas === 'graph' && s.focus) q.set('focus', s.focus);
    if (s.canvas === 'graph' && s.ghide && s.ghide.length) q.set('ghide', s.ghide.join(','));
    if (s.step != null && s.step > 1) q.set('step', String(s.step));
  }
  if (s.view === 'inquiry' && s.letter) q.set('letter', s.letter);
  if (s.assume && s.assume.length) q.set('assume', s.assume.join(','));
  if (s.drawer) q.set('drawer', s.drawer);
  if (s.district) q.set('district', s.district);
  if (s.section) q.set('section', s.section);
  if (s.slope) q.set('slope', '1');
  if (s.tol != null) q.set('tol', String(s.tol));
  if (s.record) q.set('record', '1');
  else if (s.present) q.set('present', '1');
  if (s.anim) q.set('anim', '1');
  if (s.whatif) q.set('whatif', s.whatif);
  if (s.quote != null) q.set('quote', String(s.quote));
  if (s.ai) q.set('ai', '1');
  if (s.still) q.set('still', '1');
  if (s.theme) q.set('theme', s.theme);
  return `?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`;
}

/** The link's parameters that were ignored, for the notice: `add` reports one found later (an unknown
 *  neighbourhood), `dismiss` clears the notice. */
export interface IgnoredApi {
  items: Ignored[];
  add: (x: Ignored) => void;
  dismiss: () => void;
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>, opts?: { push?: boolean }) => void, IgnoredApi] {
  const [first] = useState(() => {
    const out: Ignored[] = [];
    return { s: parseUrl(window.location.search, out), out };
  });
  const [state, setState] = useState(first.s);
  const [ignored, setIgnored] = useState<Ignored[]>(first.out);
  useEffect(() => {
    const on = () => {
      const out: Ignored[] = [];
      setState(parseUrl(window.location.search, out));
      setIgnored(out);
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const add = useCallback((x: Ignored) => setIgnored((l) => (l.some((y) => y.param === x.param && y.value === x.value) ? l : [...l, x])), []);
  const dismiss = useCallback(() => setIgnored([]), []);
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
  return [state, update, useMemo(() => ({ items: ignored, add, dismiss }), [ignored, add, dismiss])];
}
