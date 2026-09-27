// Spec §0.12: Money → Rules → Site unknowns → Next steps, and a verdict in words instead of a score.
import type { BlockFile, Inquiry, LotResult, MoneyResult, SiteRow, Verdict } from '@engine/index';
import { Chip, Ev, money, money1 } from './ui';

const GLYPH = { blocks: '✕', open: '?', clear: '✓', unknown: '—' } as const;
const CHIP_NAME = { money: 'Money', rules: 'Rules', site: 'Site' } as const;

export function VerdictBlock({ v }: { v: Verdict }) {
  return (
    <div className={`verdict verdict-${v.headline}`} data-verdict={v.headline}>
      <p className="verdict-head">{v.words}</p>
      <ul className="verdict-chips" aria-label="Money, rules and site, checked in that order">
        {v.chips.map((c) => (
          <li key={c.id} className={`vchip vchip-${c.state} ev-class-${c.evidence}`} data-trust={c.evidence === 'ink' ? 'ink' : c.evidence}>
            <span className="vchip-glyph" aria-hidden="true">
              {GLYPH[c.state]}
            </span>
            <span className="vchip-name">{CHIP_NAME[c.id]}</span>
            <span className="vchip-words">{c.words}</span>
          </li>
        ))}
      </ul>
      <p className="verdict-detail small">{v.detail}</p>
    </div>
  );
}

export function EstimateMark() {
  return <span className="est-mark" role="img" aria-label="practitioner estimate" />;
}

const MONEY_STAMP = {
  only_with_subsidy: ['ONLY WITH SUBSIDY', 'screening estimate'],
  depends_on_builder: ['DEPENDS ON THE BUILDER', 'screening estimate'],
  worth_pricing_site: ['WORTH PRICING THE SITE', 'screening estimate'],
  no_new_build: null,
} as const;

function leftText(left: [number, number]): string {
  if (left[0] < 0) return 'Nothing left';
  if (left[0] === left[1]) return `${money1(left[0])} left`;
  if (left[1] < 0) return `${money1(left[0])} at best`;
  return `${money1(left[1])}–${money1(left[0])}`;
}

export function MoneyPanel({ result, m, gap }: { result: LotResult; m: MoneyResult | null; gap: string | null }) {
  if (!m || !m.new_build) {
    return (
      <section className="wall money-wall" aria-labelledby="money-h" data-panel="money">
        <header className="wall-head">
          <h2 id="money-h" className="wall-title">
            Money <span className="wall-sub">checked first · screening estimate</span>
          </h2>
        </header>
        <p className="na">— not assessed: {result.state !== 'ok' ? 'the lot is not scored' : m ? 'no recent new-build sale in this ward to compare with' : gap ?? 'no money data'}.</p>
      </section>
    );
  }
  const V = m.new_build.value;
  const A = m.estimates.find((e) => e.default) ?? m.estimates[0];
  const stamp = MONEY_STAMP[m.money_verdict];
  const max = Math.max(V, ...m.estimates.map((e) => e.vertical[1])) * 1.06;
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <section className="wall money-wall" aria-labelledby="money-h" data-panel="money">
      <header className="wall-head">
        <h2 id="money-h" className="wall-title">
          Money <span className="wall-sub">checked first · screening estimate</span>
        </h2>
        {stamp && (
          <span className="stamp stamp-subsidy" data-stamp={m.money_verdict}>
            {stamp[0]}
            <small>{stamp[1]}</small>
          </span>
        )}
      </header>

      {/* The money at a glance (spec §0.15, concept v2-1 density): one scale, then the key values with
          their sources. Prices are rows keyed by id, so a second price line can be added without a relayout. */}
      <div className="money-top">
        <div className="bars" role="img" aria-label={`Building cost per home at each estimate against a new-build sale of ${money(V)}.`}>
        {m.estimates.map((e) => (
          <div className="bar-row" key={e.id}>
            <span className="bar-label est">{e.id === 'prod' ? 'Production builder' : e.id === 'A' ? `$${e.psf[0]}–$${e.psf[1]}/sf` : `Estimate ${e.id}`}</span>
            <div className="bar-track">
              <div className="bar bar-vertical" style={{ left: x(e.vertical[0]), width: e.vertical[0] === e.vertical[1] ? '3px' : `calc(${x(e.vertical[1])} - ${x(e.vertical[0])})` }} />
              <div className="bar-sig sig-newbuild" style={{ left: x(V) }} title="the new-build sale" />
            </div>
          </div>
        ))}
        <div className="bar-axis">
          <div className="be-line" style={{ left: x(V) }}>
            <span>new-build sale {money1(V)}</span>
          </div>
        </div>
      </div>

        <table className="money-keys">
          <caption className="visually-hidden">Key values and their sources, per home</caption>
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Per home</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr data-price="newest">
              <th scope="row">Newest new-build sale</th>
              <td className="num">
                <Ev trust="ink" refId="money:comps" num>
                  {money(V)}
                </Ev>
              </td>
              <td className="money-src" title={m.new_build.note}>
                {m.new_build.label.replace(/^Newest new build: /, '')}
              </td>
            </tr>
            {A && (
              <tr className="est-row" data-estimate={A.id}>
                <th scope="row">
                  <EstimateMark /> Building
                </th>
                <td className="num est">{A.vertical[0] === A.vertical[1] ? money1(A.vertical[0]) : `${money1(A.vertical[0])}–${money1(A.vertical[1])}`}</td>
                <td className="money-src est">{A.supplied_by.replace(/ \(.*$/, '').replace(/, unconfirmed$/, '')}</td>
              </tr>
            )}
            <tr className="est-row">
              <th scope="row">
                <EstimateMark /> Site work
              </th>
              <td className="num est">
                <Ev trust="estimate" refId="money:sitework" num>
                  {money(m.site_work.lo)}–{money(m.site_work.hi)}
                </Ev>
              </td>
              <td className="money-src est">{m.site_work.supplied_by.replace(/ \(.*$/, '').replace(/, unconfirmed$/, '')} · not a cap</td>
            </tr>
            {A && (
              <tr className="est-row is-left">
                <th scope="row">Left after building</th>
                <td className={`num left ${A.left[0] < 0 ? 'is-none' : ''}`}>
                  <Ev trust="estimate" refId={`money:estimate:${A.id}`} num>
                    {A.left[0] === A.left[1] ? money1(A.left[0]) : `${money1(A.left[0])} to ${money1(A.left[1])}`}
                  </Ev>
                </td>
                <td className="money-src">{leftText(A.left)} · the sale − building</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The detail, one click deeper (spec §0.15): both estimates side by side, the context lines and
          your assumptions. The key values above carry the same numbers. */}
      <details className="money-more">
        <summary>Both estimates, context and your assumptions</summary>
      <p className="money-lead">Left for site work, soft costs and land, per home</p>
      <p className="small">
          A new home here sold for{' '}
          <Ev trust="ink" refId="money:comps" num>
            {money(V)}
          </Ev>{' '}
          ({m.new_build.label.replace(/^Newest new build: /, '')}; {m.new_build.note}). Building it costs, per home ({m.sqft.toLocaleString('en-US')} sq ft):
        </p>
      <table className="estimates">
        <thead>
          <tr>
            <th scope="col">Estimate (a practitioner at the hackathon)</th>
            <th scope="col">$/sq ft</th>
            <th scope="col">Building</th>
            <th scope="col">Left</th>
          </tr>
        </thead>
        <tbody>
          {m.estimates.map((e) => (
            <tr key={e.id} className={`est-row ${e.default ? 'is-default' : ''} ${e.speculative ? 'is-spec' : ''}`} data-estimate={e.id}>
              <th scope="row">
                <EstimateMark /> {e.label}
                <span className="est-note">
                  {e.note} Source: {e.supplied_by.replace(/, unconfirmed$/, '')}.
                </span>
              </th>
              <td className="num est">{e.psf[0] === e.psf[1] ? `~$${e.psf[0]}` : `$${e.psf[0]}–$${e.psf[1]}`}</td>
              <td className="num est">{e.vertical[0] === e.vertical[1] ? money1(e.vertical[0]) : `${money1(e.vertical[0])}–${money1(e.vertical[1])}`}</td>
              <td className={`num left ${e.left[0] < 0 ? 'is-none' : ''}`}>
                <Ev trust="estimate" refId={`money:estimate:${e.id}`} num>
                  {leftText(e.left)}
                </Ev>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        {m.estimates.some((e) => e.left[0] < 0) ? 'Nothing left means building alone costs more than the best new-build sale. ' : ''}
        One practitioner’s estimate for city single-family infill, and the same practitioner’s speculative production-builder case beside it (never averaged).
      </p>

      <p className="site-work-line">
        <EstimateMark /> <strong>Site work, single unit:</strong>{' '}
        <Ev trust="estimate" refId="money:sitework" num>
          {money(m.site_work.lo)}–{money(m.site_work.hi)}
        </Ev>{' '}
        typical (a practitioner). Not a cap: fill, soil or deep lines can cost far more.
      </p>
      <ul className="context-lines small">
        {m.context.map((c) => (
          <li key={c.id}>
            <Ev trust={c.evidence === 'red' ? 'red' : 'ink'} refId={c.id === 'affordable' ? 'money:hud' : 'money:comps'} num>
              {money(c.value)}
            </Ev>{' '}
            {c.label}: {c.note}.
          </li>
        ))}
      </ul>
      <p className="small">
        Costs vary a lot with builder size (a practitioner), so a builder’s price for this building is the decisive check; the range alone moves what’s left by {money1(m.swing)} per home. Leads: {m.source_leads.join(', ')} (not checked by us).
      </p>
      <p className="small red">
        With your assumptions: soft costs {Math.round(m.with_assumptions.soft * 100)}% and financing {Math.round(m.with_assumptions.financing * 100)}% bring construction to {money(m.with_assumptions.lo)}–{money(m.with_assumptions.hi)} per
        home, still without site work or land.{' '}
        <Chip refId="money:assumptions" trust="red">
          assumptions
        </Chip>
      </p>
      <p className="small muted">Money first is the cheapest check to make, per a practitioner, not a finding that money blocks more often (H5, unproven).</p>
      </details>
    </section>
  );
}

export function SitePanel({ rows }: { rows: SiteRow[] }) {
  const early = rows.filter((r) => r.deal_killer);
  const rest = rows.filter((r) => !r.deal_killer);
  const Row = ({ r }: { r: SiteRow }) => (
    <li className="site-row" data-site={r.id}>
      <span className="mark mark-na" role="img" aria-label="not assessed" />
      <div>
        <p className="site-label">{r.label}</p>
        <p className="small">{r.signals.join(' ')}</p>
        <p className="small">
          <strong>Resolves it:</strong> {r.resolves}. <span className="muted">Cost: {r.cost}.</span>
        </p>
      </div>
    </li>
  );
  return (
    <section className="wall site-wall" aria-labelledby="site-h" data-panel="site">
      <header className="wall-head">
        <h2 id="site-h" className="wall-title">
          Site <span className="wall-sub">not assessed · could change the decision</span>
        </h2>
      </header>
      <p className="label site-group">Can stop a deal early (a practitioner) · check these first, for free</p>
      <ul className="site-rows">
        {early.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
      <p className="label site-group">Then</p>
      <ul className="site-rows">
        {rest.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

export function NextSteps({ inquiry, href }: { inquiry: Inquiry | null; href: string }) {
  const next = inquiry?.sections.find((s) => s.id === 'next');
  return (
    <section className="wall next-wall" aria-labelledby="next-h" data-panel="next">
      <header className="wall-head">
        <h2 id="next-h" className="wall-title">
          What to check next <span className="wall-sub">in order · cheapest to learn first</span>
        </h2>
      </header>
      {next ? (
        <ol className="next-steps">
          {next.items.map((it, i) => {
            const [tag, ...rest] = it.text.split(': ');
            return (
              <li key={i}>
                <span className="step-tag">{tag}</span> {rest.join(': ')}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="na">— nothing to check until the lot can be scored.</p>
      )}
      <p>
        <a className="btn btn-ink" href={href}>
          Draft the letter
        </a>{' '}
        <span className="small muted">A draft: you decide whether and where to send it.</span>
      </p>
    </section>
  );
}

export type { BlockFile };
