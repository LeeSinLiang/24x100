// The engine's sentence segments (headline, explanation), rendered with their trust and sources.
// Moved from LotView (spec §0.15): the engine's own sentences now lead the Rules tab.
import type { Seg } from '@engine/index';
import { Chip, Ev } from '../ui';

export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        !s.num && s.ref && s.t.length > 24 ? (
          <span key={i} className={s.trust && s.trust !== 'ink' ? `ev-${s.trust}` : undefined}>
            {s.t.replace(/\s*\(§[^)]+\)\.?$/, '')}{' '}
            <Chip refId={s.ref} trust={s.trust === 'pencil' ? 'pencil' : 'ink'}>
              {(s.t.match(/§\d{3}\.\d{2}(?:\.[A-Z0-9]+)*(?:\([a-z0-9]+\))?/) ?? ['source'])[0]}
            </Chip>{' '}
          </span>
        ) : s.num || s.ref ? (
          <Ev key={i} trust={s.trust ?? 'ink'} refId={s.ref} num={s.num}>
            {s.t}
          </Ev>
        ) : (
          <span key={i} className={s.trust && s.trust !== 'ink' ? `ev-${s.trust}` : undefined}>
            {s.t}
          </span>
        ),
      )}
    </>
  );
}
