// The building-type rail: the same atlas radio group as the lot view, with arrow keys.
import type { KeyboardEvent } from 'react';
import { TEMPLATES } from '@engine/templates';
import type { TemplateId } from '@engine/types';
import { TYPE_ORDER } from '../../lib/model';

export function TypeRail({ type, onType, label = 'Try' }: { type: TemplateId; onType: (t: TemplateId) => void; label?: string }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TYPE_ORDER.indexOf(type);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TYPE_ORDER[(i + d + TYPE_ORDER.length) % TYPE_ORDER.length];
    onType(next);
    requestAnimationFrame(() => (document.querySelector(`[data-type-opt="${next}"]`) as HTMLElement | null)?.focus());
  };
  return (
    <div className="scenario-rail" role="radiogroup" aria-label="Building type">
      <span className="label rail-label">{label}</span>
      {TYPE_ORDER.map((t) => {
        const on = type === t;
        return (
          <button key={t} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-type-opt={t} className={`rail-opt ${on ? 'is-on' : ''}`} onClick={() => onType(t)} onKeyDown={onKey}>
            {TEMPLATES[t].short}
          </button>
        );
      })}
    </div>
  );
}
