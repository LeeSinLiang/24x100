// The top bar (spec §0.15): logo, the command search, breadcrumbs, the building-type switch, the view
// switch Map · Plan · Graph · Table, the theme toggle, and links to Rules, About and Present. One row from
// 1280 px up (the crumbs give way first); two rows on a laptop under 1280; on a phone the two switches
// become two selects on one line (workspace.css).
import type { KeyboardEvent } from 'react';
import { TEMPLATES } from '@engine/templates';
import type { TemplateId } from '@engine/types';
import { Cartouche, Search } from '../Header';
import { TYPE_ORDER } from '../../lib/model';
import type { Theme } from '../../lib/theme';
import type { Canvas, UrlState } from '../../lib/url';

export interface Crumb {
  label: string;
  href?: string;
}

const CANVAS_WORDS: { id: Canvas; words: string }[] = [
  { id: 'map', words: 'Map' },
  { id: 'plan', words: 'Plan' },
  { id: 'graph', words: 'Graph' },
  { id: 'table', words: 'Table' },
];

export function TopBar({
  s,
  update,
  crumbs,
  theme,
  setTheme,
  workspace,
  canvas,
  onType,
  typeTitle,
  rulesHref,
  aboutHref,
}: {
  s: UrlState;
  update: (p: Partial<UrlState>, o?: { push?: boolean }) => void;
  crumbs: Crumb[];
  theme: Theme;
  setTheme: (t: Theme) => void;
  workspace: boolean;
  canvas: Canvas;
  onType: (t: TemplateId) => void;
  typeTitle: (t: TemplateId) => string | undefined;
  rulesHref: string;
  aboutHref: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TYPE_ORDER.indexOf(s.type);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TYPE_ORDER[(i + d + TYPE_ORDER.length) % TYPE_ORDER.length];
    onType(next);
    requestAnimationFrame(() => (document.querySelector(`[data-type-opt="${next}"]`) as HTMLElement | null)?.focus());
  };
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    // A link's ?theme= overrides the stored choice; keep the link in step so the toggle still works.
    if (s.theme) update({ theme: next });
  };
  return (
    <header className={`ws-top ${workspace ? 'is-ws' : ''}`}>
      <Cartouche />
      {!s.record && <Search update={update} />}
      <nav className="crumbs ws-crumbs" aria-label="Where you are">
        <ol>
          {crumbs.map((c, i) => (
            <li key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      {workspace && (
        <div className="ws-types" role="radiogroup" aria-label="Building type">
          {TYPE_ORDER.map((t) => {
            const on = s.type === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-type-opt={t}
                className={`rail-opt ${on ? 'is-on' : ''}`}
                title={typeTitle(t)}
                onClick={() => onType(t)}
                onKeyDown={onKey}
              >
                {TEMPLATES[t].short.replace('-', '‑')}
              </button>
            );
          })}
        </div>
      )}
      {workspace && (
        <div className="ws-views" role="group" aria-label="View">
          {CANVAS_WORDS.map((c) => (
            <button key={c.id} type="button" className={`ws-view ${canvas === c.id ? 'is-on' : ''}`} aria-pressed={canvas === c.id} data-canvas-opt={c.id} onClick={() => update({ canvas: c.id }, { push: true })}>
              {c.words}
            </button>
          ))}
        </div>
      )}
      {workspace && (
        <div className="ws-picks">
          <label className="ws-pick">
            <span className="ws-pick-name">Type</span>
            <select value={s.type} onChange={(e) => onType(e.target.value as TemplateId)} aria-label="Building type">
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t} title={typeTitle(t)}>
                  {TEMPLATES[t].short}
                </option>
              ))}
            </select>
          </label>
          <label className="ws-pick">
            <span className="ws-pick-name">View</span>
            <select value={canvas} onChange={(e) => update({ canvas: e.target.value as Canvas }, { push: true })} aria-label="View">
              {CANVAS_WORDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.words}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!s.record && (
        <div className="ws-tools">
          <button type="button" className={`btn btn-quiet ws-theme ${theme === 'dark' ? 'is-on' : ''}`} aria-pressed={theme === 'dark'} onClick={toggleTheme} title="Cyanotype (dark) theme; paper (light) when off. Remembered in this browser.">
            <span className="ws-theme-mark" aria-hidden="true" />
            Dark
          </button>
          <a className="btn btn-quiet" href={rulesHref}>
            Rules
          </a>
          <a className="btn btn-quiet" href={aboutHref}>
            About
          </a>
          <button type="button" className="btn btn-quiet" onClick={() => update({ present: !s.present })} aria-pressed={s.present}>
            {s.present ? 'Exit' : 'Present'}
          </button>
        </div>
      )}
    </header>
  );
}
