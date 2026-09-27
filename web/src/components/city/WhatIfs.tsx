// Rule what-ifs (spec §0.16): which sentence of the code blocks the most City land, and how many City-owned lots a
// change would open. Each row quotes the sentence (struck through: the what-if), counts the lots, names the top
// neighbourhoods and, when picked, shows those lots on the map in pencil. Numbers from scripts/build-scenarios.ts
// (the same classifier, one override at a time). What-ifs are not the law.
import { TEMPLATES } from '@engine/templates';
import type { TemplateId } from '@engine/types';
import { WHATIF, type WhatIfScenario } from '../../lib/data';
import type { UrlState, WhatIfId } from '../../lib/url';
import { Label } from '../ui';
import { lotsWord, n, zoneName } from './blockers';

const COMPUTED_TYPES: TemplateId[] = ['two', 'three'];

/** The quote as the code has it, marked up: the words the what-if strikes, and what it writes in their place. A quote
 *  that starts mid-sentence is set off by an ellipsis. */
function Markup({ sc }: { sc: WhatIfScenario }) {
  const i = sc.quote.indexOf(sc.strike);
  const lead = /^[a-z]/.test(sc.quote) ? '… ' : '';
  if (i < 0) return <>{lead + sc.quote}</>;
  return (
    <>
      {lead + sc.quote.slice(0, i)}
      <del data-whatif-sentence>{sc.strike}</del>
      {sc.insert ? (
        <>
          {' '}
          <ins className="whatif-ins">{sc.insert}</ins>
        </>
      ) : null}
      {sc.quote.slice(i + sc.strike.length)}
    </>
  );
}

export function WhatIfs({ s, update }: { s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void }) {
  const tname = TEMPLATES[s.type].name.toLowerCase();
  const list = WHATIF.scenarios ?? [];
  if (!list.length) return <p className="na">— No what-ifs computed (data/city/scenarios.json is missing).</p>;
  const typed = COMPUTED_TYPES.includes(s.type);
  const pick = (id: WhatIfId) => update({ whatif: s.whatif === id ? null : id }, { push: true });
  return (
    <div className="whatifs" data-whatifs>
      <p className="whatif-label">
        <span className="stamp stamp-pencil whatif-stamp">What-if: not the law</span> A rule change needs City Council. This counts the City-owned
        lots it would open, with everything else as today{WHATIF.meta?.districts?.length ? ` (districts checked: ${WHATIF.meta.districts.map(zoneName).join(', ')})` : ''}.
      </p>
      {!typed && <p className="na">— Computed for two- and three-unit houses. Pick one of them above to see the counts.</p>}
      <ol className="whatif-list">
        {list.map((sc) => {
          const t = sc.by_type[s.type];
          const on = s.whatif === sc.id;
          const mostlyPencil = t && t.opens > 0 && t.pencil / t.opens > 0.5;
          return (
            <li key={sc.id} className={`whatif${on ? ' is-on' : ''}`} data-whatif={sc.id}>
              <button type="button" className="whatif-pick" aria-pressed={on} onClick={() => pick(sc.id as WhatIfId)} disabled={!t}>
                <span className="whatif-name">
                  <span className="whatif-id">{sc.id}</span> {sc.name}
                </span>
                <span className="whatif-quote">
                  <span className="whatif-sec">§{sc.section}</span> <Markup sc={sc} />
                </span>
                {t ? (
                  <span className="whatif-count">
                    Opens{' '}
                    <strong className="whatif-n" data-whatif-count>
                      {n(t.opens)}
                    </strong>{' '}
                    City-owned {lotsWord(t.opens)} for a {tname}
                    {t.opens ? ` · ${n(t.for_sale)} listed for sale` : ''}
                    {mostlyPencil ? <span className="whatif-pencil"> · mostly pencil (§925.06.C.1 open question)</span> : null}
                  </span>
                ) : null}
                {t && t.by_hood.length ? <span className="whatif-hoods">{t.by_hood.slice(0, 3).map(([h, k]) => `${h} ${k}`).join(' · ')}</span> : null}
              </button>
              {on && <p className="whatif-change small">{sc.change} {t?.opens ? 'The map shows these lots with a pencil ring; the rest of the map is dimmed.' : ''}</p>}
            </li>
          );
        })}
      </ol>
      <Label as="h3">How it is counted</Label>
      <p className="small muted">
        The citywide classifier runs again with one clause read differently or one value changed; nothing else changes. A lot opens if it fails the
        dimensional rules today and passes under the what-if (sale status aside). Pencil lots stay pencil: an open question or mapped frontage
        still decides them.
      </p>
    </div>
  );
}

/** One line for the lot view's Rules tab: this lot would fit under a what-if. */
export function whatIfLine(pin: string, type: TemplateId): { ids: string[]; words: string } | null {
  const hits = (WHATIF.scenarios ?? []).filter((sc) => sc.by_type[type]?.pins.includes(pin));
  if (!hits.length) return null;
  const words = hits.map((sc) => (sc.id === 'S1' ? `§${sc.section}’s vacant-neighbour sentence changed` : sc.id === 'S2' ? `the §${sc.section} narrow-lot table covered this house` : `the RM interior side setback were 5 ft`)).join(', or if ');
  return { ids: hits.map((h) => h.id), words: `Would fit if ${words} (see What-ifs on the city map). A what-if, not the law.` };
}
