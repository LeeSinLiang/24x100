// Trust marks for the review and inquiry screens. Pencil marks boil through the app-wide filters in
// base.css (.mark-pencil); ink is still; a mark that goes from pencil to ink dries over 500 ms
// (DESIGN_GUIDE §6.1, §7).
import { useEffect, useRef, useState } from 'react';

export type TrustKind = 'ink' | 'pencil' | 'red' | 'struck' | 'sealed' | 'estimate';

/** True for 520 ms after `trust` goes from pencil to ink (or sealed): the ink-drying move. */
export function useDry(trust: string | undefined): boolean {
  const prev = useRef(trust);
  const [drying, setDrying] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = trust;
    if (was === 'pencil' && (trust === 'ink' || trust === 'sealed')) {
      setDrying(true);
      const id = window.setTimeout(() => setDrying(false), 520);
      return () => window.clearTimeout(id);
    }
  }, [trust]);
  return drying;
}

/** The 10px state square used in ledgers: filled ink, dashed pencil, red outline, struck, sealed. */
export function TrustMark({ kind, label }: { kind: TrustKind; label: string }) {
  const drying = useDry(kind);
  const cls = kind === 'struck' ? 'rv-mark-struck' : kind === 'sealed' ? 'mark-ink rv-mark-sealed' : kind === 'estimate' ? 'est-mark' : `mark-${kind}`;
  return <span className={`mark ${cls} ${drying ? 'drying' : ''}`} role="img" aria-label={label} />;
}

/** City-confirmed seal: a 12px double ring with an Old Standard "C". */
export function Seal({ title = 'City-confirmed' }: { title?: string }) {
  return (
    <span className="rv-seal" role="img" aria-label={title} title={title}>
      C
    </span>
  );
}
