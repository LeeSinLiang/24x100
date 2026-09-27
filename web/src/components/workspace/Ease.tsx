// Development Ease (engine/src/ease.ts): a range out of 100 on a bar, never a lone number, and the six parts it's made
// of, each clear, blocks or unknown, with where it comes from or who to ask. The weights are ours and shown as such.
import type { Ease, EasePart } from '@engine/ease';
import { EASE_WEIGHTS } from '@engine/ease';
import { DEFAULT_SETTINGS } from '@engine/templates';
import '../../styles/ease.css';

export function EaseBar({ ease, onOpen, compact }: { ease: Ease; onOpen?: () => void; compact?: boolean }) {
  const body = ease.scored ? (
    <>
      <span className="ease-label">Ease</span>
      <span className="ease-track" aria-hidden="true">
        <span className="ease-fill" style={{ left: `${ease.lo}%`, width: `${Math.max(1.5, ease.hi - ease.lo)}%` }} />
      </span>
      <span className="ease-num">
        {ease.lo}–{ease.hi}
        <span className="ease-of"> / 100</span>
      </span>
    </>
  ) : (
    <>
      <span className="ease-label">Ease</span>
      <span className="ease-cant">can’t score yet</span>
    </>
  );
  const attrs = {
    className: `ease ${compact ? 'is-compact' : ''} ${ease.scored ? '' : 'is-cant'}`,
    'data-ease': ease.scored ? 'scored' : 'cant',
    'data-ease-lo': ease.lo,
    'data-ease-hi': ease.hi,
    title: ease.scored ? `Development Ease ${ease.lo}–${ease.hi} of 100: ${ease.formula}` : `Can't score yet: ${ease.why}`,
  };
  return onOpen ? (
    <button type="button" {...attrs} onClick={onOpen} aria-label={`Development Ease: ${ease.scored ? `${ease.lo} to ${ease.hi} of 100` : "can't score yet"}. Open its parts.`}>
      {body}
    </button>
  ) : (
    <span {...attrs}>{body}</span>
  );
}

const MARK: Record<EasePart['state'], string> = { clear: '✓', blocks: '✕', unknown: '?' };

export function EasePartCell({ p }: { p: EasePart }) {
  return (
    <span className={`ease-part is-${p.state}`} data-ease-part={p.id} data-ease-state={p.state}>
      <span className="ease-mark" aria-hidden="true">
        {MARK[p.state]}
      </span>{' '}
      {p.words}
    </span>
  );
}

const minusWords = (p: EasePart) => (p.minus[1] === 0 ? '0' : p.minus[0] === p.minus[1] ? `−${p.minus[0]}` : `${p.minus[0] ? `−${p.minus[0]}` : '0'} to −${p.minus[1]}`);

export function EaseTable({ ease, compare }: { ease: Ease; compare?: string }) {
  const w = DEFAULT_SETTINGS.weights;
  return (
    <section className="wall ease-wall" aria-labelledby="ease-h" data-panel="ease">
      <h2 id="ease-h" className="wall-title">
        Development Ease <span className="wall-sub">· {ease.scored ? `${ease.lo}–${ease.hi} of 100` : `can’t score yet: ${ease.why}`}</span>
      </h2>
      <EaseBar ease={ease} />
      <table className="ease-table">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">What we know</th>
            <th scope="col" className="num">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {ease.parts.map((p) => (
            <tr key={p.id} data-ease-row={p.id} className={`is-${p.state}`}>
              <th scope="row">{p.label}</th>
              <td>
                <EasePartCell p={p} />
                <span className="ease-src small muted">{p.source}</span>
              </td>
              <td className="num">{minusWords(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small ease-formula">{ease.formula}</p>
      <p className="small muted">
        Our assumptions, not the City’s: a known step takes its weight off both ends, an unknown off the low end only, so an unknown never makes a lot look easier. Weights: variance {w.variance},
        special exception {w.special_exception}, grading review {w.grading_review}, parking relief {w.parking_relief}, another owner {w.other_owner}, City sale {w.city_public_sale}, consolidation{' '}
        {w.lot_consolidation}; steep ground {EASE_WEIGHTS.steep}, mapped mines {EASE_WEIGHTS.mines}, water and sewer {EASE_WEIGHTS.infrastructure}, a subsidy gap {EASE_WEIGHTS.money}.
      </p>
      {compare ? (
        <p>
          <a className="btn" href={compare} data-compare-link>
            Compare with other sites
          </a>
        </p>
      ) : null}
    </section>
  );
}
