// The rules panel: the engine's ledger, the specific relief, the approvals it would need, and the
// unlock search. (The money panel is in Panels.tsx; it is checked first.)
import { useState } from 'react';
import { BOTH_SIDES_Q, needsUseVariance } from '@engine/evaluate';
import { APPROVAL_LABEL } from '@engine/templates';
import { varianceWords, type VarianceContext } from '@engine/verdict';
import type { BlockFile, Check, LotResult, RuleSet } from '@engine/types';
import type { UnlockOption } from '@engine/unlock';
import { Chip, Ev, ftFmt, Label, Mark, type MarkKind } from './ui';

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
      <Chip key={r!.id} refId={`rule:${r!.id}`} trust={r!.state === 'ink' ? 'ink' : 'pencil'} ruleId={r!.id} dataTrust={r!.state}>
        §{r!.section}
        {r!.state !== 'ink' ? ' · pencil' : ''}
      </Chip>
    ));
  const rec = c.record_ids[0];
  if (rec) {
    const [, pin, field] = rec.split(':');
    const name = { deed: 'deed', lotarea: 'assessment', poly: 'City map', city: 'City inventory', slope25: 'slope layer', undermined: 'undermined layer', built: 'footprints' }[field] ?? field;
    chips.push(
      <Chip key={rec} refId={`record:${pin}:${field}`} dataTrust="ink">
        {name}
      </Chip>,
    );
  }
  if (!c.rule_ids.length && ['use', 'parking', 'grading'].includes(c.id)) chips.push(<Chip key="nl" trust="pencil">rule not loaded</Chip>);
  return chips;
}

export function RulesWall({ result, rs, unlock, onTry, block, vctx }: { result: LotResult; rs: RuleSet; unlock: { options: UnlockOption[]; recommended: UnlockOption | null }; onTry: (o: UnlockOption) => void; block: BlockFile; vctx?: VarianceContext }) {
  const [showAll, setShowAll] = useState(false);
  if (result.state !== 'ok') {
    return (
      <section className="wall rules-wall" aria-labelledby="rules-wall-h">
        <header className="wall-head">
          <h2 id="rules-wall-h" className="wall-title">Rules <span className="wall-sub">checked second</span></h2>
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
  const sideRelief = result.relief.some((x) => x.check === 'width');
  const useCheck = result.checks.find((c) => c.id === 'use');
  const useNote = needsUseVariance(result) ? ` But ${useCheck?.text.replace(/\.$/, '') ?? 'the use isn’t permitted'}.` : '';
  const verdict = wc.status === 'open' && wc.alternative?.question_id === BOTH_SIDES_Q
    ? `Depends on an open question. With 3 ft side yards on both sides the widest is ${wc.available} ft; if §925.06.C.1 rules that out here, ${wc.alternative.available} ft (${wc.alternative.formula}, our reading), under your ${wc.required} ft proposal. Ask the Zoning Administrator.${useNote}${owners}`
    : wc.status === 'open'
    ? `Depends on an open question. If the narrow-lot rule doesn't cover attached houses: ${result.relief.map((r) => r.text).join('; ')}; a variance would be a possible route, not approval. If it does, the end units fit.${useNote}${owners}`
    : wc.trust === 'red'
      ? `Fits only under your assumption; the City hasn't confirmed it.${owners}`
      : result.relief.length
    ? `Doesn't fit as of right: ${result.relief.map((r) => r.text).join('; ')}. ${varianceWords(sideRelief, vctx, result.district)}${owners}`
    : result.checks.some((c) => c.status === 'fail')
      ? `Blocks it: see the failing lines.${owners}`
      : result.checks.find((c) => c.id === 'width')!.status === 'open'
        ? `Depends on an open question.${owners}`
        : `Fits the dimensional rules as of right.${useNote}${owners}`;
  return (
    <section className="wall rules-wall" aria-labelledby="rules-wall-h">
      <header className="wall-head">
        <h2 id="rules-wall-h" className="wall-title">Rules <span className="wall-sub">checked second</span></h2>
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
            <tr key={c.id} className={`row-${c.status}`} title={c.text} data-check={c.id} data-trust={c.trust}>
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
          <Label>Approvals this would need</Label>
          <p>
            {inkA.length ? inkA.map((a) => a.label).join(' → ') : 'None certain.'}
            {penA.length ? (
              <span className="pencil-text"> · open: {penA.map((a) => `${APPROVAL_LABEL[a.kind].toLowerCase()}?`).join(', ')}</span>
            ) : null}
          </p>
        </div>
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
