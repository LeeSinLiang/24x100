// The workspace (spec §0.15): one screen, linked panels, the answer in five seconds and every detail
// one or two clicks deep. Left rail (layers and filters, or the plan's key), centre canvas (Map · Plan ·
// Graph · Table), right inspector (header, four tiles, tabs) and a bottom tray. The selection comes
// from the URL: a lot with block detail, a City lot, a C15 run, a block, or nothing (the city).
import { useMemo } from 'react';
import { cityRoutes } from '@engine/city';
import { TEMPLATES } from '@engine/templates';
import type { Parcel } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { useAssemblies, type AssemblyRunRow } from '../components/city/Assemblies';
import { BlockPlanCanvas, BlockTables, CityTable, LotListTable, MapCanvas, MapInsetPlan, MapInsetRun, NoPlan, PlanCanvas, RunsTable } from '../components/workspace/Canvas';
import type { UrlState } from '../lib/url';
import { AssembleInspector, BlockInspector, CityInspector, CityLotInspector, RunInspector } from '../components/workspace/CityInspector';
import { GraphCanvasBody, GraphInspector, GraphRailFilters, useLotGraph } from '../components/workspace/GraphView';
import { inquiryHref, LotInspector, lotSteps } from '../components/workspace/LotInspector';
import { MapInsetOutline } from '../components/workspace/OutlineInset';
import { aType } from '../components/workspace/plain';
import { Rail } from '../components/workspace/Rail';
import { pullEvents, refreshEvent, ruleEvents, Tray, type Step, type TimelineEvent } from '../components/workspace/Tray';
import { BLOCKS, COMPS_BY_WARD, HUD } from '../lib/data';
import { useBlockModel } from '../lib/block';
import { BLOCK_OF, useCityModel } from '../lib/city';
import { lotKey } from '../lib/model';
import { optionPatch } from '../lib/scenario';
import type { Canvas, InspectorTab } from '../lib/url';
import type { ViewProps } from './types';
import '../styles/city.css';
import '../styles/block.css';

type Kind = 'lot' | 'block' | 'city' | 'citylot' | 'run' | 'assemble' | 'missing';

export function defaultCanvas(view: ViewProps['s']['view']): Canvas {
  return view === 'city' ? 'map' : 'plan';
}

export function WorkspaceView({ s, update, block, model, audit }: ViewProps) {
  const canvas: Canvas = s.canvas ?? defaultCanvas(s.view);
  const kind: Kind =
    s.view === 'lot' ? (block && model ? 'lot' : 'missing') : s.view === 'block' ? (block ? 'block' : 'missing') : s.layer === 'assemble' && s.run ? 'run' : s.pin ? 'citylot' : s.layer === 'assemble' ? 'assemble' : 'city';
  const needCity = s.view === 'city' || canvas === 'map';
  const cm = useCityModel(needCity, s.type, audit, s.tol, { hood: s.hood, sale: s.sale, ward: s.ward, zone: s.zone });
  const asm = useAssemblies(needCity);
  const bm = useBlockModel(kind === 'block' ? block : undefined, s.type, audit, s.tol);

  const hoodByPin = useMemo(() => new Map(cm.lots.map((l) => [l.pin, l.hood ?? null])), [cm.lots]);
  const runsOfType = useMemo(() => (asm && asm !== 'loading' ? asm.runs.filter((r) => r.type === s.type && (!s.hood || r.lots.some((l) => hoodByPin.get(l.pin) === s.hood))) : null), [asm, s.type, s.hood, hoodByPin]);
  const run: AssemblyRunRow | null = kind === 'run' && asm && asm !== 'loading' ? asm.runs.find((r) => r.pins.join(',') === s.run) ?? null : null;
  const pinIdx = kind === 'citylot' && s.pin ? cm.idxOf.get(s.pin) ?? null : null;
  const filtered = !!(s.hood || s.sale || s.ward != null || s.zone);

  // The graph (spec §0.15 P1) for a lot or combined group with block detail.
  const graph = useLotGraph(canvas === 'graph' && kind === 'lot' ? model : null, block);

  // ── Selection handlers ───────────────────────────────────────────────────────────────────────
  const onTab = (t: InspectorTab) => update({ tab: t });
  // A step of the route: the tray lists them, the Next tab shows the chosen one in detail (team review, round 3).
  const onStep = (i: number) => update({ step: i + 1, tab: 'next' });
  const selectCityIndex = (i: number | null) => {
    if (i == null) {
      if (s.view === 'city' && s.pin) update({ pin: null }, { push: true });
      return;
    }
    const lot = cm.lots[i];
    const link = BLOCK_OF.get(lot.pin);
    if (link) update({ view: 'lot', block: link.block, lot: link.lot, lots: [], pin: null, run: null, drawer: null }, { push: true });
    else update({ view: 'city', pin: lot.pin, run: null, drawer: null }, { push: true });
  };
  const selectRun = (r: AssemblyRunRow) => {
    const lead = cm.lots[cm.idxOf.get(r.candidates[0]) ?? -1];
    update({ view: 'city', layer: 'assemble', run: r.pins.join(','), pin: null, ...(lead?.hood && lead.hood !== s.hood ? { hood: lead.hood } : {}) }, { push: true });
  };
  const onSelectLot = (p: Parcel) => {
    if (!block) return;
    update({ view: 'lot', lot: lotKey(p), lots: [], type: TEMPLATES[s.type].multi_lot ? 'two' : s.type, drawer: null }, { push: true });
  };
  const onTry = (o: UnlockOption) => block && update(optionPatch(o, block, s.lot), { push: true });
  const openBlockLot = (p: Parcel) => update({ view: 'lot', lot: lotKey(p), lots: [], drawer: null }, { push: true });

  // ── Canvas ───────────────────────────────────────────────────────────────────────────────────
  const asmPins = s.layer === 'assemble' && runsOfType ? runsOfType.flatMap((r) => r.pins) : [];
  const selectedPins = kind === 'lot' ? model!.result.pins : kind === 'citylot' && s.pin ? [s.pin] : [];
  const runPins = kind === 'run' && s.run ? s.run.split(',') : [];
  let canvasEl;
  if (canvas === 'graph') canvasEl = <GraphCanvasBody graph={graph} s={s} update={update} />;
  else if (canvas === 'map') {
    // P2: the selection's plan (or a run's card) in an inset joined to its dot; double-click opens the Plan view.
    // A City lot without block detail gets its outline (team review, round 3: an inset for every lot).
    const inset =
      kind === 'lot' && block && model ? (
        <MapInsetPlan block={block} model={model} s={s} />
      ) : kind === 'run' && run ? (
        <MapInsetRun run={run} />
      ) : kind === 'citylot' && pinIdx != null ? (
        <MapInsetOutline lot={cm.lots[pinIdx]} cls={cm.classes[pinIdx]} rs={cm.lots[pinIdx].zone ? cm.ruleSets.get(cm.lots[pinIdx].zone!) ?? null : null} type={s.type} />
      ) : null;
    const onInsetOpen =
      kind === 'lot'
        ? () => update({ canvas: 'plan' }, { push: true })
        : kind === 'run' && run?.block && run.lots_param && run.lot_key
          ? () => update({ view: 'lot', block: run.block!, lot: run.lot_key!, lots: run.lots_param!.split(','), type: run.type as UrlState['type'], canvas: 'plan', layer: null, run: null }, { push: true })
          : undefined;
    canvasEl = <MapCanvas cm={cm} s={s} selectedPins={selectedPins} runPins={runPins} asmPins={asmPins} onSelect={selectCityIndex} onZoom={(h) => update({ hood: h }, { push: true })} inset={inset} onInsetOpen={onInsetOpen} hood={kind === 'lot' && block ? block.meta.neighborhood : null} />;
  }
  else if (canvas === 'plan')
    canvasEl =
      kind === 'lot' ? (
        <PlanCanvas block={block!} model={model!} s={s} onSelectLot={onSelectLot} />
      ) : kind === 'block' && bm ? (
        <BlockPlanCanvas block={block!} bm={bm} s={s} onOpen={openBlockLot} />
      ) : (
        <NoPlan>
          {run?.block && run.lots_param ? (
            <p>
              <a className="btn btn-ink btn-small" href={`?view=lot&block=${run.block}&lot=${run.lot_key}&type=${run.type}&lots=${run.lots_param}`}>
                Open the combined lot
              </a>
            </p>
          ) : null}
        </NoPlan>
      );
  else
    canvasEl =
      kind === 'lot' ? (
        <LotListTable block={block!} model={model!} s={s} onSelectLot={onSelectLot} />
      ) : kind === 'block' && bm ? (
        <BlockTables block={block!} bm={bm} s={s} onOpen={openBlockLot} />
      ) : s.layer === 'assemble' ? (
        <RunsTable asm={asm} cm={cm} s={s} onSelect={selectRun} />
      ) : (
        <CityTable cm={cm} s={s} selected={pinIdx} onSelect={(i) => selectCityIndex(i)} />
      );

  // ── Inspector ────────────────────────────────────────────────────────────────────────────────
  let inspector;
  if (canvas === 'graph' && graph && s.node && graph.nodes.some((n) => n.id === s.node)) inspector = <GraphInspector graph={graph} s={s} update={update} />;
  else if (kind === 'lot') inspector = <LotInspector model={model!} block={block!} s={s} onTab={onTab} onTry={onTry} onStep={onStep} />;
  else if (kind === 'block' && bm) inspector = <BlockInspector block={block!} bm={bm} s={s} onTab={onTab} />;
  else if (kind === 'citylot' && pinIdx != null)
    inspector = <CityLotInspector cm={cm} i={pinIdx} s={s} update={update} onTab={onTab} runsFor={asm && asm !== 'loading' ? asm.runs.filter((r) => r.type === s.type && r.pins.includes(s.pin!)) : []} />;
  else if (kind === 'run' && run) inspector = <RunInspector run={run} meta={asm && asm !== 'loading' ? asm.meta : null} s={s} update={update} onTab={onTab} />;
  else if (kind === 'assemble' || (kind === 'run' && asm !== 'loading' && !run)) inspector = <AssembleInspector asm={asm} cm={cm} s={s} update={update} onTab={onTab} />;
  else if (kind === 'city' || ((kind === 'citylot' || kind === 'run') && cm.data.state !== 'ready'))
    inspector = <CityInspector cm={cm} s={s} update={update} onTab={onTab} runCount={runsOfType?.length ?? null} filtered={filtered} />;
  else if (kind === 'citylot')
    inspector = (
      <aside className="ws-inspector ws-missing">
        <p>
          That lot isn’t among the {cm.lots.length.toLocaleString('en-US')} City-owned vacant lots on the map. <button className="link" onClick={() => update({ pin: null }, { push: true })}>Back to the city</button>
        </p>
      </aside>
    );
  else
    inspector = (
      <aside className="ws-inspector ws-missing">
        <p>
          That {s.view === 'block' ? 'block' : 'lot'} isn’t in the loaded blocks. Lot detail covers {Object.values(BLOCKS).map((b) => b.meta.name).join(' and ')}. <a href="?view=city">See every City-owned lot on the city map</a>.
        </p>
      </aside>
    );

  // ── Tray ─────────────────────────────────────────────────────────────────────────────────────
  let steps: Step[] = [];
  let stepsNote = null;
  let events: TimelineEvent[] = [];
  let pins: string[] = [];
  const cityEvents = (): TimelineEvent[] => {
    const d = cm.data;
    const ev: TimelineEvent[] = [];
    if (d.state === 'ready' && (d.meta.built || d.meta.pulled)) ev.push({ at: d.meta.built ?? d.meta.pulled!, label: `${cm.lots.length.toLocaleString('en-US')} City-owned vacant lots`, detail: d.meta.source ?? 'citywide file', kind: 'pull' });
    if (asm && asm !== 'loading') ev.push(...pullEvents(asm.meta.sources ?? [], 'Combine to fit'));
    ev.push(...ruleEvents([...cm.ruleSets.values()].filter((r) => r.rules.length), audit));
    return ev;
  };
  if (kind === 'lot') {
    const r = model!.result;
    const letters = model!.inquiry.letters;
    const href = (office: string) => inquiryHref(block!, s, s.lot, office);
    if (r.state === 'ok') steps = lotSteps(model!, block!, s);
    else
      stepsNote = (
        <p className="ws-tray-note">
          {r.refusal?.code === 'records_disagree' ? 'Ask the County or a surveyor to settle the lot area; then it can be scored.' : r.refusal?.code === 'missing_rule' ? `Load and check the ${r.district} rules first.` : r.refusal?.reason}{' '}
          {letters.map((l) => (
            <a key={l.office} className="ws-step-link" href={href(l.office)}>
              Letter to {l.tab}
            </a>
          ))}
        </p>
      );
    const comps = block!.meta.ward != null ? COMPS_BY_WARD[block!.meta.ward] : undefined;
    events = [
      ...pullEvents(block!.meta.sources, block!.meta.name.replace(/-/g, '‑')),
      ...(comps ? [{ at: comps.meta.pulled, label: `County sales, Ward ${comps.meta.ward} pulled`, detail: comps.meta.source, kind: 'pull' as const }] : []),
      ...(HUD?.pulled ? [{ at: HUD.pulled, label: 'HUD income limits pulled', detail: HUD.area_name, kind: 'pull' as const }] : []),
      ...ruleEvents([model!.ctx.rs], audit),
      ...refreshEvent(),
    ];
    pins = r.pins;
  } else if (kind === 'block' && bm) {
    stepsNote = <p className="ws-tray-note">Choose a lot on the plan or in the table to see its route: free checks first, paid ones last.</p>;
    events = [...pullEvents(block!.meta.sources, block!.meta.name.replace(/-/g, '‑')), ...refreshEvent()];
    pins = block!.parcels.map((p) => p.pin);
  } else if (kind === 'citylot' && pinIdx != null) {
    const lot = cm.lots[pinIdx];
    const c = cm.classes[pinIdx];
    const link = BLOCK_OF.get(lot.pin);
    const rs = lot.zone ? cm.ruleSets.get(lot.zone) ?? null : null;
    steps = link
      ? [{ tag: null, head: 'Open the lot', text: 'This lot has block detail: its plate, money and letters are in the lot view.', links: [{ href: `?view=lot&block=${link.block}&lot=${link.lot}&type=${s.type}`, label: 'Open lot' }] }]
      : cityRoutes(lot, c, rs, s.type).map((rt) => ({ tag: null, head: rt.text.split(/[:;.](\s|$)/)[0], text: rt.text, trust: rt.trust === 'ink' ? 'ink' : rt.trust === 'red' ? 'red' : 'pencil', links: [] }));
    if (!steps.length) stepsNote = <p className="ws-tray-note">Nothing to check from the city map; lot detail isn’t generated for this block yet.</p>;
    events = [...cityEvents(), ...refreshEvent()];
    pins = [lot.pin];
  } else if (kind === 'run' && run) {
    steps = run.still_to_check.map((x) => ({ tag: null, head: `Check ${x}`, text: `Still to check for this run: ${x}.`, trust: 'pencil' as const, links: [] }));
    if (run.block && run.lots_param) steps.push({ tag: null, head: 'Open the combined lot', text: 'Money, site and letters for the combined lot.', links: [{ href: `?view=lot&block=${run.block}&lot=${run.lot_key}&type=${run.type}&lots=${run.lots_param}`, label: 'Open' }] });
    events = [...cityEvents(), ...refreshEvent()];
    pins = run.pins;
  } else if (kind === 'assemble') {
    stepsNote = <p className="ws-tray-note">Pick a lot group in the list, or a ringed dot on the map: each lists what is still to check.</p>;
    events = [...cityEvents(), ...refreshEvent()];
  } else {
    const f = cm.featured;
    const rt = cm.reviewTarget;
    const tname = TEMPLATES[s.type].name.toLowerCase();
    if (f?.link)
      steps.push({
        tag: null,
        head: `${f.l.addr}: ${f.c.all.includes('width') ? `see why a ${tname} gets ${f.c.width}\u00a0ft` : f.c.blocker === 'fits' ? `see the ${f.c.width}\u00a0ft a ${tname} gets as of right` : `see what blocks a ${tname}`}`,
        text: f.c.all.includes('width') && !f.c.all.includes('area') ? 'A City lot listed for sale, with block detail, that is big enough but too narrow.' : 'A City lot listed for sale, with block detail.',
        links: [{ href: `?view=lot&block=${f.link.block}&lot=${f.link.lot}&type=${s.type}`, label: 'Open lot' }],
      });
    if (rt) steps.push({ tag: null, head: 'Check another district’s rules', text: `${rt[0]} has ${rt[1].grey.toLocaleString('en-US')} grey lots; they take color when a teammate signs its rules.`, links: [{ href: `?view=review&district=${rt[0]}`, label: `Review ${rt[0]}` }] });
    steps.push({
      tag: null,
      head: 'Combine to fit',
      text: 'Which City lots fit when combined with the lots beside them.',
      links: [],
      action: (
        <button type="button" className="ws-step-link link" onClick={() => update({ layer: 'assemble', run: null, pin: null }, { push: true })}>
          Show the lot groups{runsOfType ? ` (${runsOfType.length})` : ''}
        </button>
      ),
    });
    events = [...cityEvents(), ...refreshEvent()];
  }

  return (
    <main className={`ws ws-kind-${kind} ws-canvas-${canvas}`} id="main" data-canvas={canvas} data-selection={kind}>
      <Rail canvas={canvas === 'table' && s.view !== 'city' ? 'plan' : canvas} s={s} update={update} cm={needCity ? cm : null} runCount={runsOfType?.length ?? null} planType={aType(s.type)} graphFilters={<GraphRailFilters graph={graph} s={s} update={update} />} />
      <section className="ws-canvas" aria-label={`Canvas: ${canvas}`}>
        {canvasEl}
      </section>
      {inspector}
      <Tray
        s={s}
        update={update}
        steps={steps}
        stepsNote={stepsNote}
        events={events}
        pins={pins}
        disclaimer
        {...(kind === 'lot' && steps.length ? { onStep, selected: s.tab === 'next' ? Math.min(s.step ?? 1, steps.length) - 1 : null } : {})}
      />
    </main>
  );
}
