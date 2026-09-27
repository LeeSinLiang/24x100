// Compare (?view=compare): up to three sites on the same columns, the Development Ease parts row by row. The sites come
// from the link, each with its own building type and, on a lot with block detail, its own builder's quote:
// cols=10K:25:two;10K:25,26,27:three:140;<PIN>:two. With none, lot 25 alone, lots 25–27 together and tonight's first
// shortlisted lot. Any column can be changed to another site by parcel ID or address (the header search's index).
import { useMemo, useState } from 'react';
import { EASE_IDS, EASE_LABEL, easeForCity, easeForLot, type Ease } from '@engine/ease';
import { BLOCKER_WORDS, classifyCityLot, type CityLot } from '@engine/city';
import { buildRuleSet, DEFAULT_SETTINGS, TEMPLATES, type AuditEntry, type TemplateId } from '@engine/index';
import { buildSearchIndex, searchLots, type SearchEntry, type SearchHit } from '@engine/search';
import { Label } from '../components/ui';
import { EaseBar, EasePartCell } from '../components/workspace/Ease';
import { kFmt as k, VerdictStamp } from '../components/workspace/plain';
import { BLOCKS, QUESTIONS, RULES } from '../lib/data';
import { useCityData } from '../components/city/cityData';
import { lotKey, useLotModel, type LotModel } from '../lib/model';
import { parseUrl, type UrlState } from '../lib/url';
import { SHORTLIST } from './ShortlistView';
import type { ViewProps } from './types';
import '../styles/compare.css';

interface Col {
  key: string;
  title: string;
  sub: string;
  basis: string; // the cost basis: your quote, the practitioner's estimate, or not modelled
  quote: boolean;
  href: string;
  ease: Ease;
  verdict: React.ReactNode;
  money: string;
}

export type Spec = { kind: 'lot'; block: string; lots: string[]; type: TemplateId; quote: number | null } | { kind: 'city'; pin: string; type: TemplateId };
const TYPES: TemplateId[] = ['detached', 'two', 'row', 'three'];
export function parseSpec(x: string): Spec | null {
  const [a, b, c, d] = x.split(':');
  const type = (t?: string): TemplateId => (TYPES.includes(t as TemplateId) ? (t as TemplateId) : 'two');
  if (BLOCKS[a]) {
    const lots = (b ?? '').split(',').filter(Boolean);
    const q = Number(d);
    return lots.length ? { kind: 'lot', block: a, lots, type: type(c), quote: d && Number.isFinite(q) && q >= 20 && q <= 2000 ? q : null } : null;
  }
  return /^[0-9A-Z]{16}$/i.test(a ?? '') ? { kind: 'city', pin: a.toUpperCase(), type: type(b) } : null;
}
export const specOf = (s: Spec) => (s.kind === 'lot' ? `${s.block}:${s.lots.join(',')}:${s.type}${s.quote != null ? `:${s.quote}` : ''}` : `${s.pin}:${s.type}`);
const lotUrl = (s: Extract<Spec, { kind: 'lot' }>) =>
  `?view=lot&block=${s.block}&lot=${s.lots[0]}&type=${s.type}${s.lots.length > 1 ? `&lots=${s.lots.join(',')}` : ''}${s.quote != null ? `&quote=${s.quote}` : ''}`;
export const DEFAULT_COLS = ['10K:25:two', '10K:25,26,27:three', ...(SHORTLIST?.lots[0] ? [`${SHORTLIST.lots[0].pin}:two`] : [])];
/** The compare link from a lot or city card: this site first, then the defaults it isn't. */
export const compareHref = (first: string) => `?view=compare&cols=${[first, ...DEFAULT_COLS.filter((d) => d !== first)].slice(0, 3).join(';')}`;
export const specForLot = (block: string, lots: string[], type: TemplateId, quote: number | null) => specOf({ kind: 'lot', block, lots, type, quote });

const typeName = (t: TemplateId) => TEMPLATES[t].name.toLowerCase();
const lotsWords = (ls: string[]) => (ls.length === 1 ? `lot ${ls[0]}` : `lots ${ls[0]}–${ls[ls.length - 1]}`);
const gapWords = (m: LotModel['money']) => (!m || !m.gap || m.money_verdict === 'no_new_build' ? 'not assessed' : m.money_verdict === 'worth_pricing_site' ? 'the sale covers full cost' : `${k(m.gap.lo)}–${k(m.gap.hi)} a home before land`);
const MAP_ONLY = 'money not modelled for map-only lots (no plan yet)';

function lotCol(model: LotModel | null, sp: Spec | null): Col | null {
  if (!model || !sp || sp.kind !== 'lot') return null;
  const block = BLOCKS[sp.block];
  const r = model.result;
  const p0 = block.parcels.find((x) => r.pins.includes(x.pin) && lotKey(x) === sp.lots[0]) ?? block.parcels.find((x) => x.pin === r.pins[0]);
  const m = model.money;
  const basis = m?.quote ? `at your $${sp.quote} quote` : m ? "at the practitioner's estimate" : 'not assessed';
  return {
    key: specOf(sp),
    title: `${p0?.addr ?? block.meta.name} · ${lotsWords(sp.lots)}`,
    sub: `${block.meta.neighborhood} · ${r.district ?? '—'} · ${typeName(sp.type)}`,
    basis,
    quote: !!m?.quote,
    href: lotUrl(sp),
    ease: easeForLot(r, m, r.pins.map((p) => block.parcels.find((x) => x.pin === p)!), model.ctx.settings, model.moneyGap ?? 'no money data'),
    verdict: <VerdictStamp headline={model.verdict.headline} refusal={r.refusal?.code} quote={!!m?.quote} />,
    money: m && m.gap && m.money_verdict !== 'no_new_build' ? `${gapWords(m)}, ${basis}` : gapWords(m),
  };
}

function cityCol(sp: Spec | null, lots: CityLot[] | null, audit: AuditEntry[]): Col | null {
  if (!sp || sp.kind !== 'city' || !lots) return null;
  const l = lots.find((x) => x.pin === sp.pin);
  if (!l || !l.zone) return null;
  const c = classifyCityLot(l, buildRuleSet(l.zone, RULES, QUESTIONS, audit), sp.type, DEFAULT_SETTINGS);
  const listed = SHORTLIST?.lots.some((x) => x.pin === l.pin);
  const pencil = c.trust !== 'ink' ? ' (pencil)' : '';
  const words = c.blocker === 'fits' ? `Fits${pencil} · for sale` : c.blocker === 'ownership' ? `Fits${pencil} · not listed` : `${BLOCKER_WORDS[c.blocker]}${pencil}`;
  return {
    key: specOf(sp),
    title: l.addr,
    sub: `${l.hood ?? 'Pittsburgh'} · ${l.zone}${listed ? " · tonight's shortlist" : ''} · ${typeName(sp.type)}`,
    basis: 'not modelled: no plan yet',
    quote: false,
    href: `?view=city&type=${sp.type}&pin=${l.pin}`,
    ease: easeForCity(c, l, DEFAULT_SETTINGS),
    verdict: <span className={`stamp cmp-fits ${pencil ? 'is-pencil' : ''}`}>{words}</span>,
    money: MAP_ONLY,
  };
}

/** Change a column's site: the header search's index (every lot on a detailed block, every City-owned vacant lot). */
function Pick({ index, label, onPick }: { index: SearchEntry[]; label: string; onPick: (h: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchLots(index, q, 6), [index, q]);
  return (
    <details className="cmp-pick">
      <summary>{label}</summary>
      <input
        aria-label={`${label}: parcel ID or address`}
        placeholder="Parcel ID or address…"
        value={q}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && hits[0] && onPick(hits[0])}
      />
      {q.trim().length >= 2 && (
        <ul className="cmp-hits">
          {hits.map((h) => (
            <li key={h.entry.pin}>
              <button type="button" onClick={() => onPick(h)}>
                <strong>{h.entry.addr}</strong> {h.entry.detail ? `· lot ${h.entry.lot}` : `· ${h.entry.hood || 'City lot'}`}
              </button>
            </li>
          ))}
          {!hits.length && <li className="muted small">{index.length > 200 ? 'No match' : 'Loading every City lot…'}</li>}
        </ul>
      )}
    </details>
  );
}

const EMPTY: UrlState = parseUrl('');

export function CompareView({ s, update, audit }: ViewProps) {
  const raw = s.cols.length ? s.cols : DEFAULT_COLS;
  const key = raw.join(';');
  const specs = useMemo(() => key.split(';').map(parseSpec), [key]);
  const states = useMemo(() => [0, 1, 2].map((i) => (specs[i]?.kind === 'lot' ? parseUrl(lotUrl(specs[i] as Extract<Spec, { kind: 'lot' }>)) : null)), [specs]);
  const m0 = useLotModel(states[0] ? BLOCKS[states[0].block] : undefined, states[0] ?? EMPTY, audit);
  const m1 = useLotModel(states[1] ? BLOCKS[states[1].block] : undefined, states[1] ?? EMPTY, audit);
  const m2 = useLotModel(states[2] ? BLOCKS[states[2].block] : undefined, states[2] ?? EMPTY, audit);
  const data = useCityData(true);
  const cityLots = data.state === 'ready' ? data.lots : null;
  const index = useMemo(() => buildSearchIndex(Object.values(BLOCKS), cityLots?.map((l) => ({ pin: l.pin, addr: l.addr, hood: l.hood ?? '' })) ?? []), [cityLots]);
  const models = [m0, m1, m2];
  const cols = specs.map((sp, i) => (sp?.kind === 'lot' ? lotCol(models[i], sp) : cityCol(sp, cityLots, audit)));
  const shown = cols.filter((c): c is Col => !!c);
  const pick = (i: number) => (h: SearchHit) => {
    const block = h.entry.detail ? Object.values(BLOCKS).find((b) => b.parcels.some((p) => p.pin === h.entry.pin)) : undefined;
    const p = block?.parcels.find((x) => x.pin === h.entry.pin);
    const type = specs[i]?.type ?? 'two';
    const sp: Spec = block && p ? { kind: 'lot', block: block.meta.id, lots: [lotKey(p)], type, quote: null } : { kind: 'city', pin: h.entry.pin, type };
    const next = [...raw];
    next[i] = specOf(sp);
    update({ cols: next.slice(0, 3) }, { push: true });
  };
  const add = raw.length < 3;
  const blank = (i: number) => (!specs[i] ? 'not a site we can read' : specs[i]!.kind === 'city' && !cityLots ? 'loading…' : 'not found');
  return (
    <main className="cmp-view" id="main">
      <header className="cmp-head">
        <p className="label">Compare sites · Development Ease, part by part</p>
        <h1 className="cmp-title">Same columns, {['no', 'one', 'two', 'three'][shown.length]} site{shown.length === 1 ? '' : 's'}</h1>
        <p className="small muted">
          A range out of 100 from six parts: a known step takes its weight off both ends, an unknown off the low end only. Our weights, shown on each lot’s Ease tab.
        </p>
      </header>
      <div className="cmp-scroll">
        <table className="cmp-table" data-ease-compare>
          <thead>
            <tr>
              <th scope="col" />
              {specs.map((_, i) => {
                const c = cols[i];
                return (
                  <th key={i} scope="col" data-cmp-col={c?.key ?? i}>
                    {c ? (
                      <>
                        <a href={c.href}>{c.title}</a>
                        <span className="cmp-sub">{c.sub}</span>
                        <span className={`cmp-basis ${c.quote ? 'is-quote' : ''}`} data-cmp-basis={i}>
                          cost {c.basis}
                        </span>
                      </>
                    ) : (
                      <span className="muted small">{blank(i)}</span>
                    )}
                    <Pick index={index} label="Change site" onPick={pick(i)} />
                  </th>
                );
              })}
              {add ? (
                <th scope="col" className="cmp-add">
                  <Pick index={index} label="Add a site" onPick={pick(raw.length)} />
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Verdict</th>
              {specs.map((_, i) => (
                <td key={i}>{cols[i]?.verdict ?? '—'}</td>
              ))}
              {add ? <td /> : null}
            </tr>
            <tr className="cmp-ease-row">
              <th scope="row">Development Ease</th>
              {specs.map((_, i) => {
                const c = cols[i];
                return (
                  <td key={i} data-cmp-ease={i}>
                    {c ? <EaseBar ease={c.ease} /> : '—'}
                    {c && !c.ease.scored ? <span className="small muted cmp-why">{c.ease.why}</span> : null}
                  </td>
                );
              })}
              {add ? <td /> : null}
            </tr>
            {EASE_IDS.map((id) => (
              <tr key={id} data-cmp-row={id}>
                <th scope="row">{EASE_LABEL[id]}</th>
                {specs.map((_, i) => {
                  const p = cols[i]?.ease.parts.find((x) => x.id === id);
                  return <td key={i}>{p ? <EasePartCell p={p} /> : <span className="muted">—</span>}</td>;
                })}
                {add ? <td /> : null}
              </tr>
            ))}
            <tr>
              <th scope="row">Subsidy per home</th>
              {specs.map((_, i) => (
                <td key={i}>{cols[i]?.money ?? '—'}</td>
              ))}
              {add ? <td /> : null}
            </tr>
          </tbody>
        </table>
      </div>
      <Label as="h2">Read it</Label>
      <p className="small">
        ✓ clear · ✕ blocks · ? unknown, with who to ask on each lot’s Ease tab. Water and sewer is unknown everywhere: nothing here models it yet (ask PWSA). Each column’s cost is its own: your quote
        where you gave one, else the practitioner’s estimate. Change any column to another site by parcel ID or address.
      </p>
    </main>
  );
}
