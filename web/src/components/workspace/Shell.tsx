// The inspector's frame (spec §0.15): a header (what is selected, a status chip, one plain sentence),
// four KPI tiles, and tabs. Every tab panel is rendered and the inactive ones are hidden, so each tab's
// content stays in the page (the trust scan reads the ledger whichever tab is open).
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { InspectorTab } from '../../lib/url';

export interface TabDef {
  id: InspectorTab;
  label: string;
  glyph?: { mark: string; state: string; words: string } | null; // the verdict chip's glyph for this tab
  panel: ReactNode;
}

export function InspectorShell({
  title,
  status,
  sentence,
  tiles,
  tabs,
  active,
  onTab,
  before,
  note,
  defaultTab,
  statusDetail,
  action,
}: {
  title: ReactNode;
  status: ReactNode;
  sentence: ReactNode;
  tiles: ReactNode;
  tabs: TabDef[];
  active: InspectorTab | null;
  onTab: (t: InspectorTab) => void;
  before?: ReactNode; // a back link above the title
  note?: ReactNode; // a pencil note under the sentence (e.g. changed on the last refresh)
  defaultTab?: InspectorTab; // the tab to open when the link names none (else the first)
  statusDetail?: ReactNode; // what the status chip opens: the verdict in full (what blocks it)
  action?: ReactNode; // one small control at the end of the status row (e.g. "Watch this lot")
}) {
  const [why, setWhy] = useState(false);
  const on = tabs.find((t) => t.id === active) ?? tabs.find((t) => t.id === defaultTab) ?? tabs[0];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : d ? (i + d + tabs.length) % tabs.length : -1;
    if (j < 0) return;
    e.preventDefault();
    onTab(tabs[j].id);
    refs.current[j]?.focus();
  };
  return (
    <aside className="ws-inspector" aria-label="Inspector: the selection">
      <header className="ws-ins-head">
        {before}
        <h1 className="ws-title">{title}</h1>
        <div className="ws-status">
          {statusDetail ? (
            <button type="button" className="ws-status-btn" aria-expanded={why} aria-controls="ws-why" onClick={() => setWhy(!why)} title="What blocks it: money, rules and site">
              {status}
              <span className={`ws-caret ${why ? 'is-open' : ''}`} aria-hidden="true" />
            </button>
          ) : (
            status
          )}
          {action ? <span className="ws-status-action">{action}</span> : null}
        </div>
        {statusDetail && why ? (
          <div className="ws-why" id="ws-why">
            {statusDetail}
          </div>
        ) : null}
        <p className="ws-sentence" aria-live="polite">
          {sentence}
        </p>
        {note}
      </header>
      <div className="ws-tiles">{tiles}</div>
      <div className="ws-tabs" role="tablist" aria-label="Details">
        {tabs.map((t, i) => {
          const sel = t.id === on.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`ws-tab-${t.id}`}
              data-tab={t.id}
              aria-selected={sel}
              aria-controls={`ws-panel-${t.id}`}
              tabIndex={sel ? 0 : -1}
              className={`ws-tab ${sel ? 'is-on' : ''}`}
              onClick={() => onTab(t.id)}
              onKeyDown={(e) => key(e, i)}
              title={t.glyph ? `${t.label}: ${t.glyph.words}` : undefined}
            >
              {t.glyph && (
                <span className={`ws-tab-glyph is-${t.glyph.state}`} aria-hidden="true">
                  {t.glyph.mark}
                </span>
              )}
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="ws-tabbody">
        {tabs.map((t) => (
          <section key={t.id} role="tabpanel" id={`ws-panel-${t.id}`} aria-labelledby={`ws-tab-${t.id}`} hidden={t.id !== on.id} className="ws-tabpanel" data-tabpanel={t.id}>
            {t.panel}
          </section>
        ))}
      </div>
    </aside>
  );
}

export function Tile({ id, label, value, sub, title, className = '' }: { id: string; label: ReactNode; value: ReactNode; sub?: ReactNode; title?: string; className?: string }) {
  return (
    <div className={`ws-tile ${className}`} data-tile={id} title={title}>
      <p className="ws-tile-label">{label}</p>
      <div className="ws-tile-value">{value}</div>
      {sub != null && <p className="ws-tile-sub">{sub}</p>}
    </div>
  );
}

/** A "—" tile value with its reason (can't-score lots, and anything not assessed). */
export function Dash({ why }: { why: string }) {
  return (
    <>
      <span className="ws-dash" aria-label={`not assessed: ${why}`}>
        —
      </span>
    </>
  );
}
