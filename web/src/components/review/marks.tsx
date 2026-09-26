// Trust marks for the review and inquiry screens. Pencil boils (deterministic, 8 re-seeds a second);
// ink is still; a mark that goes from pencil to ink dries over 500 ms (DESIGN_GUIDE §6.1, §7).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useBoil } from '../../lib/craft';

export type TrustKind = 'ink' | 'pencil' | 'red' | 'struck' | 'sealed';

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

/** Five SVG displacement filters shared by every pencil mark on the page. The seed advances eight
 *  times a second; `still` (record, reduced motion, screenshots) renders no filters at all. */
export function PencilFilters({ still }: { still: boolean }) {
  const step = useBoil(!still);
  if (still) return null;
  return (
    <svg className="rv-filters" aria-hidden="true" width="0" height="0" focusable="false">
      {[0, 1, 2, 3, 4].map((i) => (
        <filter key={i} id={`rv-boil-${i}`} x="-5%" y="-20%" width="110%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={i * 7 + step} />
          <feDisplacementMap in="SourceGraphic" scale={0.8} />
        </filter>
      ))}
    </svg>
  );
}

/** Filter reference for a pencil element, seeded by its id: seed = hash(id) % 5 (+ the shared step). */
export function boilStyle(kind: string, seed: number, still: boolean): CSSProperties | undefined {
  if (still || kind !== 'pencil') return undefined;
  return { filter: `url(#rv-boil-${seed % 5})` };
}

/** The 10px state square used in ledgers: filled ink, dashed pencil, red outline, struck, sealed. */
export function TrustMark({ kind, label, seed = 0, still = true }: { kind: TrustKind; label: string; seed?: number; still?: boolean }) {
  const drying = useDry(kind);
  const cls = kind === 'struck' ? 'rv-mark-struck' : kind === 'sealed' ? 'mark-ink rv-mark-sealed' : `mark-${kind}`;
  return <span className={`mark ${cls} ${drying ? 'drying' : ''}`} role="img" aria-label={label} style={boilStyle(kind, seed, still)} />;
}

/** City-confirmed seal: a 12px double ring with an Old Standard "C". */
export function Seal({ title = 'City-confirmed' }: { title?: string }) {
  return (
    <span className="rv-seal" role="img" aria-label={title} title={title}>
      C
    </span>
  );
}
