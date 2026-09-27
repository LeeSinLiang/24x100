// Tonight's shortlist (agents/shortlist.py, `npm run shortlist`): every City-owned vacant lot re-checked against the
// public records, and the lots where a two-unit house fits today that passed the zoning and records checks. At a glance: the
// funnel, the count, the map with the shortlisted lots lit, one row per lot with its checks. The definition travels
// with the data and is printed here; nothing on this page is a model's word.
import { useMemo, useState } from 'react';
import { CityMap, MAP_ASPECT } from '../components/city/CityMap';
import { useBox } from '../components/workspace/Canvas';
import { useCityModel } from '../lib/city';
import { CASES } from './CaseView';
import { easeForCity } from '@engine/ease';
import { DEFAULT_SETTINGS } from '@engine/templates';
import { EaseBar } from '../components/workspace/Ease';
import type { ViewProps } from './types';
import '../styles/shortlist.css';

interface Check {
  status: 'found' | 'nothing' | 'couldnt';
  fact: string;
  open?: number;
  percent?: number;
}
interface Row {
  pin: string;
  address: string;
  district: string;
  hood: string;
  for_sale: boolean;
  status: string;
  verdict: { formula: string | null; width: number | null; trust: string };
  slope: number;
  checks: Record<string, Check>;
  link: string;
}
interface Latest {
  run_at: string;
  definition: { text: string; building: string };
  counts: {
    swept: number;
    fits_today: number;
    fits_today_for_sale: number;
    shortlist: number;
    shortlist_for_sale: number;
    shortlist_not_listed: number;
    excluded_from_fits: Record<string, number>;
    any_risk_finding: number;
    any_risk_finding_share: number;
  };
  sweep: { wall_s: number; requests: number; cost_usd: number };
  sources: Record<string, { dataset?: string; page?: string; rows?: number; sha256?: string; pulled_at?: string }>;
  lots: Row[];
}
interface Hist {
  run_at: string;
  shortlist: string[];
}

const latestFiles = import.meta.glob('../../../data/shortlist/latest.json', { eager: true, import: 'default' }) as Record<string, Latest>;
const histFiles = import.meta.glob('../../../data/shortlist/history.json', { eager: true, import: 'default' }) as Record<string, Hist[]>;
export const SHORTLIST: Latest | null = Object.values(latestFiles)[0] ?? null;
const HISTORY: Hist[] = Object.values(histFiles)[0] ?? [];

const n = (x: number) => x.toLocaleString('en-US');
const whenET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET';
const TILES: [string, string][] = [
  ['violations', 'Cases'],
  ['condemned', 'Condemned'],
  ['liens', 'Liens'],
  ['undermining', 'Mapped mines'],
  ['slope', '≥25% slope'],
  ['311', '311'],
];
const EXCL: Record<string, [string, string]> = { liens: ['has an unsatisfied tax lien', 'have unsatisfied tax liens'], undermining: ['is over old mines', 'are over old mines'], violations: ['has an open case', 'have open cases'], condemned: ['is condemned', 'are condemned'] };

export function ShortlistView({ s, audit }: ViewProps) {
  const L = SHORTLIST;
  const cm = useCityModel(!!L, 'two', audit, null, { hood: null, sale: false, ward: null, zone: null });
  const [ref, box] = useBox<HTMLDivElement>();
  const [sel, setSel] = useState<number | null>(null);
  const pins = useMemo(() => new Set(L?.lots.map((l) => l.pin) ?? []), [L]);
  const lit = useMemo(() => cm.lots.map((l, i) => (pins.has(l.pin) ? i : -1)).filter((i) => i >= 0), [cm.lots, pins]);
  const sale = useMemo(() => new Set(L?.lots.filter((l) => l.for_sale).map((l) => l.pin) ?? []), [L]);
  const litSale = useMemo(() => lit.filter((i) => sale.has(cm.lots[i].pin)), [lit, sale, cm.lots]);
  const idxOf = useMemo(() => new Map(cm.lots.map((l, i) => [l.pin, i])), [cm.lots]);
  if (!L) {
    return (
      <main className="sl-view" id="main">
        <h1 className="sl-title">No shortlist yet</h1>
        <p>
          Run <code>npm run shortlist</code>: it re-checks every City-owned vacant lot against the public records.
        </p>
      </main>
    );
  }
  const c = L.counts;
  const prev = HISTORY.length > 1 ? new Set(HISTORY[HISTORY.length - 2].shortlist) : null;
  const fresh = prev ? L.lots.filter((l) => !prev.has(l.pin)).length : null;
  const excl = Object.entries(c.excluded_from_fits).sort((a, b) => b[1] - a[1]);
  const w = Math.max(0, Math.min(box.w, (box.h || box.w * MAP_ASPECT) / MAP_ASPECT));
  return (
    <main className="sl-view" id="main" data-shortlist={c.shortlist}>
      <header className="sl-head">
        <p className="label sl-kicker">Tonight’s shortlist · swept {whenET(L.run_at)}</p>
        <h1 className="sl-title">
          <span className="sl-count" data-shortlist-count>
            {n(c.shortlist)} City lots
          </span>{' '}
          <span className="sl-sub">where a two-unit house fits today and that passed the zoning and records checks</span>
        </h1>
        <p className="sl-split">
          <span className="sl-chip is-sale">{c.shortlist_for_sale} listed for sale</span>
          <span className="sl-chip">{c.shortlist_not_listed} City-owned, not listed</span>
          {fresh != null ? <span className="sl-chip is-new">{fresh} new tonight</span> : <span className="sl-chip is-new">first run</span>}
        </p>
        <p className="sl-funnel" data-funnel>
          <span>
            <strong>{n(c.swept)}</strong> City lots re-checked
          </span>
          <span aria-hidden="true">→</span>
          <span>
            <strong>{n(c.fits_today)}</strong> fit a two-unit house
          </span>
          <span aria-hidden="true">→</span>
          <span>
            <strong>{n(c.shortlist)}</strong> passed the zoning and records checks
          </span>
          <span className="small muted">
            {' '}
            · {Math.round(L.sweep.wall_s)} s · {L.sweep.requests} requests · no model · ${L.sweep.cost_usd}
          </span>
        </p>
      </header>

      <div className="sl-cols">
        <figure className="sl-map" ref={ref} data-shortlist-map>
          {cm.data.state === 'ready' && box.w > 0 ? (
            <div style={{ width: w || undefined }}>
              <CityMap
                lots={cm.lots}
                water={cm.data.water}
                classes={cm.classes}
                hoods={cm.hoods}
                focus={null}
                selected={sel}
                onSelect={setSel}
                onZoom={() => {}}
                present={s.present}
                record={s.record}
                whatIf={lit}
                marks={lit}
                markStrong={litSale}
                label={`Map of Pittsburgh: the ${c.shortlist} shortlisted City lots lit, the rest dimmed.`}
              />
            </div>
          ) : (
            <p className="muted small">Loading the map…</p>
          )}
          <figcaption className="small muted">
            Lit: tonight’s {c.shortlist}. Of the {n(c.fits_today)} that fit, {excl.map(([k, v]) => `${v} ${(EXCL[k] ?? [k, k])[v === 1 ? 0 : 1]}`).join(', ')} (a lot can have several).
          </figcaption>
        </figure>

        <section className="sl-list" aria-label="The shortlisted lots">
          <ol className="sl-rows">
            {L.lots.map((l) => {
              const cf = CASES[l.pin];
              return (
                <li key={l.pin} className="sl-row" data-shortlist-row={l.pin}>
                  <p className="sl-row-head">
                    <a href={cf ? `?view=case&pin=${l.pin}` : l.link}>{l.address}</a> <span className="small muted">· {l.hood} · {l.district}</span>
                    {idxOf.has(l.pin) ? <EaseBar ease={easeForCity(cm.classes[idxOf.get(l.pin)!], cm.lots[idxOf.get(l.pin)!], DEFAULT_SETTINGS)} compact /> : null}
                    <span className={`sl-chip ${l.for_sale ? 'is-sale' : ''}`}>{l.for_sale ? 'for sale' : 'not listed'}</span>
                  </p>
                  <ul className="sl-checks">
                    {TILES.map(([k, name]) => {
                      const ch = l.checks[k];
                      if (!ch) return null;
                      const bad = k === 'slope' || k === '311' ? ch.status === 'found' : ch.status === 'found' && (k !== 'violations' || !!ch.open);
                      return (
                        <li key={k} className={`sl-check ${ch.status === 'couldnt' ? 'is-couldnt' : bad ? 'is-found' : 'is-nothing'} ${k === 'slope' || k === '311' ? 'is-shown' : ''}`} title={ch.fact}>
                          <span className="sl-check-name">{name}</span>{' '}
                          {ch.status === 'couldnt' ? '—' : k === '311' ? ((ch as Check & { near?: number }).near ?? 0) : bad ? (k === 'slope' ? `${ch.percent}% of lot` : '⚠︎') : '✓'}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <details className="sl-def">
        <summary>The definition, and the sources</summary>
        <p>{L.definition.text}</p>
        <p className="small muted">
          Any risk finding across all {n(c.swept)} lots: {n(c.any_risk_finding)} ({Math.round(c.any_risk_finding_share * 100)}%). Re-run: <code>npm run shortlist</code>; nightly with the digest.
        </p>
        <ul className="small">
          {Object.entries(L.sources)
            .filter(([, v]) => v.dataset)
            .map(([k, v]) => (
              <li key={k}>
                <a href={v.page} target="_blank" rel="noreferrer">
                  {v.dataset}
                </a>
                {v.rows != null ? ` · ${n(v.rows)} rows` : ''}
                {v.pulled_at ? ` · pulled ${v.pulled_at.slice(0, 16).replace('T', ' ')}` : ''}
                {v.sha256 ? ` · sha ${v.sha256.slice(0, 10)}` : ''}
              </li>
            ))}
        </ul>
      </details>
    </main>
  );
}
