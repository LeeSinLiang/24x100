// Small shared pieces. Every fact on screen goes through <Ev>, which alone decides how trust looks.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Trust } from '@engine/types';

function boilSeed(k: string): number {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return h % 5;
}

export const DrawerCtx = createContext<(ref: string) => void>(() => {});
export const useOpen = () => useContext(DrawerCtx);

/** Ink drying: when a mark goes from pencil to ink, it sharpens over 500 ms. */
function useDrying(trust: Trust | 'struck' | undefined): boolean {
  const prev = useRef(trust);
  const [drying, setDrying] = useState(false);
  useEffect(() => {
    if (prev.current === 'pencil' && trust === 'ink') {
      setDrying(true);
      const id = window.setTimeout(() => setDrying(false), 520);
      prev.current = trust;
      return () => window.clearTimeout(id);
    }
    prev.current = trust;
  }, [trust]);
  return drying;
}

export function Ev({
  trust = 'ink',
  refId,
  children,
  num,
  className = '',
  title,
}: {
  trust?: Trust | 'struck';
  refId?: string;
  children: ReactNode;
  num?: boolean;
  className?: string;
  title?: string;
}) {
  const open = useOpen();
  const drying = useDrying(trust);
  const cls = `ev ev-${trust} ${num ? 'ev-num' : ''} ${drying ? 'drying' : ''} ${className}`;
  const boil = trust === 'pencil' ? { 'data-boil': String(boilSeed(refId ?? String(children))) } : {};
  if (!refId)
    return (
      <span className={cls} {...boil}>
        {children}
      </span>
    );
  // An inline element (not <button>) so a number inside a sentence wraps like text.
  return (
    <span
      role="button"
      tabIndex={0}
      className={`${cls} is-link`}
      {...boil}
      onClick={() => open(refId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(refId);
        }
      }}
      title={title ?? 'Open the source'}
    >
      {children}
    </span>
  );
}

export function Chip({ refId, children, trust = 'ink' }: { refId?: string; children: ReactNode; trust?: Trust }) {
  const open = useOpen();
  if (!refId) return <span className={`chip chip-${trust}`}>{children}</span>;
  return (
    <button type="button" className={`chip chip-${trust}`} onClick={() => open(refId)}>
      {children}
    </button>
  );
}

export type MarkKind = 'ink' | 'pencil' | 'red' | 'struck' | 'fail' | 'info' | 'na' | 'sealed';
export function Mark({ kind, label }: { kind: MarkKind; label?: string }) {
  return <span className={`mark mark-${kind}`} role="img" aria-label={label ?? kind} />;
}

export function Label({ children, as: As = 'div', className = '' }: { children: ReactNode; as?: 'div' | 'h2' | 'h3' | 'span'; className?: string }) {
  return <As className={`label ${className}`}>{children}</As>;
}

export const DISCLAIMER = 'Decision support, not legal, financial or zoning advice. The City of Pittsburgh interprets its own code.';

export function money(n: number): string {
  const v = Math.round(n / 1000) * 1000;
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
}
export function money1(n: number): string {
  return `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
export function ftFmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}
export function dateFmt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/New_York' });
}
