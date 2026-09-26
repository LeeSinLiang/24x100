// About this block: its zoning history, why the lot counts differ, where every record came from, and
// what 24×100 doesn't know. Read like the legend page of an atlas plate: typographic and calm.
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import type { BlockFile, EffectiveRule, SourceRef } from '@engine/types';
import { fieldName } from '../components/Drawer';
import { Chip, DISCLAIMER, Label, dateFmt } from '../components/ui';
import { BLOCKS } from '../lib/data';
import { contextFor, mainRow } from '../lib/model';
import type { ViewProps } from './types';
import '../styles/about.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5-7-2025" (the code's M-D-YYYY) → { year, words: "7 May 2025" }. */
function codeDate(s: string): { year: number; words: string } | null {
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return { year: +m[3], words: `${+m[2]} ${MONTHS[+m[1] - 1]} ${m[3]}` };
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { year: d.getUTCFullYear(), words: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

function nb(s: string): string {
  return s.replace(/-/g, '‑');
}

function mainZone(block: BlockFile): string | null {
  const c = new Map<string, number>();
  for (const p of mainRow(block)) c.set(p.zone ?? '—', (c.get(p.zone ?? '—') ?? 0) + 1);
  const z = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return z && z !== '—' ? z : null;
}

function SourceChip({ src, children }: { src: SourceRef | undefined; children: ReactNode }) {
  if (!src) return <span className="chip">{children}</span>;
  return (
    <a className="chip" href={src.url} rel="noreferrer" target="_blank" title={src.name}>
      {children}
    </a>
  );
}

interface Year {
  year: number;
  when: string;
  text: ReactNode;
  cite: ReactNode;
  now?: boolean;
}

function YearStrip({ block, rules, zone }: { block: BlockFile; rules: EffectiveRule[]; zone: string | null }) {
  const src = (id: string) => block.meta.sources.find((x) => x.id === id);
  const years: Year[] = [];
  for (const [y, z] of Object.entries(block.hist_zoning ?? {}).sort()) {
    const s = src(`hist_zoning_${y}`);
    years.push({
      year: +y,
      when: 'zoning map',
      text: <span className="yr-zone">{z}</span>,
      cite: <SourceChip src={s}>{`WPRDC historic zoning ${y}`}</SourceChip>,
    });
  }
  for (const r of rules) {
    if (!r.enacted) continue;
    const d = codeDate(r.enacted.effective);
    if (!d || typeof r.value !== 'number') continue;
    const v = r.unit === 'sf' ? `${r.value.toLocaleString('en-US')} sf` : `${r.value} ${r.unit}`;
    years.push({
      year: d.year,
      when: d.words,
      text: (
        <>
          {r.enacted.ordinance.replace(/^Ord\. No\. /, 'Ord. ').replace(/-/g, '‑')} sets the {nb(r.district)} {fieldName(r.field).toLowerCase()} at <strong>{v}</strong>
        </>
      ),
      cite: (
        <Chip refId={`rule:${r.id}`} trust={r.state === 'ink' ? 'ink' : 'pencil'}>
          §{r.section}
        </Chip>
      ),
    });
  }
  const zs = src('zoning');
  if (zone)
    years.push({
      year: new Date(block.meta.pulled).getUTCFullYear() || 2026,
      when: `pulled ${dateFmt(zs?.pulled ?? block.meta.pulled)}`,
      text: <span className="yr-zone">{nb(zone)}</span>,
      cite: <SourceChip src={zs}>City zoning</SourceChip>,
      now: true,
    });
  years.sort((a, b) => a.year - b.year);
  if (!years.length) return <p className="muted">No historic zoning recorded for this block.</p>;
  return (
    <ol className="yr-list">
      {years.map((y, i) => {
        const gap = i > 0 ? y.year - years[i - 1].year : 0;
        return (
          <li key={`${y.year}-${y.when}`} className={y.now ? 'is-now' : ''}>
            <span className="yr-rule" aria-hidden="true">
              <span className="yr-dot" />
              {gap >= 20 && <span className="yr-gap">{gap} years</span>}
            </span>
            <span className="yr-year">{y.now ? 'Today' : y.year}</span>
            <span className="yr-when small muted">{y.when}</span>
            <span className="yr-text">{y.text}</span>
            <span className="yr-cite">{y.cite}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Legend glyphs for the limits: each limit wears the mark the app uses for it. */
function Glyph({ kind }: { kind: 'seal' | 'disagree' | 'na' | 'ink' | 'slope' | 'rco' | 'none' | 'stamp' | 'pencil' }) {
  return <span className={`lim-glyph g-${kind}`} aria-hidden="true">{kind === 'seal' ? 'C' : kind === 'na' ? '—' : null}</span>;
}

export function AboutView({ s, block, audit }: ViewProps) {
  const b = block ?? Object.values(BLOCKS)[0];
  const zone = useMemo(() => (b ? mainZone(b) : null), [b]);
  const rs = useMemo(() => (b ? contextFor(b, zone, audit, s.tol).rs : null), [b, zone, audit, s.tol]);
  const rco = useMemo(() => {
    const o = b?.parcels.flatMap((p) => p.overlays ?? []).find((x) => x.startsWith('RCO'));
    return o ? o.replace(/^RCO\s*-\s*/, '') : null;
  }, [b]);
  const aiRules = rs ? rs.rules.filter((r) => r.ai_checked).length : 0;
  const proposals = rs ? rs.rules.filter((r) => r.state === 'pencil' && r.origin === 'extracted').length : 0;
  const signed = rs ? rs.rules.filter((r) => r.state === 'ink' && !r.ai_checked).length : 0;

  // ?section=limits (or any section id) opens the page at that section.
  const jump = () => {
    if (!s.section) return;
    const el = document.getElementById(s.section);
    if (el) el.scrollIntoView({ block: 'start' });
  };
  useLayoutEffect(jump, [s.section]);
  useEffect(() => {
    document.fonts?.ready.then(() => requestAnimationFrame(jump));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.section]);

  if (!b) {
    return (
      <main className="empty" id="main">
        <p>No block is loaded.</p>
      </main>
    );
  }
  const pulled = dateFmt(b.meta.pulled);

  return (
    <main className="about-view" id="main">
      <header className="about-head">
        <Label as="div">About this block</Label>
        <h1 className="about-title">
          {nb(b.meta.name)} <span className="about-hood">· {b.meta.neighborhood}</span>
        </h1>
        <p className="muted">
          {b.meta.ward != null ? `Ward ${b.meta.ward} · ` : ''}
          {b.meta.bounding_streets?.length ? `bounded by ${b.meta.bounding_streets.slice(0, -1).join(', ')} and ${b.meta.bounding_streets.slice(-1)[0]} · ` : ''}
          {b.parcels.length} County parcels · records pulled {pulled} ·{' '}
          <a href={`?view=block&block=${b.meta.id}`}>See the block</a> · <a href={`#limits`}>What 24×100 doesn’t know</a>
        </p>
      </header>

      <section className="about-sec" id="history" aria-labelledby="history-h">
        <h2 id="history-h" className="about-h">
          The block through its zoning maps
        </h2>
        <p className="small muted about-lede">The district at the block’s center on each historic zoning map, then the rule changes 24×100 knows about, then today.</p>
        <YearStrip block={b} rules={rs?.rules ?? []} zone={zone} />
      </section>

      <div className="about-two">
        <section className="about-sec" id="counts" aria-labelledby="counts-h">
          <h2 id="counts-h" className="about-h">
            Why the lot counts differ
          </h2>
          {b.meta.counts_note ? <p className="about-note">{b.meta.counts_note}</p> : <p className="muted">No count note for this block.</p>}
          <p className="small muted">The plat’s lot numbers are the 19th-century deed numbers, printed in italic on the plate; the County numbers its parcels separately. Neither is inferred when it is missing.</p>
        </section>

        <section className="about-sec" id="sources" aria-labelledby="sources-h">
          <h2 id="sources-h" className="about-h">
            Where the records come from
          </h2>
          <table className="about-sources">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Pulled</th>
                <th scope="col">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {b.meta.sources.map((x) => (
                <tr key={x.id}>
                  <td>{x.url ? <a href={x.url} rel="noreferrer" target="_blank">{x.name}</a> : x.name}</td>
                  <td className="nowrap">{dateFmt(x.pulled)}</td>
                  <td className="about-sha">{String((x as SourceRef & { sha256?: string }).sha256 ?? '').slice(0, 10) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="about-limits" id="limits" aria-labelledby="limits-h">
        <header className="lim-head">
          <h2 id="limits-h" className="lim-title">
            What 24×100 doesn’t know
          </h2>
          <p className="label">Read this before you rely on a number</p>
        </header>
        <ol className="lim-list">
          <li>
            <Glyph kind="seal" />
            <p>
              <strong>The City of Pittsburgh interprets its own code.</strong> 24×100 is decision support: it shows the rule it read and who checked it. For a ruling, ask the Zoning Administrator.
            </p>
          </li>
          <li>
            <Glyph kind="disagree" />
            <p>
              <strong>Parcel geometry comes from GIS, not surveys.</strong> Lot areas are checked against deeds and the County assessment; conflicts are shown, not settled.
            </p>
          </li>
          <li>
            <Glyph kind="na" />
            <p>
              <strong>Water and sewer capacity, soils, fill, title and liens are not assessed.</strong> They are never scored and never shown as zero.
            </p>
          </li>
          <li>
            <Glyph kind="ink" />
            <p>
              <strong>Building footprints come from a 2023 layer.</strong> Anything built or demolished since then is not reflected.
            </p>
          </li>
          <li>
            <Glyph kind="slope" />
            <p>
              <strong>The slope layer is a derived threshold, not the steep-slope overlay.</strong> It marks ground at 25% or more; whether grading review applies is the City’s call.
            </p>
          </li>
          <li>
            <Glyph kind="rco" />
            <p>
              <strong>Community priorities are not scored.</strong> 24×100 points to the Registered Community Organization{rco ? ` (${rco})` : ''}, which hosts the community meeting for a project.
            </p>
          </li>
          <li>
            <Glyph kind="none" />
            <p>
              <strong>No personal data is used.</strong> No owner names, mailing addresses or tax bills; owners appear only as the County’s owner category.
            </p>
          </li>
          <li>
            <Glyph kind="stamp" />
            <p>
              <strong>There is no score.</strong> Each lot gets a verdict in words (Can’t tell yet · Only with subsidy · Doesn’t fit as of right · Worth a closer look, if …) and three chips, Money · Rules · Site, checked in that order because that is the cheapest order to learn them.
            </p>
          </li>
          <li>
            <Glyph kind="pencil" />
            <p>
              <strong>The money screen is an estimate, and “money first” is an order, not a finding.</strong> Vertical construction cost is one practitioner’s estimate for City single-family infill ($200–$250 per sq ft, excluding site work), and it varies a lot with builder size; what’s left is the newest new-build sale in the ward minus that cost, and one sale is not an appraisal. Typical site work ($25,000–$50,000 for one home, another practitioner) is not a cap. Checking money first follows a practitioner’s advice about what to learn first; which barrier blocks more often is unproven (hypothesis H5).
            </p>
          </li>
          <li>
            <Glyph kind="pencil" />
            <p>
              <strong>Rules pre-seeded by an AI research pass need a teammate’s signature.</strong> They carry an “AI-checked · needs a teammate” tag until a person signs them.
              {rs && zone ? (
                <>
                  {' '}
                  In {nb(zone)} today, {aiRules} {aiRules === 1 ? 'rule waits' : 'rules wait'} for that signature and {signed ? `${signed} ${signed === 1 ? 'is' : 'are'} signed by a person` : 'none is signed by a person yet'}
                  {proposals ? `; ${proposals} extracted ${proposals === 1 ? 'proposal is' : 'proposals are'} still pencil` : ''}.
                </>
              ) : null}
            </p>
          </li>
        </ol>
        <p className="lim-disclaimer">{DISCLAIMER}</p>
      </section>

      <section className="about-sec about-legend" id="legend" aria-labelledby="legend-h">
        <h2 id="legend-h" className="about-h">
          How to read the marks
        </h2>
        <dl className="legend-grid">
          <div>
            <dt>
              <span className="ev ev-ink">4 ft</span>
            </dt>
            <dd>
              <strong>Ink</strong>: a sourced fact. A rule a named person matched to the quoted code, or a record with its pull date.
            </dd>
          </div>
          <div>
            <dt>
              <span className="ev ev-pencil legend-pencil">14 ft</span>
            </dt>
            <dd>
              <strong>Pencil</strong>: not known yet. An AI proposal, or a question the City hasn’t answered.
            </dd>
          </div>
          <div>
            <dt>
              <span className="ev ev-red legend-red">16 ft</span>
            </dt>
            <dd>
              <strong>Red</strong>: yours. Your proposal and your assumptions, labeled with who set them.
            </dd>
          </div>
          <div>
            <dt>
              <span className="ev ev-estimate">
                <span className="est-mark" aria-hidden="true" />
                $200
              </span>
            </dt>
            <dd>
              <strong>Practitioner estimate</strong>: a number a practitioner gave us, unconfirmed, with who supplied it. Not a checked fact and not your assumption.
            </dd>
          </div>
          <div>
            <dt>
              <span className="lim-glyph g-seal">C</span>
            </dt>
            <dd>
              <strong>City-confirmed</strong>: an interpretation the City confirmed, with its reference.
            </dd>
          </div>
          <div>
            <dt>
              <span className="ev ev-struck">10 ft</span>
            </dt>
            <dd>
              <strong>Struck</strong>: a rule a reviewer rejected. It stays visible.
            </dd>
          </div>
          <div>
            <dt>
              <span className="lim-glyph g-na">—</span>
            </dt>
            <dd>
              <strong>Not assessed</strong>: no data. Never shown as zero.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
