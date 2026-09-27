// Rule what-ifs (spec §0.16): which sentence of the code blocks the most City land, and how many City-owned lots a
// change would open. Each row quotes the sentence (struck through: the what-if), counts the lots, names the top
// neighbourhoods and, when picked, shows those lots on the map in pencil. Numbers from scripts/build-scenarios.ts
// (the same classifier, one override at a time). What-ifs are not the law.
import { useState } from 'react';
import { TEMPLATES } from '@engine/templates';
import type { TemplateId } from '@engine/types';
import { POLICY, WHATIF, type PolicyRun, type PolicyStep } from '../../lib/data';
import type { UrlState, WhatIfId } from '../../lib/url';
import { Label } from '../ui';
import { lotsWord, n, zoneName } from './blockers';

const COMPUTED_TYPES: TemplateId[] = ['two', 'three'];

/** The quote as the code has it, marked up: the words the what-if strikes, and what it writes in their place. A quote
 *  that starts mid-sentence is set off by an ellipsis. */
function Markup({ sc }: { sc: { quote: string; strike: string; insert: string | null } }) {
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
      <PolicyAsked s={s} update={update} typed={typed} tname={tname} />
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
  const asked = POLICY.filter((q) => q.status === 'counted' && q.by_type?.[type]?.pins.includes(pin));
  const hits = [...(WHATIF.scenarios ?? []).filter((sc) => sc.by_type[type]?.pins.includes(pin)), ...asked];
  if (!hits.length) return null;
  const words = hits.map((sc) => (sc.id === 'S1' ? `§${sc.section}’s vacant-neighbour sentence changed` : sc.id === 'S2' ? `the §${sc.section} narrow-lot table covered this house` : sc.id === 'S3' ? `the RM interior side setback were 5 ft` : `the policy agent’s ${sc.id} held (${sc.name})`)).join(', or if ');
  return { ids: hits.map((h) => h.id), words: `Would fit if ${words} (see What-ifs on the city map). A what-if, not the law.` };
}

// ---------- Asked by the policy agent (agents/policy): a planner's question, the agent's steps, the redline, the count, the memo ----------
const CLI = 'uv run python -m agents.policy "What if …?" --building two';

/** The memo's markdown, drawn with the page's own type: headings, the quoted code, list items, bold, struck and italic words. */
function MemoText({ md }: { md: string }) {
  const inline = (t: string, k: string) =>
    t.split(/(\*\*[^*]+\*\*|~~[^~]+~~|_[^_]+_)/g).map((x, i) =>
      x.startsWith('**') ? <strong key={k + i}>{x.slice(2, -2)}</strong> : x.startsWith('~~') ? <del key={k + i}>{x.slice(2, -2)}</del> : /^_.+_$/.test(x) ? <em key={k + i}>{x.slice(1, -1)}</em> : x,
    );
  return (
    <div className="policy-memo-text">
      {md.split('\n').filter((l) => l.trim()).map((l, i) =>
        l.startsWith('# ') ? <p key={i} className="policy-memo-h">{inline(l.slice(2), `${i}`)}</p>
        : l.startsWith('> ') ? <blockquote key={i}>{inline(l.slice(2), `${i}`)}</blockquote>
        : l.startsWith('- ') ? <p key={i} className="policy-memo-li">{inline(l.slice(2), `${i}`)}</p>
        : <p key={i}>{inline(l, `${i}`)}</p>,
      )}
    </div>
  );
}

function Steps({ steps }: { steps: PolicyStep[] }) {
  return (
    <ol className="policy-steps" data-policy-steps>
      {steps.map((st) => (
        <li key={st.n} className={`policy-step${st.ok ? '' : ' is-no'}`} data-step={st.action}>
          <span className="policy-step-act">
            {st.n}. {st.action}
            {st.tool ? ` · ${st.tool}` : ''}
          </span>
          <span className="policy-step-sum">{st.summary}</span>
        </li>
      ))}
    </ol>
  );
}

function Memo({ run }: { run: PolicyRun }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  if (!run.memo_md) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(run.memo_md!);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <details className="policy-memo" data-policy-memo>
      <summary>The memo: a one-page draft to the Planning Commission</summary>
      <MemoText md={run.memo_md} />
      <p className="small">
        <button type="button" className="link" onClick={copy}>
          Copy as markdown
        </button>{' '}
        <span className="muted">{copied ? 'Copied. Nothing has been sent.' : copied === false ? 'This browser blocked the clipboard.' : `Also in ${run.id.toLowerCase()}-….md beside the run.`}</span>
      </p>
    </details>
  );
}

function Who({ run }: { run: PolicyRun }) {
  const m = run.model;
  const tok = run.usage?.calls ? ` · ${n(run.usage.tokens_in)} tokens in, ${n(run.usage.tokens_out)} out` : '';
  const cost = m.cost?.usd != null ? ` · $${m.cost.usd.toFixed(4)} at the paid price (free tier: $0)` : '';
  return <p className="small muted policy-who">{m.planned_by === 'hand' ? 'Planned by hand, no model.' : `Model: ${m.name}${m.fallbacks?.length ? ` (after ${m.fallbacks.map((f) => f.model).join(', ')} refused)` : ''}${tok}${cost}.`}</p>;
}

function PolicyAsked({ s, update, typed, tname }: { s: UrlState; update: (p: Partial<UrlState>, o?: { push?: boolean }) => void; typed: boolean; tname: string }) {
  const [open, setOpen] = useState<string | null>(null); // a refused question, expanded (it lights nothing on the map)
  if (!POLICY.length) return null;
  return (
    <section className="policy" data-policy>
      <Label as="h3">Asked by the policy agent</Label>
      <p className="small">
        A planner asks in plain words; an AI agent finds the sentence in the saved code (word for word, or it is rejected), writes the redline and runs the
        same count as above. It never counts itself, and it says no when a question isn't one rule's value.{' '}
        <span className="stamp stamp-pencil whatif-stamp">Drafted by an AI agent: check before sending</span>
      </p>
      <ol className="whatif-list policy-list">
        {POLICY.map((q) => {
          if (q.status !== 'counted') {
            const on = open === q.id;
            return (
              <li key={q.id} className={`whatif policy-refused${on ? ' is-on' : ''}`} data-policy-run={q.id}>
                <button type="button" className="whatif-pick" aria-expanded={on} onClick={() => setOpen(on ? null : q.id)}>
                  <span className="whatif-name">
                    <span className="whatif-id">{q.id}</span> {q.name} <span className="stamp policy-no">Refused</span>
                  </span>
                  <span className="policy-question" data-policy-question={q.id}>“{q.question}”</span>
                  <span className="whatif-count">{q.reason}</span>
                </button>
                {on && (
                  <div className="policy-open">
                    <Steps steps={q.steps} />
                    <Who run={q} />
                  </div>
                )}
              </li>
            );
          }
          const t = q.by_type?.[s.type];
          const on = s.whatif === q.id;
          return (
            <li key={q.id} className={`whatif${on ? ' is-on' : ''}`} data-whatif={q.id} data-policy-run={q.id}>
              <button type="button" className="whatif-pick" aria-pressed={on} onClick={() => update({ whatif: on ? null : (q.id as WhatIfId) }, { push: true })} disabled={!t}>
                <span className="whatif-name">
                  <span className="whatif-id">{q.id}</span> {q.name}
                </span>
                <span className="policy-question" data-policy-question={q.id}>“{q.question}”</span>
                <span className="whatif-quote" data-policy-redline={q.id}>
                  <span className="whatif-sec">§{q.section}</span> <Markup sc={{ quote: q.quote ?? '', strike: q.strike ?? '', insert: q.insert ?? null }} />
                </span>
                {t ? (
                  <span className="whatif-count" data-policy-count={q.id}>
                    Opens{' '}
                    <strong className="whatif-n" data-whatif-count>
                      {n(t.opens)}
                    </strong>{' '}
                    City-owned {lotsWord(t.opens)} for a {tname}
                    {t.opens ? ` · ${n(t.for_sale)} listed for sale` : ''}
                  </span>
                ) : null}
                {t && t.by_hood.length ? <span className="whatif-hoods">{t.by_hood.slice(0, 3).map(([h, k]) => `${h} ${k}`).join(' · ')}</span> : null}
              </button>
              {on && (
                <div className="policy-open">
                  <p className="whatif-change small">
                    {q.change} {t?.opens ? 'The map shows these lots with a pencil ring.' : ''}{' '}
                    <span className="stamp stamp-pencil whatif-stamp">{q.labels.join(' · ')}</span>
                  </p>
                  <Steps steps={q.steps} />
                  <Memo run={q} />
                  <Who run={q} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!typed && <p className="na">— Counted for two- and three-unit houses.</p>}
      <p className="small muted">
        These are committed runs. Ask a new one from the repo: <code>{CLI}</code> (add <code>--plan file.json</code> to run a hand-written plan with no model).
      </p>
    </section>
  );
}
