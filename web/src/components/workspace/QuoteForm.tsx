// The builder's quote (judge panel round 3, the builder's top ask): one number, $ per sq ft, that replaces the
// practitioner's estimate as the deciding figure. Red: the user's own, not checked. In the URL (&quote=140) so it can
// be shared, and remembered in this browser to prefill the field (never applied without the user's click or Enter).
import { useEffect, useState } from 'react';
import type { UrlState } from '../../lib/url';

const KEY = 'lot24x100.quote.v1';
const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
const save = (v: number | null) => {
  try {
    if (v == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(v));
  } catch {
    /* private window: the field simply isn't remembered */
  }
};
const valid = (n: number) => Number.isFinite(n) && n >= 20 && n <= 2000;

export function QuoteForm({ s, update }: { s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
  const [v, setV] = useState(() => (s.quote != null ? String(s.quote) : read()));
  useEffect(() => {
    if (s.quote != null) setV(String(s.quote));
  }, [s.quote]);
  const n = Number(v.replace(/[$,\s]/g, ''));
  const ok = v.trim() !== '' && valid(n);
  const tip = 'Your builder’s price for this building, in dollars per square foot. Yours, not checked (red): it decides the verdict and what’s left; the practitioner’s estimate stays beside it.';
  return (
    <form
      className={`quote-form${s.quote != null ? ' is-on' : ''}`}
      data-quote-form
      title={tip}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        save(n);
        update({ quote: n }, { push: true });
      }}
    >
      <label htmlFor="quote-in">Your builder’s quote</label>
      <span className="quote-field">
        $
        <input id="quote-in" name="quote" inputMode="decimal" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder="per sq ft" aria-describedby="quote-tip" />
        /sf
      </span>
      <button type="submit" className="btn btn-small" disabled={!ok || n === s.quote}>
        Use it
      </button>
      {s.quote != null && (
        <button
          type="button"
          className="link quote-clear"
          onClick={() => {
            save(null);
            setV('');
            update({ quote: null }, { push: true });
          }}
        >
          Clear
        </button>
      )}
      <span id="quote-tip" className="visually-hidden">
        {tip}
      </span>
    </form>
  );
}
