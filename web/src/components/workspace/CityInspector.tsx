// The inspector for the city (nothing selected), a city lot without block detail, a C15 run, the
// "Combine to fit" list and a block (spec §0.15). Today's city-page content, moved in: the counts and
// coverage in Rules, what to do next in Next, and the lot card's facts and routes for a city lot.
import type { ReactNode } from 'react';
import type { CityClass } from '@engine/city';
import { pick } from '@engine/rules';
import { TEMPLATES } from '@engine/templates';
import type { BlockFile, TemplateId } from '@engine/types';
import { AssemblyPanel, type AssemblyRunRow, type AssemblyFile } from '../city/Assemblies';
import { LEGEND_ORDER, STYLE, lotsWord, n, zoneName } from '../city/blockers';
import type { CityLotRow } from '../city/cityData';
import { LotActions, LotFacts, type BlockLink } from '../city/LotCard';
import { DISCLAIMER, dateFmt, DrawerCtx, Ev, ftFmt, Label } from '../ui';
import { BLOCKS, COMPS_BY_WARD, RULES } from '../../lib/data';
import { BLOCK_OF, LAYER_WORDS, type CityModel } from '../../lib/city';
import { blockCounts, type BlockModel } from '../../lib/block';
import type { InspectorTab, UrlState } from '../../lib/url';
import { Dash, InspectorShell, Tile, type TabDef } from './Shell';
import { aType, Gloss, RUN_ADDR_NOTE, runAddrs, runCounts, runLotsLabel } from './plain';
import { RecordList, RuleSources, type SourceRow } from './Sources';
import { WatchToggle } from '../WatchToggle';

const listAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function NotAssessed({ children }: { children: ReactNode }) {
  return <p className="na">— {children}</p>;
}

// ── The city, nothing selected ────────────────────────────────────────────────────────────────────
export function CityInspector({ cm, s, update, onTab, runCount, filtered }: { cm: CityModel; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; onTab: (t: InspectorTab) => void; runCount: number | null; filtered: boolean }) {
  const { sum, data } = cm;
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const fitsDim = sum.byBlocker.fits + sum.byBlocker.ownership;
  const k = cm.cover.computed.length;
  const computedNames = cm.cover.computed.map(zoneName);
  const grey = sum.byBlocker.rules;
  const ready = data.state === 'ready';
  const scope = s.hood ?? 'Pittsburgh';
  const coverage = !ready
    ? null
    : k
      ? `Computed for ${listAnd(computedNames)} only; ${n(grey)} ${lotsWord(grey)} in other districts ${grey === 1 ? 'is' : 'are'} grey: rules not loaded.`
      : `Computed for no district yet; ${n(grey)} ${lotsWord(grey)} ${grey === 1 ? 'is' : 'are'} grey: rules not loaded.`;
  const pencilNote = cm.cover.pencilZones.length ? `${listAnd(cm.cover.pencilZones.map(zoneName))} rules are proposed and wait for a teammate’s signature.` : '';
  const edgeRec = [
    sum.byBlocker.records ? `${n(sum.byBlocker.records)} can’t be scored (records disagree)` : '',
    sum.byBlocker.edges ? `${n(sum.byBlocker.edges)} ${sum.byBlocker.edges === 1 ? 'has' : 'have'} edges not computed` : '',
  ].filter(Boolean);
  const openLot = (l: BlockLink) => update({ view: 'lot', block: l.block, lot: l.lot, lots: [], drawer: null, pin: null }, { push: true });

  const sentence = !ready ? (
    data.state === 'loading' ? (
      <span className="muted" role="status">
        Loading every City-owned vacant lot…
      </span>
    ) : (
      <span className="pencil-text">The citywide lot file isn’t loaded, so there is no citywide count yet.</span>
    )
  ) : sum.computed > 0 && sum.widthNotArea > 0 ? (
    <>
      {filtered ? `Of the ${n(sum.total)} lots shown, ` : `In the ${k === 1 ? 'one district' : `${k} districts`} checked so far, `}
      <Ev num>{n(sum.widthNotArea)}</Ev> City‑owned {lotsWord(sum.widthNotArea)} {sum.widthNotArea === 1 ? 'is' : 'are'} big enough for {aType(s.type)} but too narrow.
    </>
  ) : sum.computed > 0 ? (
    <>
      {aType(s.type).replace(/^a/, 'A').replace(/^r/, 'R')} fits on{' '}
      <Ev trust={cm.fitTrust} num>
        {n(fitsDim)}
      </Ev>{' '}
      of the {n(sum.computed)} City-owned {lotsWord(sum.computed)} we could check{filtered ? ' here' : ''}.
    </>
  ) : (
    <>No lot here can be checked yet: {k ? 'its district’s rules aren’t signed' : 'no district’s rules are signed'}, so every dot is grey.</>
  );

  const tiles = (
    <>
      <Tile id="checked" label="Lots checked" value={ready ? <Ev num>{n(sum.computed)}</Ev> : <Dash why="loading" />} sub={ready ? `of ${n(sum.total)} City-owned` : 'loading'} />
      <Tile
        id="fits"
        label="Fit now"
        className={`tone-${cm.fitTrust === 'ink' ? 'fits' : 'pencil'}`}
        value={ready ? <Ev trust={cm.fitTrust} num>{n(fitsDim)}</Ev> : <Dash why="loading" />}
        sub={ready ? `${n(sum.byBlocker.fits)} for sale` : ''}
      />
      <Tile id="narrow" label="Too narrow" value={ready ? <Ev num>{n(sum.widthNotArea)}</Ev> : <Dash why="loading" />} sub="though big enough" />
      <Tile id="small" label="Too small" value={ready ? <Ev num>{n(sum.areaAny)}</Ev> : <Dash why="loading" />} sub="under the minimum size" />
    </>
  );

  const wards = Object.values(COMPS_BY_WARD);
  const tabs: TabDef[] = [
    {
      id: 'money',
      label: 'Money',
      panel: (
        <>
          <NotAssessed>Money is checked lot by lot, on lots with block detail. Pick a lot.</NotAssessed>
          <Label as="h3">Comparable sales loaded</Label>
          <ul className="ws-list small">
            {wards.map((c) => (
              <li key={c.meta.ward ?? 'x'}>
                Ward {c.meta.ward}: {c.counts.valid_1_2_unit} valid 1–2 unit sales since 2023, median{' '}
                <Ev num refId="money:comps">
                  ${n(c.median)}
                </Ev>{' '}
                <span className="muted">(context only, not an appraisal) · pulled {dateFmt(c.meta.pulled)}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: 'rules',
      label: 'Rules',
      panel: (
        <>
          {coverage && (
            <p className="city-coverage">
              <span className="mark mark-pencil" aria-hidden="true" /> {coverage} {pencilNote}
              {edgeRec.length ? <span className="muted"> Of the rest, {listAnd(edgeRec)}.</span> : null}
            </p>
          )}
          {ready && sum.computed > 0 && (
            <>
              <p className="ws-engine-sentence">
                In {listAnd(computedNames)}, width blocks <Ev num>{n(sum.widthNotArea)}</Ev> City‑owned {lotsWord(sum.widthNotArea)} that {sum.widthNotArea === 1 ? 'is' : 'are'} big enough for a {tname}.
              </p>
              <p className="city-h1">
                Width blocks <Ev num>{n(sum.widthNotArea)}</Ev> {lotsWord(sum.widthNotArea)} that are big enough; area blocks <Ev num>{n(sum.areaAny)}</Ev>. A {tname} fits{' '}
                <Gloss k="asofright">as of right</Gloss> on <Ev trust={cm.fitTrust} num>{n(fitsDim)}</Ev> ({n(sum.byBlocker.fits)} listed for sale).
              </p>
              {sum.widthNotArea > sum.widthNotAreaInk && (
                <p className="small">
                  Of the {n(sum.widthNotArea)}, <Ev num>{n(sum.widthNotAreaInk)}</Ev> are too narrow for certain;{' '}
                  {sum.widthNotAreaContext > 0 && (
                    <>
                      <Ev trust="pencil" num>
                        {n(sum.widthNotAreaContext)}
                      </Ev>{' '}
                      could fit if a built neighbour’s actual <Gloss k="setback">setback</Gloss> allows a contextual setback
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
            </>
          )}
          {ready && (
            <table className="city-counts">
              <caption className="label ws-caption">Lots by first blocker for a {tname}</caption>
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
          )}
        </>
      ),
    },
    {
      id: 'site',
      label: 'Site',
      panel: <NotAssessed>Site is never assessed: not for any lot. On a lot with block detail, the Site tab lists the free signals and what resolves each.</NotAssessed>,
    },
    {
      id: 'next',
      label: 'Next',
      panel: <CityNext cm={cm} s={s} update={update} openLot={openLot} runCount={runCount} />,
    },
    {
      id: 'sources',
      label: 'Sources',
      panel: <CitySources cm={cm} />,
    },
  ];
  return (
    <InspectorShell
      title={scope}
      status={
        ready ? (
          <span className="stamp stamp-ink ws-stamp" title={coverage ?? undefined}>
            CHECKED IN {k} DISTRICT{k === 1 ? '' : 'S'}
          </span>
        ) : null
      }
      sentence={sentence}
      tiles={tiles}
      tabs={tabs}
      active={s.tab}
      onTab={onTab}
    />
  );
}

/** The city's "What to do next": the featured lot, another district's rules, and Combine to fit. */
export function CityNext({ cm, s, update, openLot, runCount }: { cm: CityModel; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; openLot: (l: BlockLink) => void; runCount: number | null }) {
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const f = cm.featured;
  const rt = cm.reviewTarget;
  return (
    <div className="ws-first">
      <Label as="h3">What to do next</Label>
      <ul className="city-next">
        {f && f.link && (
          <li>
            <a
              href={`?view=lot&block=${f.link.block}&lot=${f.link.lot}&type=${s.type}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                openLot(f.link!);
              }}
            >
              <strong>{f.l.addr}</strong>: {f.c.all.includes('width') ? `see why a ${tname} gets ${f.c.width} ft` : f.c.blocker === 'fits' ? `see the ${f.c.width} ft a ${tname} gets as of right` : `see what blocks a ${tname}`}
            </a>
          </li>
        )}
        {rt && (
          <li>
            <a href={`?view=review&district=${rt[0]}`}>Check another district’s rules</a>
            <span className="small muted">
              {' '}
              · {zoneName(rt[0])} has {n(rt[1].grey)} grey {lotsWord(rt[1].grey)}; they take color when a teammate signs its rules.
            </span>
          </li>
        )}
        <li>
          <a
            href={`?view=city&type=${s.type}&layer=assemble${s.hood ? `&hood=${encodeURIComponent(s.hood)}` : ''}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              update({ view: 'city', layer: 'assemble', run: null, pin: null }, { push: true });
            }}
          >
            Combine to fit
          </a>
          <span className="small muted"> · which City lots fit when combined with the lots beside them{runCount != null ? ` (${n(runCount)} lot groups)` : ''}</span>
        </li>
      </ul>
    </div>
  );
}

function CitySources({ cm }: { cm: CityModel }) {
  const d = cm.data;
  const rows: SourceRow[] =
    d.state === 'ready'
      ? [
          ...(d.meta.sources ?? []).map((x) => ({ ...x })),
          ...(!(d.meta.sources ?? []).length ? [{ id: 'city_lots', name: `City-owned vacant lots: ${n(d.meta.count ?? cm.lots.length)} (${d.meta.source ?? 'citywide file'})`, pulled: d.meta.built ?? d.meta.pulled ?? null, note: d.meta.note ?? null }] : []),
        ]
      : [];
  const districts = [...new Set(RULES.map((r) => r.district))].sort();
  return (
    <>
      <RecordList rows={rows} title="Records · every City-owned vacant lot" />
      <p className="small">
        Rules loaded for {listAnd(districts.map(zoneName))}; a district takes color only when a person has signed its rules. <a href="?view=review&district=RM-M">Rules</a>
      </p>
      {d.state === 'ready' && (
        <p className="small muted">
          City-owned vacant lots: {n(d.meta.count ?? cm.lots.length)}
          {d.meta.built ? `, built ${dateFmt(d.meta.built)}` : d.meta.pulled ? `, pulled ${dateFmt(d.meta.pulled)}` : ''}
          {d.meta.source ? ` from ${d.meta.source}` : ''}. Edge labels come from the same engine as the lot view; classification runs in your browser from the current rule reviews.
        </p>
      )}
      <p className="small muted">{DISCLAIMER}</p>
    </>
  );
}

// ── One City lot without block detail ────────────────────────────────────────────────────────────
function cityLotSentence(lot: CityLotRow, c: CityClass, type: TemplateId, minArea: number | null): ReactNode {
  const req = TEMPLATES[type].proposal.width;
  const w = (
    <Ev trust={c.widthTrust} num>
      {c.width != null ? `${ftFmt(c.width)} ft` : '—'}
    </Ev>
  );
  switch (c.blocker) {
    case 'width':
      return (
        <>
          The rules leave only {w} to build on, and your plan for {aType(type)} is{' '}
          <Ev trust="red" num>
            {req} ft
          </Ev>{' '}
          wide.
        </>
      );
    case 'area':
      return (
        <>
          At{' '}
          <Ev trust={c.areaTrust} num>
            {n(c.area ?? 0)} sf
          </Ev>
          , the lot is smaller than the {minArea != null ? `${n(minArea)} sf ` : ''}minimum for {aType(type)}.
        </>
      );
    case 'depth':
      return (
        <>
          Too shallow for {aType(type)}: the rules leave{' '}
          <Ev trust={c.trust} num>
            {c.depth} ft
          </Ev>{' '}
          of depth.
        </>
      );
    case 'ownership':
      return (
        <>
          {aType(type).replace(/^a/, 'A').replace(/^r/, 'R')} fits ({w} to build on), but the City lists this lot as “{lot.status}”.
        </>
      );
    case 'fits':
      return (
        <>
          {aType(type).replace(/^a/, 'A').replace(/^r/, 'R')} fits: {w} to build on, and the City lists the lot for sale.
        </>
      );
    case 'records':
      return (
        <>
          The County says{' '}
          <Ev num>{n(Math.round(lot.assessed ?? 0))} sf</Ev>; the City map measures <Ev num>{n(Math.round(lot.mapped))} sf</Ev>. Until someone settles it, we can’t tell.
        </>
      );
    case 'edges':
      return <>We couldn’t tell this lot’s front from its sides, so it isn’t checked.</>;
    default:
      return <>The rules for this lot’s district aren’t checked yet, so we can’t tell.</>;
  }
}

export function CityLotInspector({ cm, i, s, update, onTab, runsFor }: { cm: CityModel; i: number; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; onTab: (t: InspectorTab) => void; runsFor: AssemblyRunRow[] }) {
  const lot = cm.lots[i];
  const c = cm.classes[i];
  const rs = lot.zone ? cm.ruleSets.get(lot.zone) ?? null : null;
  const link = BLOCK_OF.get(lot.pin) ?? null;
  const min = rs ? pick(rs, 'min_lot_area') : undefined;
  const minArea = typeof min?.value === 'number' ? min.value : null;
  const req = TEMPLATES[s.type].proposal.width;
  const grey = ['rules', 'records', 'edges'].includes(c.blocker);
  const openLot = (l: BlockLink) => update({ view: 'lot', block: l.block, lot: l.lot, lots: [], drawer: null, pin: null }, { push: true });
  // Evidence opened from this lot reads its district and block.
  const openEvidence = (ref: string) => update({ drawer: ref, district: lot.zone ?? null, ...(link ? { block: link.block } : {}) });
  const moneyWhy = 'checked on lots with block detail';
  const status =
    c.blocker === 'records' ? (
      <span className="stamp stamp-refuse ws-stamp">CAN’T SCORE</span>
    ) : c.blocker === 'rules' ? (
      <span className="stamp stamp-refuse ws-stamp is-grey">RULES NOT LOADED</span>
    ) : (
      <span className="ws-chip" data-blocker={c.blocker}>
        <span className={`bk bk-${c.blocker}`} aria-hidden="true" /> {LAYER_WORDS[c.blocker]}
      </span>
    );
  const tabs: TabDef[] = [
    { id: 'money', label: 'Money', panel: <NotAssessed>Money not assessed: it is {moneyWhy} ({Object.values(BLOCKS).map((b) => b.meta.name.replace(/-/g, '‑')).join(' and ')}). {link ? 'Open the lot to see it.' : ''}</NotAssessed> },
    {
      id: 'rules',
      label: 'Rules',
      panel: (
        <>
          <p className="small muted">
            {lot.hood}
            {lot.ward != null ? ` · Ward ${lot.ward}` : ''} · <Gloss k="district">{zoneName(lot.zone)}</Gloss>
            {link ? ` · lot ${link.lot}, ${link.blockName.replace(/-/g, '‑')}` : ''}
          </p>
          <LotFacts lot={lot} cls={c} type={s.type} rs={rs} link={link} />
        </>
      ),
    },
    {
      id: 'site',
      label: 'Site',
      panel: (
        <>
          <NotAssessed>Site not assessed: soil, environmental, water and sewer.</NotAssessed>
          <p className="small">
            Share of the lot at 25%+ slope (City slope layer): <Ev num>{Math.round(lot.slope25 * 100)}%</Ev>.
          </p>
        </>
      ),
    },
    {
      id: 'next',
      label: 'Next',
      panel: (
        <>
          <p className="ws-watch">
            <WatchToggle pin={lot.pin} />
          </p>
          <LotActions lot={lot} cls={c} type={s.type} rs={rs} link={link} openLot={openLot} />
          {runsFor.length > 0 && (
            <div className="ws-first">
              <Label as="h3">Combine to fit</Label>
              <ul className="ws-list small">
                {runsFor.map((r) => (
                  <li key={r.pins.join(',')}>
                    <button type="button" className="link" onClick={() => update({ layer: 'assemble', run: r.pins.join(','), pin: null }, { push: true })}>
                      {runLotsLabel(r.lots)}
                    </button>{' '}
                    <span className="muted">({runAddrs(r.lots)})</span>{' '}
                    <Ev trust={r.trust} num>
                      {r.width} ft
                    </Ev>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ),
    },
    {
      id: 'sources',
      label: 'Sources',
      panel: (
        <>
          <RecordList rows={[{ id: 'city_owned', name: `City-owned properties: “${lot.status}”${lot.status_updated ? `, updated ${dateFmt(lot.status_updated)}` : ''}`, pulled: cm.data.state === 'ready' ? cm.data.meta.pulled ?? null : null, url: null }]} title="Records" />
          <p className="small muted">
            Record: <a href={`api/lots/${lot.pin}.json`}>api/lots/{lot.pin}.json</a>
          </p>
          {rs && rs.rules.length > 0 && <RuleSources rs={rs} />}
        </>
      ),
    },
  ];
  return (
    <DrawerCtx.Provider value={openEvidence}>
      <InspectorShell
        before={
          <button type="button" className="ws-back" onClick={() => update({ pin: null }, { push: true })}>
            ← {s.hood ?? 'Pittsburgh'}
          </button>
        }
        title={lot.addr}
        status={
          <>
            {status} <span className="small muted">{lot.hood}</span>
          </>
        }
        sentence={cityLotSentence(lot, c, s.type, minArea)}
        defaultTab="rules"
        tiles={
          <>
            <Tile
              id="width"
              label="Buildable width"
              value={grey || c.width == null ? <Dash why={LAYER_WORDS[c.blocker]} /> : <Ev trust={c.widthTrust} num className="ws-num">{ftFmt(c.width)} ft</Ev>}
              sub={
                grey ? (
                  LAYER_WORDS[c.blocker].toLowerCase()
                ) : (
                  <>
                    your plan{' '}
                    <Ev trust="red" num>
                      {req} ft
                    </Ev>
                  </>
                )
              }
              title={c.formula ?? c.note}
            />
            <Tile id="cost" label="Build cost per home" value={<Dash why={moneyWhy} />} sub="not assessed" title={`Money is ${moneyWhy}.`} className="is-na" />
            <Tile id="sale" label="Newest new-build sale" value={<Dash why={moneyWhy} />} sub="not assessed" title={`Money is ${moneyWhy}.`} className="is-na" />
            <Tile id="left" label="Left after building" value={<Dash why={moneyWhy} />} sub="not assessed" title={`Money is ${moneyWhy}.`} className="is-na" />
          </>
        }
        tabs={tabs}
        active={s.tab}
        onTab={onTab}
      />
    </DrawerCtx.Provider>
  );
}

// ── A C15 run ─────────────────────────────────────────────────────────────────────────────────────
export function RunInspector({ run, meta, s, update, onTab }: { run: AssemblyRunRow; meta: AssemblyFile['meta'] | null; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; onTab: (t: InspectorTab) => void }) {
  const href = run.block && run.lots_param ? `?view=lot&block=${run.block}&lot=${run.lot_key}&type=${run.type}&lots=${run.lots_param}` : null;
  const why = href ? 'open the combined lot' : 'not checked for lot groups';
  const open = href ? (
    <a className="btn btn-ink btn-small" href={href}>
      Open the combined lot
    </a>
  ) : null;
  const type = run.type as TemplateId;
  const tabs: TabDef[] = [
    { id: 'money', label: 'Money', panel: <NotAssessed>Money not assessed for a lot group{href ? '; the combined lot has it.' : '.'} {open}</NotAssessed> },
    {
      id: 'rules',
      label: 'Rules',
      panel: (
        <>
          <p className="ws-engine-sentence">
            Combined, the width <Gloss k="asofright">as of right</Gloss> is{' '}
            <Ev trust={run.trust} num>
              {run.formula} ft
            </Ev>
            {run.trust_note ? <span className="pencil-text">: {run.trust_note}</span> : null}.
          </p>
          <p className="small">The City lot alone: {run.candidate_alone}.</p>
          <p className="small">Still to check: {run.still_to_check.join(', ')}.</p>
          <p className="small muted">Rules loaded for RM‑M only; other districts not assessed. Owner type only, never names. {RUN_ADDR_NOTE}</p>
        </>
      ),
    },
    { id: 'site', label: 'Site', panel: <NotAssessed>Site not assessed: soil, environmental, water and sewer.</NotAssessed> },
    {
      id: 'next',
      label: 'Next',
      panel: (
        <div className="ws-first">
          <Label as="h3">What to do next</Label>
          <ul className="ws-list small">
            {run.lots.map((l) => (
              <li key={l.pin}>
                {runLotsLabel([l])}
                {l.addr ? ` (${l.addr})` : ''}: {l.owner_type_words}
              </li>
            ))}
          </ul>
          <p className="small">Combining lots needs a lot consolidation and the owners’ agreement; this is not an offer, and it hasn’t been checked with the City.</p>
          {open}
        </div>
      ),
    },
    {
      id: 'sources',
      label: 'Sources',
      panel: (
        <>
          <RecordList rows={meta ? (meta as unknown as { sources?: SourceRow[] }).sources ?? [] : []} title="Records · the assembly finder" />
          {meta && 'note' in meta ? <p className="small muted">{String((meta as unknown as { note: string }).note)}</p> : null}
        </>
      ),
    },
  ];
  const nc = run.non_city;
  return (
    <InspectorShell
      before={
        <button type="button" className="ws-back" onClick={() => update({ run: null }, { push: true })}>
          ← All lot groups
        </button>
      }
      title={runLotsLabel(run.lots)}
      note={<p className="ws-run-addr small muted">{runAddrs(run.lots)}</p>}
      defaultTab="rules"
      status={<span className="stamp stamp-ink ws-stamp">COMBINE TO FIT</span>}
      sentence={
        <>
          Combined, these {run.lots.length} lots leave{' '}
          <Ev trust={run.trust} num>
            {run.width} ft
          </Ev>{' '}
          to build on, enough for {aType(type)}; {nc === 0 ? 'all are City-owned' : `${nc} ${nc === 1 ? 'is' : 'are'} not City-owned`}.
        </>
      }
      tiles={
        <>
          <Tile id="width" label="Buildable width" value={<Ev trust={run.trust} num className="ws-num">{run.width} ft</Ev>} sub={run.formula} />
          <Tile id="cost" label="Build cost per home" value={<Dash why={why} />} sub="not assessed" title={why} className="is-na" />
          <Tile id="sale" label="Newest new-build sale" value={<Dash why={why} />} sub="not assessed" title={why} className="is-na" />
          <Tile id="left" label="Left after building" value={<Dash why={why} />} sub="not assessed" title={why} className="is-na" />
        </>
      }
      tabs={tabs}
      active={s.tab}
      onTab={onTab}
    />
  );
}

// ── The "Combine to fit" list, nothing selected ─────────────────────────────────────────────────
export function AssembleInspector({ asm, cm, s, update, onTab }: { asm: AssemblyFile | null | 'loading'; cm: CityModel; s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; onTab: (t: InspectorTab) => void }) {
  const tname = TEMPLATES[s.type].name;
  const hoodByPin = new Map(cm.lots.map((l) => [l.pin, l.hood ?? null]));
  const runs = asm && asm !== 'loading' ? asm.runs.filter((r) => r.type === s.type && (!s.hood || r.lots.some((l) => hoodByPin.get(l.pin) === s.hood))) : [];
  const allCity = runs.filter((r) => r.non_city === 0).length;
  const pencil = runs.filter((r) => r.trust !== 'ink').length;
  // Runs overlap (judge round 2: "1311 · 1309 · 1305 Lincoln" and "1309 · 1305 Lincoln" are both runs),
  // so the sentence says so and counts the City-owned lots they touch once each.
  const { cityLots, shared } = runCounts(runs);
  const ready = asm && asm !== 'loading';
  const tabs: TabDef[] = [
    {
      id: 'next',
      label: 'Lot groups',
      panel: (
        <AssemblyPanel
          data={asm}
          type={s.type}
          typeName={tname}
          focus={s.hood}
          hoodOf={hoodByPin}
          selected={s.run}
          onSelect={(r) => {
            const lead = cm.lots[cm.idxOf.get(r.candidates[0]) ?? -1];
            update({ run: r.pins.join(','), ...(lead?.hood && lead.hood !== s.hood ? { hood: lead.hood } : {}) }, { push: true });
          }}
          onClose={() => update({ layer: null, run: null }, { push: true })}
        />
      ),
    },
    {
      id: 'sources',
      label: 'Sources',
      panel: ready ? <RecordList rows={((asm as AssemblyFile).meta as unknown as { sources?: SourceRow[] }).sources ?? []} title="Records · the assembly finder" /> : <p className="small muted">Loading…</p>,
    },
  ];
  return (
    <InspectorShell
      title={`Combine to fit${s.hood ? ` · ${s.hood}` : ''}`}
      status={<span className="stamp stamp-ink ws-stamp">GROUPS OF 2–3 LOTS</span>}
      note={ready ? <p className="ws-run-addr small muted">{RUN_ADDR_NOTE}</p> : null}
      sentence={
        ready ? (
          <>
            <Ev num>{n(runs.length)}</Ev> possible {runs.length === 1 ? 'lot group' : 'lot groups'} of 2–3 side-by-side lots{shared ? ' (some share lots)' : ''}, touching <Ev num>{n(cityLots)}</Ev> City-owned {cityLots === 1 ? 'lot' : 'lots'}, {runs.length === 1 ? 'fits' : 'fit'} {aType(s.type)} when combined; <Ev num>{n(allCity)}</Ev> {allCity === 1 ? 'is' : 'are'} all City-owned.
          </>
        ) : (
          <span className="muted">Loading the lots that fit when combined…</span>
        )
      }
      tiles={
        <>
          <Tile id="runs" label="Lot groups that fit" value={ready ? <Ev num>{n(runs.length)}</Ev> : <Dash why="loading" />} sub={`for ${aType(s.type)}`} />
          <Tile id="allcity" label="All City-owned" value={ready ? <Ev num>{n(allCity)}</Ev> : <Dash why="loading" />} sub="no other owner" />
          <Tile id="checked" label="City lots checked" value={ready ? <Ev num>{n((asm as AssemblyFile).meta.candidates)}</Ev> : <Dash why="loading" />} sub="in the checked district" />
          <Tile id="pencil" label="Open questions" value={ready ? <Ev trust="pencil" num>{n(pencil)}</Ev> : <Dash why="loading" />} sub="lot groups in pencil" />
        </>
      }
      tabs={tabs}
      active={s.tab === 'sources' ? 'sources' : 'next'}
      onTab={onTab}
    />
  );
}

// ── A block, no lot selected ────────────────────────────────────────────────────────────────────
export function BlockInspector({ block, bm, s, onTab }: { block: BlockFile; bm: BlockModel; s: UrlState; onTab: (t: InspectorTab) => void }) {
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const street = block.meta.main_street;
  const { scored, fits, short, refused, widths } = blockCounts(bm);
  const zoneWord = zoneName(bm.zone);
  const tabs: TabDef[] = [
    {
      id: 'rules',
      label: 'Rules',
      panel: (
        <>
          <p className="ws-engine-sentence">
            {scored.length ? (
              <>
                On {street}, a {tname} fits <Gloss k="asofright">as of right</Gloss> on <Ev num>{fits.length}</Ev> of {bm.plateRow.length} lots in <Gloss k="district">{zoneWord}</Gloss>
                {short.length ? (
                  <>
                    ; <Ev num>{short.length}</Ev> {short.length === 1 ? 'is' : 'are'} short of width
                    {widths.length === 1 ? (
                      <>
                        {' '}
                        (<Ev num>{ftFmt(widths[0])} ft</Ev> as of right)
                      </>
                    ) : null}
                  </>
                ) : null}
                {refused.length ? `; ${refused.length} can’t be scored` : ''}.
              </>
            ) : (
              <span className="pencil-text">
                No lot on {street} can be scored yet: {refused[0]?.result.refusal?.code === 'missing_rule' ? `the ${zoneWord} rules aren’t signed` : 'records disagree or rules are missing'}.
              </span>
            )}
          </p>
          <p className="small muted">
            {block.meta.neighborhood}
            {block.meta.ward != null ? ` · Ward ${block.meta.ward}` : ''}
            {block.meta.bounding_streets?.length ? ` · bounded by ${block.meta.bounding_streets.slice(0, -1).join(', ')} and ${block.meta.bounding_streets.slice(-1)[0]}` : ''} · {block.parcels.length} County parcels · pulled {dateFmt(block.meta.pulled)}
          </p>
          <Label as="h3">Why the lot count differs</Label>
          {block.meta.counts_note ? <p className="block-note small">{block.meta.counts_note}</p> : <p className="muted">No count note for this block.</p>}
        </>
      ),
    },
    {
      id: 'next',
      label: 'Next',
      panel: (
        <div className="ws-first">
          <Label as="h3">What to do next</Label>
          <p>Choose a lot on the plan or in the table to open it.</p>
          <p className="small">
            <a href={`?view=about&block=${block.meta.id}`}>About this block</a>: its zoning history, sources and what 24×100 doesn’t know.
          </p>
        </div>
      ),
    },
    { id: 'sources', label: 'Sources', panel: <RecordList rows={block.meta.sources} title={`Records · ${block.meta.name}`} /> },
  ];
  return (
    <InspectorShell
      title={`${block.meta.name.replace(/-/g, '‑')} · ${block.meta.neighborhood}`}
      status={<span className="stamp stamp-ink ws-stamp">EACH LOT ALONE</span>}
      sentence={
        scored.length ? (
          <>
            On {street}, {aType(s.type)} fits on <Ev num>{fits.length}</Ev> of {bm.plateRow.length} lots
            {short.length ? (
              <>
                ; <Ev num>{short.length}</Ev> {short.length === 1 ? 'is' : 'are'} too narrow
              </>
            ) : null}
            {refused.length ? `; ${refused.length} can’t be checked` : ''}.
          </>
        ) : (
          <>No lot on {street} can be checked yet.</>
        )
      }
      tiles={
        <>
          <Tile id="lots" label={`Lots on ${street.replace(/ Street$/, ' St')}`} value={<Ev num>{bm.plateRow.length}</Ev>} sub={`${block.parcels.length} parcels on the block`} />
          <Tile id="fits" label="Fit" value={<Ev num>{fits.length}</Ev>} sub={`${aType(s.type)}`} />
          <Tile id="narrow" label="Too narrow" value={<Ev num>{short.length}</Ev>} sub={widths.length === 1 ? `${ftFmt(widths[0])} ft each` : 'short of width'} />
          <Tile id="refused" label="Can’t check" value={<Ev num>{refused.length}</Ev>} sub="records or rules" />
        </>
      }
      tabs={tabs}
      active={s.tab}
      onTab={onTab}
    />
  );
}

