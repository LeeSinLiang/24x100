// Spec §0.12: Money → Rules → Site unknowns → Next steps, and a verdict in words instead of a score.
import type { BlockFile, Inquiry, LotResult, MoneyResult, SiteRow, Verdict } from '@engine/index';
import { Chip, Ev, Label, money } from './ui';

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

export function MoneyPanel({ result, m, gap }: { result: LotResult; m: MoneyResult | null; gap: string | null }) {
  if (!m) {
    return (
      <section className="wall money-wall" aria-labelledby="money-h">
        <header className="wall-head">
          <h2 id="money-h" className="wall-title">
            Money <span className="wall-sub">checked first · screening estimate</span>
          </h2>
        </header>
        <p className="na">— not assessed: {result.state !== 'ok' ? 'the lot is not scored' : gap ?? 'no money data'}.</p>
      </section>
    );
  }
  const top = m.signals.find((s) => s.id === m.gap.signal)!;
  const max = Math.max(m.vertical.hi, ...m.signals.map((s) => s.value), m.comps.q3) * 1.05;
  const x = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <section className="wall money-wall" aria-labelledby="money-h" data-panel="money">
      <header className="wall-head">
        <h2 id="money-h" className="wall-title">
          Money <span className="wall-sub">checked first · screening estimate</span>
        </h2>
        <p className="money-lead">
          <EstimateMark /> Vertical construction alone:{' '}
          <Ev trust="estimate" refId="money:vertical" num>
            {money(m.vertical.lo)}–{money(m.vertical.hi)}
          </Ev>{' '}
          per home
        </p>
        <p className="small muted">
          ${m.vertical.psf[0]}–${m.vertical.psf[1]}/sq ft × {m.sqft.toLocaleString('en-US')} sq ft. A practitioner at the hackathon’s estimate: vertical construction only, excluding site work.
        </p>
      </header>

      <ol className="signals" aria-label="What homes here are worth: three signals, none an appraisal">
        {m.signals.map((s) => (
          <li key={s.id} className={`signal ev-class-${s.evidence}`}>
            <span className="signal-val">
              <Ev trust={s.evidence === 'red' ? 'red' : 'ink'} refId={s.id === 'affordable' ? 'money:hud' : 'money:comps'} num>
                {money(s.value)}
              </Ev>
            </span>
            <span className="signal-label">
              {s.label}
              <span className="signal-note">{s.note}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="bars" role="img" aria-label={`Per home: vertical construction ${money(m.vertical.lo)} to ${money(m.vertical.hi)}; value signals ${m.signals.map((s) => money(s.value)).join(', ')}.`}>
        <div className="bar-row">
          <span className="bar-label est">Vertical cost (estimate)</span>
          <div className="bar-track">
            <div className="bar-gap" style={{ left: x(top.value), width: `calc(${x(m.vertical.lo)} - ${x(top.value)})` }} />
            <div className="bar bar-vertical" style={{ left: x(m.vertical.lo), width: `calc(${x(m.vertical.hi)} - ${x(m.vertical.lo)})` }} />
          </div>
        </div>
        <div className="bar-row">
          <span className="bar-label">Value signals</span>
          <div className="bar-track">
            <div className="bar bar-iqr" style={{ left: x(m.comps.q1), width: `calc(${x(m.comps.q3)} - ${x(m.comps.q1)})` }} title="middle half of Ward sales" />
            {m.signals.map((s) => (
              <div key={s.id} className={`bar-sig sig-${s.id}`} style={{ left: x(s.value) }} title={s.label} />
            ))}
          </div>
        </div>
      </div>

      <div className="gap-line">
        {m.gap.positive && (
          <span className="stamp stamp-subsidy" data-stamp="subsidy">
            ONLY WITH SUBSIDY
            <small>screening estimate</small>
          </span>
        )}
        <Label>Gap, at least</Label>
        <p className="gap-num">
          <EstimateMark />{' '}
          <Ev trust="estimate" refId="money:gap" num>
            {m.gap.positive ? `${money(m.gap.lower_bound)} per home` : 'no gap at the low end'}
          </Ev>
        </p>
        <p className="small">
          Lower bound against the highest signal ({top.label}): excludes site work, soft costs, financing and land.
        </p>
      </div>

      <p className="small red">
        With your assumptions: soft costs {Math.round(m.with_assumptions.soft * 100)}% and financing {Math.round(m.with_assumptions.financing * 100)}% bring vertical construction to{' '}
        {money(m.with_assumptions.lo)}–{money(m.with_assumptions.hi)} per home, still without site work or land.
      </p>
      <p className="small muted">
        Not in these numbers: {m.not_in_number.join(', ')}. The lot price is unknown; ask City Real Estate. Money first is the cheapest check to make, not a finding that money blocks more often (hypothesis H5, unproven).{' '}
        <Chip refId="money:assumptions" trust="red">
          assumptions
        </Chip>
      </p>
    </section>
  );
}

export function SitePanel({ rows }: { rows: SiteRow[] }) {
  return (
    <section className="wall site-wall" aria-labelledby="site-h" data-panel="site">
      <header className="wall-head">
        <h2 id="site-h" className="wall-title">
          Site <span className="wall-sub">not assessed · could change the decision</span>
        </h2>
      </header>
      <ul className="site-rows">
        {rows.map((r) => (
          <li key={r.id} className="site-row">
            <span className="mark mark-na" role="img" aria-label="not assessed" />
            <div>
              <p className="site-label">{r.label}</p>
              <p className="small">{r.signals.join(' ')}</p>
              <p className="small">
                <strong>Resolves it:</strong> {r.resolves}. <span className="muted">Cost: {r.cost}.</span>
              </p>
            </div>
          </li>
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
