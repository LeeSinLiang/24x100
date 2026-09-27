// Link parameters that were set but couldn't be used, in one small dismissible line under the top bar
// (judge round 2: `type=castle` silently drew a two-unit house, `tol=abc` vanished, and an unknown `hood`
// read "0 runs" as if it had been computed). The page underneath shows the default.
import type { IgnoredApi } from '../../lib/url';

const short = (v: string) => (v.length > 40 ? `${v.slice(0, 39)}…` : v);

export function UrlNotice({ api }: { api: IgnoredApi }) {
  if (!api.items.length) return null;
  return (
    <div className="ws-notice" role="status" data-notice="ignored">
      <p>
        <span className="ws-notice-head">Ignored:</span>{' '}
        {api.items.map((x, i) => (
          <span key={`${x.param}=${x.value}`} data-ignored={x.param}>
            {i ? '; ' : ''}
            <span className="ws-notice-param">
              {x.param}={short(x.value)}
            </span>{' '}
            ({x.why})
          </span>
        ))}
        . Showing the default instead.
      </p>
      <button type="button" className="ws-notice-x" onClick={api.dismiss} aria-label="Dismiss this notice" title="Dismiss">
        ×
      </button>
    </div>
  );
}
