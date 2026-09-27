// "Watch this lot": saved in this browser; the steward's digest (scripts/digest.ts, Slack and email) reads
// data/watchlist.json. Watching a lot opens a preview of exactly what the digest reports for it now: the map's verdict,
// the rules it rests on and the lot's records, with a link back (engine/src/digest.ts, the digest's own words).
import { useState } from 'react';
import { rulesWords, verdictWords, type WatchLotState } from '@engine/digest';
import { TEMPLATES } from '@engine/templates';
import { useWatchlist } from '../lib/watch';

export function WatchToggle({ pin, state }: { pin: string; state?: WatchLotState | null }) {
  const w = useWatchlist();
  const on = w.has(pin);
  const [open, setOpen] = useState(false);
  return (
    <span className="watch">
      <button
        type="button"
        className="btn btn-small"
        aria-pressed={on}
        data-watch-button
        onClick={() => {
          w.toggle(pin);
          setOpen(!on && !!state);
        }}
        title="Saved in this browser. The steward's digest (Slack and email) reads data/watchlist.json: export it from What changed."
      >
        {on ? 'Watching ✓' : 'Watch this lot'}
      </button>
      {on && state && !open && (
        <button type="button" className="link watch-show" onClick={() => setOpen(true)}>
          What it sends
        </button>
      )}
      {open && state && <WatchPreview state={state} onClose={() => setOpen(false)} />}
    </span>
  );
}

function WatchPreview({ state, onClose }: { state: WatchLotState; onClose: () => void }) {
  const url = `${window.location.origin}${window.location.pathname}${state.link}`;
  const r = state.records;
  return (
    <div className="watch-preview" data-watch-preview role="region" aria-label="What the digest sends for this lot">
      <p className="watch-preview-label">When this lot changes, the digest sends (Slack and email)</p>
      <div className="watch-card">
        <p className="watch-card-head">
          24×100 · watchlist <span className="watch-card-open">Open in 24×100 →</span>
        </p>
        <p className="watch-card-lot">
          <a href={url}>{state.addr}</a>
          {state.hood ? ` · ${state.hood}` : ''}
        </p>
        <ul>
          <li>
            <strong>Map verdict ({TEMPLATES[state.type].name.toLowerCase()}):</strong> {verdictWords(state.verdict, state.type, state.rules)}
          </li>
          <li>
            <strong>{state.zone ?? 'District'} rules:</strong> {rulesWords(state.rules)}
            {state.rules.signers.length ? `; signed by ${state.rules.signers.join(', ')}` : ''}
          </li>
          <li>
            <strong>City sale status:</strong> {r.status}
            {r.status_updated ? ` (last updated ${r.status_updated})` : ''}
          </li>
        </ul>
      </div>
      <p className="small muted">
        These lines are what it reports now; it pings when one of them changes (a record, a rule signed or struck, the map's verdict). Saved in this browser: export the watchlist from
        What changed for the steward, who adds it to data/watchlist.json; the nightly digest does the rest. Nothing is ever sent to the City.
      </p>
      <button type="button" className="link" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
