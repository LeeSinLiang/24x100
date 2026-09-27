// The city view: every City-owned vacant lot, colored by the first thing that blocks the chosen
// building type. Classification runs here, live, from the current rule reviews: when a teammate signs
// a district's rules, that district's dots turn from grey to color. Grey stays grey; nothing is guessed.
import { useEffect, useMemo, useState } from 'react';
import { AssemblyPanel, useAssemblies } from '../components/city/Assemblies';
import { classifyCityLot, summarize, type CityClass } from '@engine/city';
import { buildRuleSet, pick } from '@engine/rules';
import { DEFAULT_SETTINGS, TEMPLATES } from '@engine/templates';
import type { RuleSet } from '@engine/types';
import { CityMap, hoodIndex } from '../components/city/CityMap';
import { LotCard, type BlockLink } from '../components/city/LotCard';
import { LotTable } from '../components/city/LotTable';
import { TypeRail } from '../components/city/TypeRail';
import { GREY, LEGEND_ORDER, STYLE, lotsWord, n, zoneName } from '../components/city/blockers';
import { useCityData, type CityLotRow } from '../components/city/cityData';
import { DISCLAIMER, DrawerCtx, Ev, Label, dateFmt } from '../components/ui';
import { BLOCKS, QUESTIONS, RULES } from '../lib/data';
import { lotKey } from '../lib/model';
import type { ViewProps } from './types';
import '../styles/city.css';

function useNarrow(): boolean {
  const q = '(max-width: 767px)';
  const [v, setV] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Lots that are in a loaded block file open the full lot view. */
const BLOCK_OF: Map<string, BlockLink> = new Map(
  Object.values(BLOCKS).flatMap((b) => b.parcels.map((p) => [p.pin, { block: b.meta.id, blockName: b.meta.name, lot: lotKey(p) }] as const)),
);

/** Read-once URL extras the shared URL state doesn't carry yet (neighborhood zoom, selected PIN). */
function urlExtra(k: string): string | null {
  return new URLSearchParams(window.location.search).get(k);
}

export function CityView({ s, update, audit }: ViewProps) {
  const data = useCityData();
  const narrow = useNarrow();
  const [focus, setFocus] = useState<string | null>(() => urlExtra('hood'));
  const [pin, setPin] = useState<string | null>(() => urlExtra('pin'));

  const lots: CityLotRow[] = data.state === 'ready' ? data.lots : [];
  const hoods = useMemo(() => hoodIndex(lots, data.state === 'ready' ? data.hoods : []), [data]);

  // One rule set per district present, folded with the audit log (so signatures recolor the map).
  const ruleSets = useMemo(() => {
    const m = new Map<string, RuleSet>();
    for (const l of lots) if (l.zone && !m.has(l.zone)) m.set(l.zone, buildRuleSet(l.zone, RULES, QUESTIONS, audit));
    return m;
  }, [lots, audit]);
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, recon_tolerance: s.tol ?? DEFAULT_SETTINGS.recon_tolerance }), [s.tol]);
  const classes: CityClass[] = useMemo(() => lots.map((l) => classifyCityLot(l, l.zone ? ruleSets.get(l.zone) ?? null : null, s.type, settings)), [lots, ruleSets, s.type, settings]);
  const sum = useMemo(() => summarize(lots, classes, s.type), [lots, classes, s.type]);

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
    return { z, computed, greyZones, pencilZones };
  }, [classes, lots]);

  const idxOf = useMemo(() => new Map(lots.map((l, i) => [l.pin, i])), [lots]);
  // "Combine to fit" (C15): City lots in a qualifying run are ringed on the map; the selected run heavier.
  const asmOn = s.layer === 'assemble';
  const hoodByPin = useMemo(() => new Map(lots.map((l) => [l.pin, l.hood ?? null])), [lots]);
  const asm = useAssemblies(asmOn);
  const asmMarks = useMemo(() => {
    if (!asmOn || !asm || asm === 'loading') return { all: [] as number[], sel: [] as number[] };
    const runs = asm.runs.filter((r) => r.type === s.type);
    const idx = (pins: string[]) => pins.map((p) => idxOf.get(p)).filter((i): i is number => i != null);
    return { all: [...new Set(idx(runs.flatMap((r) => r.pins)))], sel: s.run ? idx(s.run.split(',')) : [] };
  }, [asmOn, asm, s.type, s.run, idxOf]);
  const selected = pin != null ? idxOf.get(pin) ?? null : null;
  const rows = useMemo(() => lots.map((_, i) => i).filter((i) => !focus || lots[i].hood === focus), [lots, focus]);

  // Keep the URL shareable: ?hood= and ?pin= ride along with the shared state.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('view') !== 'city' && q.has('view')) return;
    const want = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
    want('hood', focus);
    want('pin', pin);
    const next = `?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`;
    if (next !== window.location.search) window.history.replaceState(null, '', next);
  }, [focus, pin, s.type, s.drawer, s.district]);

  // A search (or any link) that sets ?pin= / ?hood= while this view is open selects that lot.
  useEffect(() => {
    if (s.pin && s.pin !== pin) setPin(s.pin);
    if (s.hood !== undefined && s.hood !== focus && (s.hood || s.pin)) setFocus(s.hood);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pin, s.hood]);

  const zoom = (h: string | null) => {
    setFocus(h);
    if (h && pin && lots[idxOf.get(pin) ?? -1]?.hood !== h) setPin(null);
  };
  const select = (i: number | null) => setPin(i == null ? null : lots[i].pin);
  const openLot = (l: BlockLink) => {
    update({ view: 'lot', block: l.block, lot: l.lot, lots: [], drawer: null }, { push: true });
    window.scrollTo(0, 0);
  };

  const tname = TEMPLATES[s.type].name;
  const rmin = (zone: string | null) => (zone ? pick(ruleSets.get(zone) ?? { district: zone, rules: [], questions: [] }, 'min_lot_area') : undefined);

  // What to do next: the lot the 2025 reform made big enough and the setbacks still made too narrow
  // (width blocks, area doesn't), for sale, in a loaded block; closest to the minimum lot size.
  const featured = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots, classes, ruleSets]);

  const reviewTarget = useMemo(() => {
    const reviewable = new Set(RULES.map((r) => r.district));
    const grey = cover.greyZones.filter(([z]) => z !== '—');
    return grey.find(([z]) => reviewable.has(z)) ?? grey.find(([z]) => z === 'R1D-H') ?? grey[0] ?? null;
  }, [cover]);

  const fitsDim = sum.byBlocker.fits + sum.byBlocker.ownership;
  const fitTrust = classes.some((c) => (c.blocker === 'fits' || c.blocker === 'ownership') && c.trust !== 'ink') ? 'pencil' : 'ink';
  const grey = sum.byBlocker.rules;
  const computedNames = cover.computed.map(zoneName);
  const listAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const coverage =
    data.state !== 'ready'
      ? null
      : cover.computed.length
        ? `Computed for ${listAnd(computedNames)} only; ${n(grey)} ${lotsWord(grey)} in other districts ${grey === 1 ? 'is' : 'are'} grey: rules not loaded.`
        : `Computed for no district yet; ${grey === lots.length ? 'all ' : ''}${n(grey)} ${lotsWord(grey)} ${grey === 1 ? 'is' : 'are'} grey: rules not loaded.`;
  const pencilNote = cover.pencilZones.length ? `${listAnd(cover.pencilZones.map(zoneName))} rules are proposed and wait for a teammate’s signature.` : '';
  const edgeRec = [
    sum.byBlocker.records ? `${n(sum.byBlocker.records)} can’t be scored (records disagree)` : '',
    sum.byBlocker.edges ? `${n(sum.byBlocker.edges)} ${sum.byBlocker.edges === 1 ? 'has' : 'have'} edges not computed` : '',
  ].filter(Boolean);

  const selLot = selected != null ? lots[selected] : null;
  const selCls = selected != null ? classes[selected] : null;
  const selLink = selLot ? BLOCK_OF.get(selLot.pin) ?? null : null;
  // Evidence opened from the selected lot reads that lot's district and block.
  const openEvidence = (ref: string) => update({ drawer: ref, district: selLot?.zone ?? null, ...(selLink ? { block: selLink.block } : {}) });
  const card =
    selLot && selCls ? (
      <DrawerCtx.Provider value={openEvidence}>
        <LotCard lot={selLot} cls={selCls} type={s.type} rs={selLot.zone ? ruleSets.get(selLot.zone) ?? null : null} link={selLink} onClose={() => setPin(null)} openLot={openLot} />
      </DrawerCtx.Provider>
    ) : null;

  const hoodList = useMemo(() => [...hoods.values()].filter((h) => h.lots > 0).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), [hoods]);
  const inView = focus ? rows.length : lots.length;

  return (
    <main className="city-view" id="main">
      <section className="city-top">
        <div className="city-map-col">
          <TypeRail type={s.type} onType={(t) => update({ type: t }, { push: true })} />
          <div className="city-zoom" role="group" aria-label="Zoom">
            <button className={`btn btn-small ${!focus ? 'is-on' : ''}`} aria-pressed={!focus} onClick={() => zoom(null)}>
              Pittsburgh
            </button>
            <label className="city-hood-pick">
              <span className="label">Neighborhood</span>
              <select value={focus ?? ''} onChange={(e) => zoom(e.target.value || null)}>
                <option value="">All of Pittsburgh</option>
                {hoodList.map((h) => (
                  <option key={h.name} value={h.name}>
                    {h.name} · {n(h.lots)}
                  </option>
                ))}
              </select>
            </label>
            {focus && (
              <span className="small muted city-zoom-note">
                {n(inView)} {lotsWord(inView)} in {focus}
              </span>
            )}
          </div>
          {data.state === 'ready' ? (
            <div className="city-map-box">
              <CityMap
                lots={lots}
                water={data.water}
                classes={classes}
                hoods={hoods}
                focus={focus}
                selected={selected}
                onSelect={select}
                onZoom={zoom}
                present={s.present}
                record={s.record}
                inset={narrow ? null : card}
                marks={asmMarks.all}
                markStrong={asmMarks.sel}
                label={`Map of ${focus ?? 'Pittsburgh'}: ${n(inView)} City-owned vacant lots as dots, colored by what first blocks a ${tname.toLowerCase()}. The table below lists the same lots.`}
              />
            </div>
          ) : (
            <MapPlaceholder state={data.state} message={data.state === 'error' ? data.message : ''} />
          )}
          {narrow && card}
          <p className="city-caption small muted">
            One dot per City-owned vacant lot, at its representative point. Color is the first thing that blocks a {tname.toLowerCase()}; grey means we did not compute it. Click a dot, or use the table.
            {data.state === 'ready' && (
              <>
                {' '}
                This map holds {n(lots.length)} {lotsWord(lots.length)}
                {data.meta.source ? `, from ${data.meta.source}` : ''}.
              </>
            )}
          </p>
        </div>

        <div className="city-answer-col">
          {asmOn ? (
            <AssemblyPanel
              data={asm}
              type={s.type}
              typeName={tname}
              focus={focus}
              hoodOf={hoodByPin}
              selected={s.run}
              onSelect={(r) => {
                const lead = lots[idxOf.get(r.candidates[0]) ?? -1];
                if (lead?.hood && lead.hood !== focus) zoom(lead.hood);
                update({ run: r.pins.join(',') });
              }}
              onClose={() => update({ layer: null, run: null }, { push: true })}
            />
          ) : (
          <>
          <p className="sentence city-sentence" aria-live="polite">
            {data.state === 'loading' ? (
              <span className="muted" role="status">Loading every City-owned vacant lot…</span>
            ) : data.state !== 'ready' ? (
              <span className="pencil-text">The citywide lot file isn’t loaded, so there is no citywide count yet.</span>
            ) : sum.computed > 0 && sum.widthNotArea > 0 ? (
              <>
                In {listAnd(computedNames)}, width blocks{' '}
                <Ev num>{n(sum.widthNotArea)}</Ev> City‑owned {lotsWord(sum.widthNotArea)} that {sum.widthNotArea === 1 ? 'is' : 'are'} big enough for a {tname.toLowerCase()}.
              </>
            ) : sum.computed > 0 ? (
              <>
                In {listAnd(computedNames)}, a {tname.toLowerCase()} fits as of right on{' '}
                <Ev trust={fitTrust} num>
                  {n(fitsDim)}
                </Ev>{' '}
                of the {n(sum.computed)} City-owned {lotsWord(sum.computed)} we could check.
              </>
            ) : (
              <>No district’s rules are signed yet, so no lot can be checked. Every dot is grey.</>
            )}
          </p>
          {coverage && (
            <p className="city-coverage">
              <span className="mark mark-pencil" aria-hidden="true" /> {coverage} {pencilNote}
              {edgeRec.length ? <span className="muted"> Of the rest, {listAnd(edgeRec)}.</span> : null}
            </p>
          )}

          <div className="answers">
            <div className="answer">
              <Label as="h2">What fits</Label>
              <div className={`numeral-block tone-${fitTrust === 'ink' ? 'fits' : 'pencil'}`}>
                <Ev trust={fitTrust} className="numeral" num>
                  {data.state === 'ready' ? n(fitsDim) : '—'}
                  <span className="numeral-unit">{fitsDim === 1 ? 'lot' : 'lots'}</span>
                </Ev>
                {data.state === 'ready' ? (
                  <p className="numeral-cap">
                    A {tname.toLowerCase()} fits as of right on {n(fitsDim)} City-owned {lotsWord(fitsDim)} in checked districts
                    {fitsDim > 0 ? <span className="muted"> · {n(sum.byBlocker.fits)} listed for sale</span> : null}.
                  </p>
                ) : (
                  <p className="numeral-cap muted">Counting…</p>
                )}
              </div>
            </div>

            <div className="answer">
              <Label as="h2">What blocks it</Label>
              {sum.computed > 0 && (
                <p className="city-h1">
                  Width blocks <Ev num>{n(sum.widthNotArea)}</Ev> {lotsWord(sum.widthNotArea)} that are big enough; area blocks <Ev num>{n(sum.areaAny)}</Ev>.
                </p>
              )}
              {sum.computed > 0 && sum.widthNotArea > sum.widthNotAreaInk && (
                <p className="small">
                  Of the {n(sum.widthNotArea)}, <Ev num>{n(sum.widthNotAreaInk)}</Ev> are too narrow for certain;{' '}
                  {sum.widthNotAreaContext > 0 && (
                    <>
                      <Ev trust="pencil" num>
                        {n(sum.widthNotAreaContext)}
                      </Ev>{' '}
                      could fit if a built neighbour’s actual setback allows a contextual setback
                      {sum.widthNotAreaMapped > 0 ? '; ' : '.'}
                    </>
                  )}
                  {sum.widthNotAreaMapped > 0 && (
                    <>
                      <Ev trust="pencil" num>
                        {n(sum.widthNotAreaMapped)}
                      </Ev>{' '}
                      are measured from the City map, with no deed dimensions.
                    </>
                  )}
                </p>
              )}
              {data.state === 'ready' ? (
              <table className="city-counts">
                <caption className="visually-hidden">Lots by first blocker for a {tname.toLowerCase()}</caption>
                <thead className="visually-hidden">
                  <tr>
                    <th scope="col">First blocker</th>
                    <th scope="col">Lots</th>
                  </tr>
                </thead>
                <tbody>
                  {LEGEND_ORDER.map((b) => {
                    const st = STYLE[b];
                    const v = sum.byBlocker[b];
                    return (
                      <tr key={b} className={`${st.grey || b === 'records' ? 'is-grey' : ''} ${v === 0 ? 'is-zero' : ''}`}>
                        <th scope="row">
                          <span className={`bk bk-${b}`} aria-hidden="true" /> {st.words}
                          <span className="city-gloss"> · {st.gloss}</span>
                        </th>
                        <td className="num">{n(v)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              ) : null}
            </div>

            <div className="answer">
              <Label as="h2">What to do next</Label>
              <ul className="city-next">
                {featured && featured.link && (
                  <li>
                    <a
                      href={`?view=lot&block=${featured.link.block}&lot=${featured.link.lot}&type=${s.type}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        openLot(featured.link!);
                      }}
                    >
                      <strong>{featured.l.addr}</strong>:{' '}
                      {featured.c.all.includes('width') ? `see why a ${tname.toLowerCase()} gets ${featured.c.width}\u00a0ft` : featured.c.blocker === 'fits' ? `see the ${featured.c.width}\u00a0ft a ${tname.toLowerCase()} gets as of right` : `see what blocks a ${tname.toLowerCase()}`}
                    </a>
                  </li>
                )}
                {reviewTarget && (
                  <li>
                    <a href={`?view=review&district=${reviewTarget[0]}`}>Check another district’s rules</a>
                    <span className="small muted">
                      {' '}
                      · {zoneName(reviewTarget[0])} has {n(reviewTarget[1].grey)} grey {lotsWord(reviewTarget[1].grey)}; they take color when a teammate signs its rules.
                    </span>
                  </li>
                )}
              </ul>
              <p className="small">
                <a href={`?view=city&type=${s.type}&layer=assemble${focus ? `&hood=${encodeURIComponent(focus)}` : ''}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); update({ layer: 'assemble', run: null }, { push: true }); }}>
                  Combine to fit
                </a>
                <span className="muted"> · which City lots fit when combined with the lots beside them</span>
              </p>
            </div>
          </div>
          </>
          )}
        </div>
      </section>

      {data.state === 'ready' && (
        <section className="city-list" aria-labelledby="city-list-h">
          <h2 id="city-list-h" className="label">
            {focus ? `Lots in ${focus}` : 'Every lot on the map'} · {n(rows.length)} · {tname.toLowerCase()}
          </h2>
          <LotTable lots={lots} classes={classes} rows={rows} selected={selected} onSelect={select} caption={`City-owned vacant lots${focus ? ` in ${focus}` : ''}, first blocker for a ${tname.toLowerCase()}`} pageSize={narrow ? 20 : 50} />
        </section>
      )}

      <footer className="lot-foot">
        {data.state === 'ready' && (
          <p className="small muted">
            City-owned vacant lots: {n(data.meta.count ?? lots.length)}
            {data.meta.built ? `, built ${dateFmt(data.meta.built)}` : data.meta.pulled ? `, pulled ${dateFmt(data.meta.pulled)}` : ''}
            {data.meta.source ? ` from ${data.meta.source}` : ''}. Edge labels come from the same engine as the lot view; classification runs in your browser from the current rule reviews.
          </p>
        )}
        <p>{DISCLAIMER}</p>
      </footer>
    </main>
  );
}

function MapPlaceholder({ state, message }: { state: 'loading' | 'absent' | 'error'; message: string }) {
  return (
    <div className="city-plate city-empty" role="status">
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
