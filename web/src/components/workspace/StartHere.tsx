// "Start here" (judge panel, round 3): three ways into the story the film tells, above the city map, so a judge who
// opens the site cold lands in it. Each chip is a real link (it opens in a new tab too) that navigates in place.
import type { UrlState } from '../../lib/url';
import { toSearch } from '../../lib/url';

type Update = (p: Partial<UrlState>, o?: { push?: boolean }) => void;

const CHIPS: { id: string; label: string; to: Partial<UrlState> & { view: UrlState['view'] } }[] = [
  { id: 'mahon', label: '2241 Mahon St: why 4 ft', to: { view: 'lot', block: '10K', lot: '25', lots: [], type: 'two', tab: null, drawer: null, pin: null, run: null, layer: null, whatif: null } },
  { id: 'combine', label: 'Combine to fit', to: { view: 'city', type: 'three', layer: 'assemble', run: null, pin: null, tab: null, whatif: null } },
  { id: 'whatif', label: 'Rule what-ifs', to: { view: 'city', type: 'two', tab: 'whatif', whatif: 'S1', layer: null, run: null, pin: null } },
];

export function StartHere({ s, update }: { s: UrlState; update: Update }) {
  if (s.record || s.present) return null; // the film and the projector keep their staged frames
  const on = (id: string) => (id === 'whatif' ? s.tab === 'whatif' : id === 'combine' ? s.layer === 'assemble' : false);
  return (
    <nav className="ws-start" aria-label="Start here">
      <span className="ws-start-label">Start here</span>
      {CHIPS.map((c) => (
        <a
          key={c.id}
          className={`ws-start-chip${on(c.id) ? ' is-on' : ''}`}
          data-start={c.id}
          href={toSearch({ ...s, ...c.to })}
          aria-current={on(c.id) ? 'page' : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab: let the link do it
            e.preventDefault();
            update(c.to, { push: true });
          }}
        >
          {c.label}
        </a>
      ))}
    </nav>
  );
}
