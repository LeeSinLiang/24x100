// Theme (spec §0.15): light (paper, "Atlas") is the default whatever the OS says; dark (cyanotype) is a
// toggle in the top bar, remembered per browser. `?theme=` in the link overrides both. Storage can be
// missing or throw (private windows, blocked site data), so every read and write is guarded.
import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'lot24x100.theme.v1';

export function readStoredTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(t: Theme): void {
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    /* no storage: the toggle still works for this page view */
  }
}

/** The theme to draw: the link's override, else this browser's choice, else light. */
export function useTheme(override: Theme | null): [Theme, (t: Theme) => void] {
  const [stored, setStored] = useState<Theme | null>(() => readStoredTheme());
  const set = useCallback((t: Theme) => {
    writeStoredTheme(t);
    setStored(t);
  }, []);
  return [override ?? stored ?? 'light', set];
}
