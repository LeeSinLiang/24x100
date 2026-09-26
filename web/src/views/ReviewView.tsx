// Review: the model drafts in pencil; a named person inks. Saved code text on the left with every
// rule's quote highlighted in place; the district's rules on the right, grouped by field, each with
// its origin, verification level and the decisions a person can record; the review log below.
// The effective state of every rule comes from the engine (buildRuleSet over the audit log).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildRuleSet } from '@engine/rules';
import { findQuote, locateSection } from '@engine/source';
import type { EffectiveRule, RuleField } from '@engine/types';
import { fieldName } from '../components/Drawer';
import { AuditLog } from '../components/review/AuditLog';
import { CodeText, type CodeBlock, type Highlight, type HlStyle } from '../components/review/CodeText';
import { evalLines, extractionFor, reviewDistricts } from '../components/review/extraction';
import { Seal, TrustMark } from '../components/review/marks';
import { QuestionCard, ReviewCard, type AddEntry } from '../components/review/ReviewCard';
import { Ev, Label, dateFmt } from '../components/ui';
import { seedEntries } from '../lib/audit';
import { prefersReducedMotion } from '../lib/craft';
import { QUESTIONS, RULES, codeFor } from '../lib/data';
import '../styles/review.css';
import type { ViewProps } from './types';

const FIELD_ORDER: RuleField[] = [
  'min_lot_area',
  'front_setback',
  'rear_setback',
  'side_setback_interior',
  'side_setback_exterior',
  'party_wall_side',
  'contextual_side',
  'contextual_rear',
  'narrow_lot_side_table',
  'max_height_ft',
  'max_stories',
  'use_detached',
  'use_two',
  'use_row',
  'use_three',
  'parking_detached',
  'parking_two',
  'parking_row',
  'parking_three',
  'grading_review',
  'lot_of_record',
];

/** Non-breaking hyphen for district names in prose ("R1D‑H" never wraps at the hyphen). */
const nb = (d: string) => d.replaceAll('-', '‑');

function styleOf(r: EffectiveRule): HlStyle {
  return r.state === 'struck' ? 'struck' : r.sealed ? 'sealed' : r.state;
}

function sameValue(a: EffectiveRule, b: EffectiveRule): boolean {
  return JSON.stringify(a.value) === JSON.stringify(b.value) && a.unit === b.unit;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ReviewView({ s, update, audit, auditApi }: ViewProps) {
  const district = s.district ?? 'RM-M';
  const rs = useMemo(() => buildRuleSet(district, RULES, QUESTIONS, audit), [district, audit]);
  const ex = useMemo(() => extractionFor(district), [district]);
  const evs = useMemo(() => evalLines(), []);
  const districts = reviewDistricts(district);
  const still = s.still || s.record || prefersReducedMotion();
  const codeRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Set<string>>(() => new Set(s.section ? [s.section] : []));
  const seedIds = useMemo(() => new Set(seedEntries().map((e) => e.id)), []);
  const bothOrigins = rs.rules.some((r) => r.origin === 'extracted') && rs.rules.some((r) => r.origin === 'answer_key');
  const [marksFor, setMarksFor] = useState<'extracted' | 'answer_key'>('extracted');

  // Code blocks: every cited section, nested citations merged into their parent section.
  const { blocks, hls, located, missing } = useMemo(() => {
    const cites = [
      ...rs.rules.map((r) => ({ file: r.source_file, section: r.section })),
      ...rs.questions.map((q) => ({ file: q.question.source_file, section: q.question.section })),
    ];
    const spans: (CodeBlock & { len: number })[] = [];
    const missing: string[] = [];
    for (const c of cites) {
      const text = codeFor(c.file);
      const span = text ? locateSection(text, c.section) : null;
      if (!span) {
        if (!missing.includes(c.section)) missing.push(c.section);
        continue;
      }
      spans.push({ file: c.file, label: c.section, sections: [c.section], start: span.start, end: span.end, len: span.end - span.start });
    }
    spans.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start || b.len - a.len);
    const blocks: CodeBlock[] = [];
    for (const sp of spans) {
      const last = blocks[blocks.length - 1];
      if (last && last.file === sp.file && sp.start < last.end) {
        last.end = Math.max(last.end, sp.end);
        if (!last.sections.includes(sp.label)) last.sections.push(sp.label);
        if (sp.label.length < last.label.length) last.label = sp.label;
      } else blocks.push({ file: sp.file, label: sp.label, sections: [sp.label], start: sp.start, end: sp.end });
    }
    const hls: (Highlight & { origin: string | null })[] = [];
    const located = new Set<string>();
    const place = (id: string, file: string, section: string, quote: string, style: HlStyle, origin: string | null = null) => {
      const text = codeFor(file);
      if (!text) return;
      const span = locateSection(text, section);
      const q = (span && findQuote(text, quote, span)) ?? findQuote(text, quote);
      if (!q) return;
      if (!blocks.some((b) => b.file === file && q.start < b.end && q.end > b.start)) return;
      hls.push({ id, start: q.start, end: q.end, style, origin });
      located.add(id);
    };
    for (const r of rs.rules) place(r.id, r.source_file, r.section, r.quote, styleOf(r), r.origin);
    for (const q of rs.questions) place(`q:${q.question.id}`, q.question.source_file, q.question.section, q.question.quote, q.status === 'open' ? 'pencil' : q.status === 'assumed' ? 'red' : 'sealed');
    return { blocks, hls, located, missing };
  }, [rs]);

  // Rules grouped by field; answer key and model side by side when both exist.
  const groups = useMemo(() => {
    const by = new Map<string, EffectiveRule[]>();
    for (const r of rs.rules) by.set(r.field, [...(by.get(r.field) ?? []), r]);
    const order = (f: string) => {
      const i = FIELD_ORDER.indexOf(f as RuleField);
      return i < 0 ? 99 : i;
    };
    return [...by.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([field, list]) => {
        const key = list.filter((r) => r.origin === 'answer_key');
        const model = list.filter((r) => r.origin === 'extracted');
        const numeric = [...key, ...model].every((r) => r.value != null);
        const pairs = key.length && model.length ? { agree: model.every((m) => key.some((k) => sameValue(k, m))), numeric } : null;
        return { field, list: [...key, ...model], key, model, pairs };
      });
  }, [rs]);

  const counts = useMemo(() => {
    const c = { human: 0, ai: 0, pencil: 0, struck: 0, sealed: 0 };
    for (const r of rs.rules) {
      if (r.state === 'struck') c.struck++;
      else if (r.state === 'pencil') c.pencil++;
      else if (r.ai_checked) c.ai++;
      else c.human++;
      if (r.sealed) c.sealed++;
    }
    const assumed = rs.questions.filter((q) => q.status === 'assumed').length;
    const open = rs.questions.filter((q) => q.status === 'open').length;
    const confirmedQ = rs.questions.filter((q) => q.status === 'city_confirmed').length;
    return { ...c, assumed, open, confirmedQ };
  }, [rs]);

  // Where the answer key and the model quote the same words, show one set of marks at a time.
  const shownHls = bothOrigins ? hls.filter((h) => h.origin == null || h.origin === marksFor) : hls;

  const add: AddEntry = (e) => auditApi.add(e);

  const scrollCodeTo = (id: string) => {
    const panel = codeRef.current;
    const m = panel?.querySelector<HTMLElement>(`[data-hl~="${CSS.escape(id)}"]`);
    if (!panel || !m) return;
    const behavior: ScrollBehavior = still ? 'auto' : 'smooth';
    const pr = panel.getBoundingClientRect();
    if (panel.scrollHeight > panel.clientHeight + 4) {
      const top = m.getBoundingClientRect().top - pr.top + panel.scrollTop - panel.clientHeight * 0.28;
      panel.scrollTo({ top: Math.max(0, top), behavior });
    }
    const r = m.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) m.scrollIntoView({ block: 'center', behavior });
  };

  const locate = (id: string) => {
    const r = rs.rules.find((x) => x.id === id);
    if (r && bothOrigins && r.origin !== marksFor) setMarksFor(r.origin);
    setActive(new Set([id]));
    update({ section: id });
    requestAnimationFrame(() => scrollCodeTo(id));
  };

  const pick = (ids: string[]) => {
    setActive(new Set(ids));
    update({ section: ids[0] });
    requestAnimationFrame(() => {
      const card = document.getElementById(`rv-card-${ids[0]}`);
      if (!card) return;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    });
  };

  // A deep link (&section=<rule id>) opens with that rule's quote in view.
  useEffect(() => {
    if (s.section) requestAnimationFrame(() => scrollCodeTo(s.section!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  const own = rs.rules.filter((r) => r.district === district);
  const keyN = own.filter((r) => r.origin === 'answer_key').length;
  const extN = own.filter((r) => r.origin === 'extracted').length;
  const cityN = rs.rules.filter((r) => r.district === '*').length;
  const lead: ReactNode =
    extN && keyN ? (
      <>
        {nb(district)} has {plural(keyN, 'rule')} from the answer key and {plural(extN, 'rule')} proposed by the model.
        {cityN ? ` ${cityN} more apply in every district.` : ''}
      </>
    ) : extN ? (
      <>
        The model proposed {plural(extN, 'rule')} for {nb(district)}.{cityN ? ` ${cityN} more apply in every district.` : ''}
      </>
    ) : keyN ? (
      <>
        {nb(district)} has {plural(keyN, 'rule')} from the answer key.{cityN ? ` ${cityN} more apply in every district.` : ''}
      </>
    ) : (
      <>
        {nb(district)} has no rules of its own loaded yet{cityN ? `; ${plural(cityN, 'rule applies', 'rules apply')} in every district` : ''}.
      </>
    );

  const questionFor = (r: EffectiveRule) => rs.questions.filter((q) => q.question.affects.includes(r.id));
  const shownQ = new Set<string>();
  const cardFor = (r: EffectiveRule) => (
    <ReviewCard key={r.id} r={r} active={active.has(r.id)} onLocate={() => locate(r.id)} add={add} located={located.has(r.id)} />
  );
  const questionsAfter = (r: EffectiveRule) =>
    questionFor(r).map((q) => {
      shownQ.add(q.question.id);
      const id = `q:${q.question.id}`;
      return <QuestionCard key={id} q={q} active={active.has(id)} onLocate={() => locate(id)} add={add} located={located.has(id)} />;
    });

  return (
    <main className="rv" id="main">
      <header className="rv-top">
        <div className="rv-pick">
          <span className="label">Rules for</span>
          <div className="scenario-rail" role="radiogroup" aria-label="District">
            {districts.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={d === district}
                className={`rail-opt ${d === district ? 'is-on' : ''}`}
                onClick={() => {
                  setActive(new Set());
                  update({ district: d, section: null }, { push: true });
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <h1 className="rv-lead">
          {lead}{' '}
          <span className="rv-lead-2">
            <Ev trust="ink">{counts.human > 0 ? `${counts.human} signed by a person` : 'None signed by a person yet'}</Ev>
            {counts.ai ? (
              <>
                {'; '}
                <Ev trust="ink">{counts.ai} checked by an AI agent only</Ev>
              </>
            ) : null}
            {'; '}
            <Ev trust="pencil">{counts.pencil} in pencil</Ev>
            {counts.struck ? (
              <>
                {'; '}
                <Ev trust="struck">{counts.struck} struck</Ev>
              </>
            ) : null}
            .
          </span>
        </h1>
        {evs.map((ev) => (
          <p key={ev.district} className="rv-eval">
            <Label as="span">Evaluation</Label> {nb(ev.district)}: {ev.agree} of {ev.total} fields agree with the hand-checked answer key
            {ev.verbatim ? ` · ${ev.verbatim}` : ''}
            {ev.model ? ` · model ${ev.model}` : ''}
          </p>
        ))}
        {ex ? (
          <p className="rv-run small">
            <Label as="span">Extraction run</Label> {ex.model ?? 'model not recorded'}
            {ex.provider ? ` (${ex.provider})` : ''}
            {ex.run_at ? ` · ${dateFmt(ex.run_at)}` : ''}
            {ex.prompt_sha ? ` · prompt ${ex.prompt_sha.slice(0, 8)}` : ''} · {plural(ex.rules, 'rule')} accepted by the guards, {ex.rejected.length} rejected. Only the saved code text was sent to the model.
          </p>
        ) : (
          <p className="rv-empty">
            No extraction has run for {nb(district)} yet. Run <kbd className="rv-cmd">uv run python -m extract run --district {district}</kbd>.{' '}
            <span className="muted">{keyN ? 'Then the model’s proposals appear beside the hand-checked answer key.' : 'Until then only the citywide rules below apply here.'}</span>
          </p>
        )}
        <ol className="rv-levels" aria-label="Verification levels">
          <li>
            <TrustMark kind="pencil" label="pencil" />
            <div>
              <span className="label">Pencil · unreviewed · {counts.pencil}</span>
              <p>Proposed by the model. It doesn’t count yet.</p>
            </div>
          </li>
          <li>
            <TrustMark kind="ink" label="ink" />
            <div>
              <span className="label">Ink · source-checked · {counts.human + counts.ai}</span>
              <p>A named person matched the rule to the quoted text: name, role, time, note.</p>
            </div>
          </li>
          <li>
            <TrustMark kind="sealed" label="City-confirmed" />
            <div>
              <span className="label">
                Ink + seal <Seal /> · City-confirmed · {counts.sealed + counts.confirmedQ}
              </span>
              <p>The City answered: reference, date, who. Only this settles an ambiguous clause.</p>
            </div>
          </li>
          <li>
            <TrustMark kind="red" label="assumed" />
            <div>
              <span className="label">Red · assumed · {counts.assumed}</span>
              <p>Your team picked an answer to explore. Never ink; the inquiry still asks.</p>
            </div>
          </li>
          <li>
            <TrustMark kind="struck" label="struck" />
            <div>
              <span className="label">Struck · {counts.struck}</span>
              <p>A reviewer rejected it. It stays visible and isn’t used.</p>
            </div>
          </li>
        </ol>
        <p className="rv-key">Source-checked means the rule matches the quoted text. Only the City can settle what an ambiguous clause means.</p>
      </header>

      <div className="rv-cols">
        <section className="rv-code-col" aria-labelledby="rv-code-h">
          <h2 id="rv-code-h" className="rv-col-title">
            The saved code text
          </h2>
          <p className="small muted rv-col-sub">Each rule’s quote is marked where it appears: dashed for pencil, solid for ink, struck through when rejected. Click a mark to find its rule.</p>
          {bothOrigins && (
            <div className="rv-marks-for" role="radiogroup" aria-label="Show marks for">
              <span className="label">Marks for</span>
              {(['extracted', 'answer_key'] as const).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={marksFor === o} className={`rv-seg ${marksFor === o ? 'is-on' : ''}`} onClick={() => setMarksFor(o)}>
                  {o === 'extracted' ? 'The model' : 'The answer key'}
                </button>
              ))}
            </div>
          )}
          <div className="rv-code" ref={codeRef} tabIndex={0} aria-label="Saved code text">
            {blocks.map((b) => (
              <CodeText key={`${b.file}:${b.start}`} block={b} text={codeFor(b.file) ?? ''} hls={shownHls} active={active} onPick={pick} />
            ))}
            {missing.length > 0 && <p className="warn">Not found in the saved text: {missing.map((m) => `§${m}`).join(', ')}.</p>}
            {!blocks.length && <p className="na">— No cited sections to show.</p>}
          </div>
        </section>

        <section className="rv-rules-col" aria-labelledby="rv-rules-h">
          <h2 id="rv-rules-h" className="rv-col-title">
            The rules
          </h2>
          <p className="small muted rv-col-sub">Grouped by what they regulate. Answer key and model side by side where both exist.</p>
          {groups.map((g) => (
            <section key={g.field} className="rv-group" aria-label={fieldName(g.field)}>
              <h3 className="rv-field">
                <span className="label">{fieldName(g.field)}</span>
                {g.pairs &&
                  (!g.pairs.numeric ? (
                    <span className="rv-agree">a condition, not a number: compare the wording</span>
                  ) : g.pairs.agree ? (
                    <span className="rv-agree">model agrees with the answer key</span>
                  ) : (
                    <span className="rv-disagree">Disagree</span>
                  ))}
              </h3>
              {g.pairs && g.pairs.numeric && !g.pairs.agree && (
                <p className="rv-disagree-line">
                  The model and the answer key disagree. Check both against the quoted text; the saved text wins.
                </p>
              )}
              <div className={g.pairs ? 'rv-pair' : 'rv-list'}>
                {g.pairs ? (
                  <>
                    <div className="rv-side">
                      <span className="label rv-side-h">Answer key</span>
                      {g.key.map((r) => (
                        <div key={r.id}>
                          {cardFor(r)}
                          {questionsAfter(r)}
                        </div>
                      ))}
                    </div>
                    <div className="rv-side">
                      <span className="label rv-side-h">Model</span>
                      {g.model.map((r) => (
                        <div key={r.id}>
                          {cardFor(r)}
                          {questionsAfter(r)}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  g.list.map((r) => (
                    <div key={r.id}>
                      {cardFor(r)}
                      {questionsAfter(r)}
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
          {rs.questions
            .filter((q) => !shownQ.has(q.question.id))
            .map((q) => {
              const id = `q:${q.question.id}`;
              return (
                <section key={id} className="rv-group">
                  <h3 className="rv-field">
                    <span className="label">Open question</span>
                  </h3>
                  <QuestionCard q={q} active={active.has(id)} onLocate={() => locate(id)} add={add} located={located.has(id)} />
                </section>
              );
            })}
          {ex && ex.rejected.length > 0 && (
            <details className="rv-rejected">
              <summary>
                {plural(ex.rejected.length, 'proposal')} rejected by the guards · not shown above
              </summary>
              <ul>
                {ex.rejected.map((x, i) => (
                  <li key={i}>
                    <strong>{fieldName(x.field)}</strong> §{x.section}: {x.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>

      <AuditLog
        entries={audit}
        seedIds={seedIds}
        local={auditApi.local}
        replaceLocal={auditApi.replaceLocal}
        record={s.record}
        onGo={(d, id) => {
          if (d && d !== district) update({ district: d, section: id }, { push: true });
          else locate(id);
        }}
      />
    </main>
  );
}
