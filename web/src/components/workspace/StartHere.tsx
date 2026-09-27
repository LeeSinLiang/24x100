// "Start here" (judge panel, round 3): three ways into the story the film tells, above the city map, so a judge who
// opens the site cold lands in it. Each chip is a real link (it opens in a new tab too) that navigates in place.
import type { UrlState } from '../../lib/url';
import { toSearch } from '../../lib/url';

type Update = (p: Partial<UrlState>, o?: { push?: boolean }) => void;

// The four Track 1 personas, each to the screen that answers their first question (Sin, 27 Sep).
const CHIPS: { id: string; label: string; title: string; to: Partial<UrlState> & { view: UrlState['view'] } }[] = [
  { id: 'cdc', label: 'Nonprofit / CDC', title: "Tonight's shortlist: City lots that fit and passed the checks; open one for its subsidy per home", to: { view: 'shortlist', layer: null, run: null, pin: null, tab: null, whatif: null } },
  { id: 'developer', label: 'Developer', title: 'A parcel: its Development Ease, parts and weights; add your builder’s quote on the Money tab', to: { view: 'lot', block: '10K', lot: '25', lots: ['25', '26', '27'], type: 'three', tab: 'ease', drawer: null, pin: null, run: null, layer: null, whatif: null } },
  { id: 'planner', label: 'Planner', title: 'Compare sites on the same columns (the city map shows every lot by what blocks it)', to: { view: 'compare', layer: null, run: null, pin: null, tab: null, whatif: null } },
  { id: 'policy', label: 'Policy analyst', title: 'Rule what-ifs, and the policy agent’s questions: what a one-sentence change would open', to: { view: 'city', type: 'two', tab: 'whatif', whatif: 'S1', layer: null, run: null, pin: null } },
];

export function StartHere({ s, update }: { s: UrlState; update: Update }) {
  if (s.record || s.present) return null; // the film and the projector keep their staged frames
  const on = (id: string) => (id === 'policy' ? s.tab === 'whatif' : false);
  return (
    <nav className="ws-start" aria-label="Start here">
      <span className="ws-start-label">Start here</span>
      {CHIPS.map((c) => (
        <a
          key={c.id}
          className={`ws-start-chip${on(c.id) ? ' is-on' : ''}`}
          data-start={c.id}
          title={c.title}
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
