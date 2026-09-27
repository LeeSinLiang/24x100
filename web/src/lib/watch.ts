// "Watch this lot": lots a user adds to the watchlist in their own browser, exported as a watchlist.json in the
// digest's schema (pipeline/digest.py: {meta:{note, version}, watch:[{block, label, pins}]}). Nothing is sent: the
// digest is off by default and runs dry; a steward commits the exported file as data/watchlist.json.
import { useCallback, useEffect, useState } from 'react';

const KEY = 'lot24x100.watch.v1';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(pins: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    /* storage unavailable (private window): the toggle simply doesn't persist */
  }
  window.dispatchEvent(new Event('lot24x100-watch'));
}

export function useWatchlist(): { pins: string[]; has: (pin: string) => boolean; toggle: (pin: string) => void } {
  const [pins, setPins] = useState<string[]>(read);
  useEffect(() => {
    const on = () => setPins(read());
    window.addEventListener('lot24x100-watch', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('lot24x100-watch', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const toggle = useCallback((pin: string) => {
    const cur = read();
    write(cur.includes(pin) ? cur.filter((p) => p !== pin) : [...cur, pin]);
  }, []);
  return { pins, has: (pin) => pins.includes(pin), toggle };
}

/** The committed watchlist plus one group for the lots added in this browser, in the digest's schema. */
export function exportWatchlist(committed: unknown, added: string[]): string {
  const base = (committed && typeof committed === 'object' ? committed : {}) as { meta?: Record<string, unknown>; watch?: { block: string | null; label: string; pins: string[] }[] };
  const watch = [...(base.watch ?? [])];
  const seen = new Set(watch.flatMap((w) => w.pins));
  const extra = added.filter((p) => !seen.has(p));
  if (extra.length) watch.push({ block: null, label: 'Added in the app', pins: extra });
  return JSON.stringify({ meta: { ...(base.meta ?? {}), note: 'Lots the digest reports on. PINs only; edit freely.', version: 1 }, watch }, null, 1) + '\n';
}
