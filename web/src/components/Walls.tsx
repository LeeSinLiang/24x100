// The two walls: rules (the engine's ledger) and money (the reverse pro forma, hypothesis H5).
import { useState } from 'react';
import { APPROVAL_LABEL, TEMPLATES } from '@engine/templates';
import type { BlockFile, Check, LotResult, MoneyResult, RuleSet } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { COMPS, HUD } from '../lib/data';
import { Chip, Ev, ftFmt, Label, Mark, money, money1, type MarkKind } from './ui';

function markFor(c: Check): MarkKind {
  if (c.status === 'info') return c.trust === 'pencil' ? 'pencil' : 'info';
  if (c.trust === 'red') return 'red';
  if (c.status === 'open' || c.status === 'needs_survey' || c.trust === 'pencil') return 'pencil';
  if (c.status === 'fail') return 'fail';
  return 'ink';
}

function unitOf(c: Check): string {
  return c.unit === 'ft' ? ' ft' : c.unit === 'sf' ? ' sf' : c.unit === 'spaces' ? '' : '';
}

function fmtVal(c: Check, v: number | null): string {
  if (v == null) return '—';
  if (c.unit === 'sf') return `${Math.round(v).toLocaleString('en-US')} sf`;
  if (c.unit === 'share') return `${Math.round(v * 100)}%`;
  return `${ftFmt(v)}${unitOf(c)}`;
}

function sourceChips(c: Check, rs: RuleSet) {
  const chips = [...new Set(c.rule_ids)]
    .map((id) => rs.rules.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => (
      <Chip key={r!.id} refId={`rule:${r!.id}`} trust={r!.state === 'ink' ? 'ink' : 'pencil'}>
        §{r!.section}
        {r!.state !== 'ink' ? ' · pencil' : ''}
      </Chip>
    ));
  const rec = c.record_ids[0];
  if (rec) {
    const [, pin, field] = rec.split(':');
    const name = { deed: 'deed', lotarea: 'assessment', poly: 'City map', city: 'City inventory', slope25: 'slope layer', undermined: 'undermined layer', built: 'footprints' }[field] ?? field;
    chips.push(
      <Chip key={rec} refId={`record:${pin}:${field}`}>
        {name}
      </Chip>,
    );
  }
  if (!c.rule_ids.length && ['use', 'parking', 'grading'].includes(c.id)) chips.push(<Chip key="nl" trust="pencil">rule not loaded</Chip>);
  return chips;
}

export function RulesWall({ result, rs, unlock, onTry, block }: { result: LotResult; rs: RuleSet; unlock: { options: UnlockOption[]; recommended: UnlockOption | null }; onTry: (o: UnlockOption) => void; block: BlockFile }) {
  const [showAll, setShowAll] = useState(false);
  if (result.state !== 'ok') {
    return (
      <section className="wall rules-wall" aria-labelledby="rules-wall-h">
        <header className="wall-head">
          <h2 id="rules-wall-h" className="wall-title">The rules wall</h2>
        </header>
        <div className="refusal">
          <div className={`stamp stamp-refuse ${result.refusal?.code === 'missing_rule' ? 'is-grey' : ''}`} aria-hidden="true">
            {result.refusal?.code === 'missing_rule' ? 'RULES NOT LOADED' : 'CAN’T SCORE'}
          </div>
          <p>{result.refusal?.reason}</p>
          <p className="small">
            {result.refusal?.code === 'records_disagree'
              ? "24×100 refuses rather than guesses. Resolve the records (a survey, or the County's lot area) and the lot can be scored."
              : result.refusal?.code === 'missing_rule'
                ? 'No rules for this district have been loaded and reviewed, so nothing is computed. Grey is honest: it means we have not read the rules yet.'
                : '24×100 refuses rather than guesses.'}
          </p>
        </div>
      </section>
    );
  }
  const rows = result.checks.filter((c) => c.id !== 'contextual');
  const inkA = result.approvals.ink;
  const penA = result.approvals.pencil;
  const others = result.pins.map((pin) => block.parcels.find((p) => p.pin === pin)!).filter((p) => !p.city);
  const owners = others.length
    ? ` Needs ${others.map((p) => `lot ${p.lot}`).join(' and ')}: not in the City's inventory; County owner type ${others.map((p) => (p.assess?.ownercat ?? 'unknown').toLowerCase()).join(', ')}.`
    : '';
  const wc = result.checks.find((c) => c.id === 'width')!;
  const verdict = wc.status === 'open'
    ? `Depends on an open question. If the narrow-lot rule doesn't cover attached houses: ${result.relief.map((r) => r.text).join('; ')} (a variance). If it does, the end units fit.${owners}`
    : wc.trust === 'red'
      ? `Fits only under your assumption; the City hasn't confirmed it.${owners}`
      : result.relief.length
    ? `Blocks it: ${result.relief.map((r) => r.text).join('; ')}. That is a variance.${owners}`
    : result.checks.some((c) => c.status === 'fail')
      ? `Blocks it: see the failing lines.${owners}`
      : result.checks.find((c) => c.id === 'width')!.status === 'open'
        ? `Depends on an open question.${owners}`
        : `Fits the dimensional rules as of right.${owners}`;
  return (
    <section className="wall rules-wall" aria-labelledby="rules-wall-h">
      <header className="wall-head">
        <h2 id="rules-wall-h" className="wall-title">The rules wall</h2>
        <p className={`wall-verdict ${wc.status === 'open' ? 'is-pencil' : result.relief.length || wc.trust === 'red' ? 'is-red' : ''}`}>{verdict}</p>
      </header>
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col" className="visually-hidden">
              State
            </th>
            <th scope="col">Check</th>
            <th scope="col">Required</th>
            <th scope="col">Available</th>
            <th scope="col">Short</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`row-${c.status}`} title={c.text}>
              <td>
                <Mark kind={markFor(c)} label={`${c.status}, ${c.trust}`} />
              </td>
              <th scope="row">
                {c.label}
                {c.status === 'pass' && c.trust === 'ink' ? null : <div className={`row-text ${c.trust === 'pencil' ? 'is-pencil' : ''}`}>{c.text}</div>}
              </th>
              <td className="num">
                {c.id === 'width' || c.id === 'depth' || c.id === 'height' ? (
                  <Ev trust="red" refId="proposal:width" title="Your proposal (red): edit it">
                    {fmtVal(c, c.required)}
                  </Ev>
                ) : c.id === 'area' || c.id === 'parking' ? (
                  c.required != null ? <Ev trust={c.id === 'parking' || c.trust === 'pencil' ? 'pencil' : 'ink'}>{fmtVal(c, c.required)}</Ev> : ''
                ) : (
                  ''
                )}
              </td>
              <td className="num">
                {c.available != null && c.id !== 'grading' && c.id !== 'undermined' ? (
                  <Ev trust={c.trust === 'red' ? 'red' : c.status === 'open' || c.trust === 'pencil' ? 'pencil' : 'ink'} refId={c.id === 'width' ? 'measure:width' : c.id === 'depth' ? 'measure:depth' : undefined}>
                    {fmtVal(c, c.available)}
                  </Ev>
                ) : (
                  ''
                )}
              </td>
              <td className="num">{c.shortfall ? <span className="red">{fmtVal(c, c.shortfall)}</span> : ''}</td>
              <td className="chips">{sourceChips(c, rs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="approvals">
        <div>
          <Label>Approvals this implies</Label>
          <p>
            {inkA.length ? inkA.map((a) => a.label).join(' → ') : 'None certain.'}
            {penA.length ? (
              <span className="pencil-text"> · open: {penA.map((a) => `${APPROVAL_LABEL[a.kind].toLowerCase()}?`).join(', ')}</span>
            ) : null}
          </p>
        </div>
        {result.score && (
          <div className="score" title={result.score.formula}>
            <div className="stamp stamp-score" aria-label={`Score (heuristic) ${result.score.lo} to ${result.score.hi}`}>
              <span className="stamp-top">SCORE · HEURISTIC</span>
              <span className="stamp-num">{result.score.lo === result.score.hi ? result.score.hi : `${result.score.lo}–${result.score.hi}`}</span>
            </div>
            <p className="small muted">100 minus your red weights, once per distinct approval. Not a probability.</p>
          </div>
        )}
      </div>
      <details className="unlocks" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
        <summary>
          Ways forward within these levers ({unlock.options.length}) · smallest change first
        </summary>
        <table className="unlock-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Option</th>
              <th>Width</th>
              <th>Homes</th>
              <th>Discretionary approvals</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {unlock.options.map((o) => (
              <tr key={o.id} className={o === unlock.recommended ? 'is-rec' : ''}>
                <td>{o.rank}</td>
                <td>
                  {o.label}
                  {o.hypothetical && <div className="small pencil-text">{o.hypothetical}</div>}
                </td>
                <td className="num">{o.result.width ? `${ftFmt(o.result.width.deed ?? o.result.width.mapped)} ft` : '—'}</td>
                <td className="num">{o.homes}</td>
                <td className="num">
                  {o.discretionary}
                  {o.discretionary_possible > o.discretionary ? <span className="pencil-text"> (+{o.discretionary_possible - o.discretionary} open)</span> : ''}
                </td>
                <td>
                  {!o.hypothetical && !o.pending && (
                    <button className="btn btn-small" onClick={() => onTry(o)}>
                      Try it
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">Ranked by fewest certain discretionary approvals, then whether it fits, then ownership (City for sale, City held, another owner), then the size of the change. The smallest change within these five levers, not a global optimum.</p>
      </details>
    </section>
  );
}

export function MoneyWall({ result, m }: { result: LotResult; m: MoneyResult | null }) {
  if (!m || !COMPS || !HUD) {
    return (
      <section className="wall money-wall" aria-labelledby="money-wall-h">
        <header className="wall-head">
          <h2 id="money-wall-h" className="wall-title">The money wall</h2>
        </header>
        <p className="na">— not assessed: {result.state !== 'ok' ? 'the lot is not scored' : 'money data not loaded'}</p>
      </section>
    );
  }
  const max = Math.max(m.cost.hi, m.value.q3, m.affordable.price, m.value.newest ?? 0) * 1.06;
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  const be = m.break_even_psf;
  const [hLo, hHi] = [m.cost.lo, m.cost.hi];
  const blocks = hLo > m.value.median;
  return (
    <section className="wall money-wall" aria-labelledby="money-wall-h">
      <header className="wall-head">
        <h2 id="money-wall-h" className="wall-title">
          The money wall <span className="wall-sub">hypothesis H5 · not a finding</span>
        </h2>
        <p className="wall-verdict">
          To break even at Ward 5 prices, a builder would need to build for{' '}
          <Ev trust="red" refId="money:breakeven" num>
            ≤ {money1(be.value)}/sq ft
          </Ev>{' '}
          in hard costs.
          {blocks ? (
            <>
              {' '}
              At your assumed{' '}
              <Ev trust="red" refId="money:assumptions" num>
                ${m.cost.hard_psf[0]}–${m.cost.hard_psf[1]}/sq ft
              </Ev>
              , each home needs{' '}
              <Ev trust="red" refId="money:breakeven" num>
                {money(m.gap.lo)}–{money(m.gap.hi)}
              </Ev>{' '}
              of gap financing.
            </>
          ) : null}
        </p>
      </header>
      <div className="bars" role="img" aria-label={`Per home: cost ${money(hLo)} to ${money(hHi)}; homes sell for a median ${money(m.value.median)}; affordable at 80% AMI about ${money(m.affordable.price)}.`}>
        <div className="bar-row">
          <span className="bar-label red">Cost to build (your assumptions)</span>
          <div className="bar-track">
            <div className="bar bar-cost" style={{ left: x(hLo), width: `calc(${x(hHi)} - ${x(hLo)})` }} />
            <div className="bar-gap" style={{ left: x(m.value.median), width: `calc(${x(hLo)} - ${x(m.value.median)})` }} />
          </div>
          <span className="bar-val red">
            {money(hLo)}–{money(hHi)}
          </span>
        </div>
        <div className="bar-row">
          <span className="bar-label">
            Homes here sell for{' '}
            <Chip refId="money:comps">{m.value.count} sales</Chip>
          </span>
          <div className="bar-track">
            <div className="bar bar-iqr" style={{ left: x(m.value.q1), width: `calc(${x(m.value.q3)} - ${x(m.value.q1)})` }} />
            <div className="bar-tick" style={{ left: x(m.value.median) }} />
            {m.value.newest != null && <div className="bar-dot" style={{ left: x(m.value.newest) }} title="newest comparable" />}
          </div>
          <span className="bar-val">
            median {money(m.value.median)}
            {m.value.newest != null ? <span className="muted"> · newest {money(m.value.newest)}</span> : ''}
          </span>
        </div>
        <div className="bar-row">
          <span className="bar-label">
            Affordable at 80% AMI <Chip refId="money:hud">HUD</Chip>
          </span>
          <div className="bar-track">
            <div className="bar-mark red" style={{ left: x(m.affordable.price) }} />
          </div>
          <span className="bar-val red">≈ {money(m.affordable.price)}</span>
        </div>
        <div className="bar-axis">
          <div className="be-line" style={{ left: x(m.value.median) }}>
            <span>break-even</span>
          </div>
        </div>
      </div>
      <p className="small">
        Per home: {m.sqft.toLocaleString('en-US')} sf ({TEMPLATES[result.scenario.type].name.toLowerCase()}, red). Market value ≠ affordable price.{' '}
        {m.affordability_gap < 0 ? 'Here the median sale is already below what an 80% AMI household could pay, so the gap is cost, not affordability.' : ''}
      </p>
      <p className="small muted">Next: ask City Real Estate the lot price; ask the URA about gap financing. Programs are pointers, not promises of eligibility.</p>
    </section>
  );
}

