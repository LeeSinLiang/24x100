// "Watch this lot": saved in this browser; the digest reads data/watchlist.json (export it from What changed).
import { useWatchlist } from '../lib/watch';

export function WatchToggle({ pin }: { pin: string }) {
  const w = useWatchlist();
  const on = w.has(pin);
  return (
    <button
      type="button"
      className="btn btn-small"
      aria-pressed={on}
      onClick={() => w.toggle(pin)}
      title="Saved in this browser. The weekly digest (off by default, dry run) reads data/watchlist.json: export it from What changed."
    >
      {on ? 'Watching ✓' : 'Watch this lot'}
    </button>
  );
}
