// The one-page lot brief (?view=brief&block=…&lot=…&type=…): what the lot page says, on one printed page, for someone
// who wasn't at the screen. The same engine reading and the same components: the verdict, the four numbers, the plan,
// why (the rules and their sections), what the agents found (when a case file exists), the route and who decides.
// Trust states print as on screen: ink, pencil, red (yours) and the violet estimate.
import { useEffect, useMemo } from 'react';
import { TEMPLATES } from '@engine/templates';
import { headline, nextStep } from '@engine/index';
import { fieldName } from '../components/Drawer';
import { Plate } from '../components/Plate';
import { DISCLAIMER, Label } from '../components/ui';
import { lotKey, mainRow, parcelByLot } from '../lib/model';
import { toSearch } from '../lib/url';
import { LotTiles, lotSteps } from '../components/workspace/LotInspector';
import { LotSentence, VerdictStamp } from '../components/workspace/plain';
import { Segs } from '../components/workspace/Segs';
import { CASES } from './CaseView';
import '../styles/brief.css';
import type { ViewProps } from './types';

const todayET = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', day: 'numeric', month: 'short', year: 'numeric' });

export function BriefView({ s, block, model, update }: ViewProps) {
  // Print on paper in the light theme, whatever the screen theme is (as the letters do).
  useEffect(() => {
    const root = document.documentElement;
    let prev: string | undefined;
    const before = () => {
      prev = root.dataset.theme;
      root.dataset.theme = 'light';
    };
    const after = () => {
      if (prev) root.dataset.theme = prev;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const sel = block ? parcelByLot(block, s.lot) : undefined;
  const frame = useMemo(() => (block && sel ? mainRow(block).filter((p) => p.zone === sel.zone) : []), [block, sel?.pin]);
  if (!block || !model || !sel) {
    return (
      <main className="empty" id="main">
        <p>That lot isn’t in the loaded blocks, so there is no brief to print.</p>
      </main>
    );
  }
  const r = model.result;
  const v = model.verdict;
  const lots = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!.lot ?? 0).sort((a, b) => a - b);
  const addr = sel.addr.replace(/\s*\(no number\)$/, '');
  const title = `${addr} · ${lots.length > 1 && r.state === 'ok' ? `lots ${lots[0]}–${lots[lots.length - 1]}` : `lot ${lotKey(sel)}`}`;
  const lotHref = toSearch({ ...s, view: 'lot', drawer: null });
  const link = `${window.location.origin}${window.location.pathname}${lotHref}`;
  const steps = lotSteps(model, block, s);
  const step = nextStep(model.unlock, block);
  const way = step.primary ?? step.fewest;
  const used = new Set(r.checks.flatMap((c) => c.rule_ids));
  const rules = model.ctx.rs.rules.filter((x) => used.has(x.id));
  const ink = rules.filter((x) => x.state === 'ink');
  const pencil = rules.filter((x) => x.state !== 'ink');
  const signers = [...new Set(ink.map((x) => x.verification.reviewer).filter((x): x is string => !!x))];
  const cf = r.pins.length === 1 ? CASES[sel.pin] : undefined;
  const found = cf?.findings.filter((f) => f.status === 'found') ?? [];
  const nothing = cf?.findings.filter((f) => f.status === 'nothing') ?? [];
  return (
    <main className="brief" id="main" data-brief={sel.pin}>
      <div className="brief-tools">
        <a href={lotHref}>← Back to the lot</a>
        <button type="button" className="btn btn-ink btn-small" onClick={() => window.print()}>
          Print this page
        </button>
        <span className="small muted">One page, Letter or A4. The trust colours print as on screen.</span>
      </div>
      <article className="brief-sheet">
        <header className="brief-head">
          <p className="brief-mark">
            <span className="brief-logo">24×100</span> · Lot brief · {todayET()} · records pulled {block.meta.pulled.slice(0, 10)}
          </p>
          <h1 className="brief-title">{title}</h1>
          <p className="brief-sub">
            {block.meta.neighborhood} · Block {block.meta.name.replace(/^Block\s*/i, '')} · zoned {r.district} · {sel.city ? `City-owned, ${sel.city.status.toLowerCase()}` : 'not City-owned'} ·{' '}
            {TEMPLATES[s.type].name.toLowerCase()}
          </p>
        </header>
        <section className="brief-verdict">
          <VerdictStamp headline={v.headline} refusal={r.refusal?.code} quote={!!model.money?.quote} />
          <p className="brief-sentence">
            <LotSentence r={r} m={model.money} block={block} detail={v.detail} />
          </p>
          {way && r.state === 'ok' ? (
            <p className="brief-way small">
              <span className="label">Way forward</span> {way.label}
              {way.result.width ? `: ${way.result.width.deed ?? way.result.width.mapped} ft` : ''}.
            </p>
          ) : null}
        </section>
        <div className="brief-tiles ws-tiles">
          <LotTiles model={model} />
        </div>
        <figure className="brief-plan">
          <Plate
            block={block}
            frameLots={frame}
            row={model.row.filter((x) => x.parcel.zone === sel.zone)}
            selected={r}
            onSelect={(p) => update({ lot: lotKey(p), lots: [] })}
            present={false}
            record={false}
            still
            slope={false}
            interactive={false}
            label={`Plate of ${block.meta.name}: every lot on ${block.meta.main_street} with its buildable envelope for a ${TEMPLATES[s.type].name.toLowerCase()}.`}
          />
        </figure>
        <div className="brief-cols">
          <section>
            <Label as="h2">Why</Label>
            <p className="brief-why">
              <Segs segs={headline(r, block, model.ctx.rs)} />
            </p>
            <p className="brief-rules" data-trust="ink">
              <span className="label">Signed rules</span>{' '}
              {ink.map((x) => `§${x.section} ${fieldName(x.field).toLowerCase()}${typeof x.value === 'number' ? ` ${x.value} ${x.unit}` : ''}`).join(' · ')}
              {signers.length ? ` (signed by ${signers.join(', ')})` : ''}.
            </p>
            {pencil.length ? (
              <p className="brief-rules pencil-text" data-trust="pencil">
                <span className="label">In pencil, not checked by a person</span> {pencil.map((x) => `§${x.section} ${fieldName(x.field).toLowerCase()}`).join(' · ')}.
              </p>
            ) : null}
          </section>
          <section>
            <Label as="h2">What to check next, cheapest first</Label>
            <ol className="brief-steps">
              {steps.map((x, i) => (
                <li key={i} className={x.trust === 'pencil' ? 'pencil-text' : ''}>
                  {x.tag ? <span className="step-tag">{x.tag}</span> : null} {x.head}
                </li>
              ))}
            </ol>
            {cf ? (
              <>
                <Label as="h2">What the agents found</Label>
                <ul className="brief-findings">
                  {found.map((f) => (
                    <li key={f.check}>{f.summary.replace(/^Found: /, '').split('; ')[0].replace(/\.?$/, '.')}</li>
                  ))}
                  {nothing.length ? <li className="muted">Nothing found: {nothing.map((f) => f.check).join(', ')}.</li> : null}
                </ul>
              </>
            ) : null}
          </section>
        </div>
        <footer className="brief-foot small">
          <p>
            <strong>Ink</strong> a public record or a rule a person signed · <span className="pencil-text">pencil</span> not checked by a person ·{' '}
            <span className="red-text">red</span> your plan or assumption · <span className="est">violet</span> a practitioner’s estimate. Not assessed: water and sewer, soils and fill, title and liens,
            community priorities. Parcel shapes come from GIS, not a survey.
          </p>
          <p>
            {DISCLAIMER} Every letter is a draft: you decide whether to send it.{cf ? ` Agents' findings from their case file of ${cf.run_at.slice(0, 10)}, each sourced and verified.` : ''} The lot,
            its letters and sources: <span className="brief-link">{link}</span>
          </p>
        </footer>
      </article>
    </main>
  );
}
