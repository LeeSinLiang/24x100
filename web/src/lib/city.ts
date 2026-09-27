// The citywide model the workspace shares between the map, the table, the left rail and the
// inspector: every City-owned vacant lot, classified live from the current rule reviews (so a
// signature recolors the map), then filtered by the rail's filters. Moved out of CityView (spec §0.15);
// the classification itself is the engine's (engine/src/city.ts).
import { useMemo } from 'react';
import { classifyCityLot, summarize, type Blocker, type CityClass, type CitySummary } from '@engine/city';
import { buildRuleSet, pick } from '@engine/rules';
import { DEFAULT_SETTINGS } from '@engine/templates';
import type { AuditEntry, RuleSet, TemplateId } from '@engine/types';
import { hoodIndex, type HoodInfo } from '../components/city/CityMap';
import { GREY } from '../components/city/blockers';
import type { BlockLink } from '../components/city/LotCard';
import { useCityData, type CityData, type CityLotRow } from '../components/city/cityData';
import { BLOCKS, QUESTIONS, RULES } from './data';
import { lotKey } from './model';

/** Lots that are in a loaded block file open the full lot view. */
export const BLOCK_OF: Map<string, BlockLink> = new Map(
  Object.values(BLOCKS).flatMap((b) => b.parcels.map((p) => [p.pin, { block: b.meta.id, blockName: b.meta.name, lot: lotKey(p) }] as const)),
);

export interface CityFilters {
  hood: string | null;
  sale: boolean;
  ward: number | null;
  zone: string | null;
}

export interface Coverage {
  computed: string[]; // districts with at least one lot past the rules check
  greyZones: [string, { lots: number; computed: number; grey: number; pencil: boolean }][];
  pencilZones: string[];
}

export interface CityModel {
  data: CityData;
  lots: CityLotRow[];
  classes: CityClass[];
  ruleSets: Map<string, RuleSet>;
  hoods: Map<string, HoodInfo>;
  idxOf: Map<string, number>;
  /** Indexes of the lots that pass the rail's filters (neighbourhood, for sale, ward, district). */
  inFilter: number[];
  /** The summary of the filtered lots: the counts the rail, tiles and tabs show. */
  sum: CitySummary;
  /** The summary of every lot, whatever the filters. */
  sumAll: CitySummary;
  cover: Coverage;
  fitTrust: 'ink' | 'pencil';
  featured: { l: CityLotRow; i: number; c: CityClass; link: BlockLink | undefined } | null;
  reviewTarget: [string, { lots: number; computed: number; grey: number; pencil: boolean }] | null;
  wards: number[];
  zones: string[];
  /** The AI's reading of districts whose rules no person has checked: its own layer, never in `sum` (null elsewhere). */
  pencilClasses: (CityClass | null)[];
  pencilSum: CitySummary;
  /** Districts with City lots and no rule read at all, with their lot counts. */
  unread: [string, number][];
}

export function useCityModel(on: boolean, type: TemplateId, audit: AuditEntry[], tol: number | null, f: CityFilters): CityModel {
  const data = useCityData(on);
  const lots: CityLotRow[] = data.state === 'ready' ? data.lots : [];
  const hoods = useMemo(() => hoodIndex(lots, data.state === 'ready' ? data.hoods : []), [data]);

  // One rule set per district present, folded with the audit log (so signatures recolor the map).
  const ruleSets = useMemo(() => {
    const m = new Map<string, RuleSet>();
    for (const l of lots) if (l.zone && !m.has(l.zone)) m.set(l.zone, buildRuleSet(l.zone, RULES, QUESTIONS, audit));
    return m;
  }, [lots, audit]);
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, recon_tolerance: tol ?? DEFAULT_SETTINGS.recon_tolerance }), [tol]);
  const classes: CityClass[] = useMemo(() => lots.map((l) => classifyCityLot(l, l.zone ? ruleSets.get(l.zone) ?? null : null, type, settings)), [lots, ruleSets, type, settings]);
  const idxOf = useMemo(() => new Map(lots.map((l, i) => [l.pin, i])), [lots]);

  const inFilter = useMemo(
    () =>
      lots
        .map((_, i) => i)
        .filter((i) => {
          const l = lots[i];
          return (!f.hood || l.hood === f.hood) && (!f.sale || l.status === 'Available for Sale') && (f.ward == null || l.ward === f.ward) && (!f.zone || l.zone === f.zone);
        }),
    [lots, f.hood, f.sale, f.ward, f.zone],
  );
  const sum = useMemo(() => summarize(inFilter.map((i) => lots[i]), inFilter.map((i) => classes[i]), type), [inFilter, lots, classes, type]);
  const sumAll = useMemo(() => summarize(lots, classes, type), [lots, classes, type]);

  // Coverage, derived from the classes (a district counts as computed when any of its lots got past
  // the rules check; records-disagree is decided before rules and says nothing about them).
  const cover = useMemo(() => {
    const z = new Map<string, { lots: number; computed: number; grey: number; pencil: boolean }>();
    classes.forEach((c, i) => {
      const k = lots[i].zone ?? '—';
      const cur = z.get(k) ?? { lots: 0, computed: 0, grey: 0, pencil: false };
      cur.lots++;
      if (c.blocker === 'rules') {
        cur.grey++;
        if (/still pencil/.test(c.note)) cur.pencil = true;
      } else if (c.blocker !== 'records') cur.computed++;
      z.set(k, cur);
    });
    const computed = [...z.entries()].filter(([, v]) => v.computed > 0).map(([k]) => k).sort();
    const greyZones = [...z.entries()].filter(([, v]) => v.grey > 0).sort((a, b) => b[1].grey - a[1].grey);
    const pencilZones = greyZones.filter(([, v]) => v.pencil).map(([k]) => k);
    return { computed, greyZones, pencilZones };
  }, [classes, lots]);

  const fitTrust = classes.some((c) => (c.blocker === 'fits' || c.blocker === 'ownership') && c.trust !== 'ink') ? 'pencil' : 'ink';

  // What to do next: the lot the 2025 reform made big enough and the setbacks still made too narrow
  // (width blocks, area doesn't), for sale, in a loaded block; closest to the minimum lot size.
  const featured = useMemo(() => {
    const rmin = (zone: string | null) => (zone ? pick(ruleSets.get(zone) ?? { district: zone, rules: [], questions: [] }, 'min_lot_area') : undefined);
    const cand = lots
      .map((l, i) => ({ l, i, c: classes[i], link: BLOCK_OF.get(l.pin) }))
      .filter((x) => x.link && !GREY.includes(x.c.blocker) && x.l.status === 'Available for Sale');
    const min = (x: (typeof cand)[number]) => {
      const r = rmin(x.l.zone);
      return typeof r?.value === 'number' ? Math.abs((x.c.area ?? 0) - r.value) : 1e9;
    };
    const order = (a: (typeof cand)[number], b: (typeof cand)[number]) => min(a) - min(b) || a.l.pin.localeCompare(b.l.pin);
    const narrowOnly = cand.filter((x) => x.c.all.includes('width') && !x.c.all.includes('area')).sort(order);
    const fits = cand.filter((x) => x.c.blocker === 'fits').sort(order);
    return narrowOnly[0] ?? fits[0] ?? cand.sort(order)[0] ?? null;
  }, [lots, classes, ruleSets]);

  const reviewTarget = useMemo(() => {
    const reviewable = new Set(RULES.map((r) => r.district));
    const grey = cover.greyZones.filter(([z]) => z !== '—');
    return grey.find(([z]) => reviewable.has(z)) ?? grey.find(([z]) => z === 'R1D-H') ?? grey[0] ?? null;
  }, [cover]);

  // The AI's reading (its own layer, never in the counts above): lots grey only because their district's rules are
  // proposed but unchecked, classified with those pencil rules. Every result is pencil.
  const pencilClasses = useMemo(
    () => classes.map((c, i) => (c.blocker === 'rules' && /still pencil/.test(c.note) && lots[i].zone ? classifyCityLot(lots[i], ruleSets.get(lots[i].zone!) ?? null, type, settings, undefined, { readPencil: true }) : null)),
    [classes, lots, ruleSets, type, settings],
  );
  const pencilSum = useMemo(() => {
    const idx = inFilter.filter((i) => pencilClasses[i]);
    return summarize(idx.map((i) => lots[i]), idx.map((i) => pencilClasses[i]!), type);
  }, [inFilter, pencilClasses, lots, type]);
  // Districts with lots and no rule read at all (their rules aren't in the saved code text, or not extracted yet).
  const unread = useMemo(() => cover.greyZones.filter(([z]) => z !== '—' && !(ruleSets.get(z)?.rules.some((r) => r.district === z))).map(([z, v]) => [z, v.lots] as [string, number]), [cover, ruleSets]);

  const wards = useMemo(() => [...new Set(lots.map((l) => l.ward).filter((w): w is number => w != null))].sort((a, b) => a - b), [lots]);
  const zones = useMemo(() => [...new Set(lots.map((l) => l.zone).filter((z): z is string => !!z))].sort(), [lots]);

  return { data, lots, classes, ruleSets, hoods, idxOf, inFilter, sum, sumAll, cover, fitTrust, featured, reviewTarget, wards, zones, pencilClasses, pencilSum, unread };
}

/** The map's layers (spec §0.15 left rail): one per first blocker, in the order the story reads. The
 *  words are plain; the blocker's own words and gloss stay in the tabs and the legend. */
export const LAYERS: { id: Blocker; words: string }[] = [
  { id: 'width', words: 'Too narrow' },
  { id: 'area', words: 'Too small' },
  { id: 'depth', words: 'Too shallow' },
  { id: 'ownership', words: 'Fits, not for sale' },
  { id: 'fits', words: 'Fits' },
  { id: 'records', words: 'Records disagree' },
  { id: 'edges', words: 'Edges not computed' },
  { id: 'rules', words: 'Not checked' },
];
export const LAYER_WORDS: Record<Blocker, string> = Object.fromEntries(LAYERS.map((l) => [l.id, l.words])) as Record<Blocker, string>;
