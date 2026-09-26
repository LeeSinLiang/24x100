// One rule, or one open question, on the review screen. The value is an <Ev>, so a pencil rule that
// a person signs dries to ink in place. Decisions go through the shared ReviewForm and are written to
// the audit log; the effective state always comes from the engine (buildRuleSet), never from here.
import { useRef, useState } from 'react';
import { AI_ROLE } from '@engine/rules';
import type { AuditEntry, EffectiveRule, QuestionState } from '@engine/types';
import { publishedIds, questionDecisionPublished } from '../../lib/audit';
import { History, levelWords, ReviewForm, ruleValue } from '../Drawer';
import { Chip, dateFmt, Ev } from '../ui';
import { AiTag, ConfirmationLine, LocalTag, Seal, TrustMark, type TrustKind } from './marks';
import { isLocal, lastDecisionOf } from './reviewlog';

export type AddEntry = (e: Omit<AuditEntry, 'id' | 'at'>) => { ok: boolean; problems: string[] };

const TYPE_WORDS: Record<string, string> = {
  detached: 'detached houses',
  two: 'two-unit houses',
  three: 'three-unit houses',
  row: 'rowhouses',
  row_end: 'rowhouse end units',
  '*': 'every building type',
};

export function ruleTrust(r: EffectiveRule): 'ink' | 'pencil' | 'struck' {
  return r.state;
}

export function ruleKind(r: EffectiveRule): TrustKind {
  return r.state === 'struck' ? 'struck' : r.sealed ? 'sealed' : r.state;
}

function originWords(r: EffectiveRule): { label: string; detail: string | null } {
  if (r.origin === 'answer_key') return { label: 'Answer key', detail: null };
  const who = r.model ? `proposed by ${r.model}` : 'proposed by the model';
  return { label: 'Model', detail: r.prompt_sha ? `${who} · prompt ${String(r.prompt_sha).slice(0, 8)}` : who };
}

/** The verbatim quote, with the saved text's table-cell separators drawn as light rules. */
export function Quote({ text }: { text: string }) {
  const parts = text.split(' | ');
  return (
    <>
      “
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="rv-pipe"> | </span>}
          {p}
        </span>
      ))}
      ”
    </>
  );
}

export function ReviewCard({
  r,
  active,
  onLocate,
  add,
  located,
}: {
  r: EffectiveRule;
  active: boolean;
  onLocate: () => void;
  add: AddEntry;
  located: boolean; // the quote was found in the text on the left
}) {
  const [form, setForm] = useState<null | 'sign' | 'strike' | 'confirm'>(null);
  const card = useRef<HTMLElement>(null);
  const lv = levelWords(r);
  const v = r.verification;
  const kind = ruleKind(r);
  const ambiguous = !!r.question_for_city && !r.sealed;
  // Signing checks that the value matches the quoted text. A question for the City stays open either way;
  // only a recorded City answer settles what a conditional or ambiguous clause means.
  const canSign = r.state !== 'struck' && (r.state !== 'ink' || r.ai_checked || v.role === AI_ROLE);
  const done = () => {
    setForm(null);
    requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
  };
  const types = r.applies_to.map((t) => TYPE_WORDS[t] ?? t).join(', ');
  // A decision saved only in this browser keeps its trust state, but is marked until it is published.
  const last = lastDecisionOf(r);
  const local = isLocal(last, publishedIds()) ? last : null;
  const confirmedBy = [...r.history].reverse().find((e) => e.action === 'city_confirmed') ?? null;
  return (
    <article
      ref={card}
      tabIndex={-1}
      id={`rv-card-${r.id}`}
      className={`rv-card is-${kind} ${active ? 'is-active' : ''}`}
      data-rule-id={r.id}
      data-trust={ruleTrust(r)}
      data-level={v.level}
      data-dagger={r.dagger ? '1' : undefined}
      data-ai-checked={r.ai_checked ? '1' : undefined}
      data-sealed={r.sealed ? '1' : undefined}
      data-local={local ? '1' : undefined}
    >
      <div className="rv-card-head">
        <TrustMark kind={kind} label={lv.text} />
        <p className={`rv-value ${r.value == null ? 'is-text' : ''}`}>
          <Ev trust={lv.trust}>{ruleValue(r)}</Ev>
          {r.sealed && <Seal title={`City-confirmed: ${v.reference?.who ?? ''} ${v.reference?.date ?? ''}`} />}
          {r.dagger && (
            <span className="rv-dagger" title="† in the research notes: not yet checked by a person">
              †
            </span>
          )}
        </p>
        <button type="button" className="rv-locate" onClick={onLocate} aria-label={`Show the quote for this rule in §${r.section}`} disabled={!located}>
          <Chip trust={r.state === 'ink' ? 'ink' : 'pencil'}>§{r.section}</Chip>
        </button>
      </div>
      <p className="rv-origin">
        <span className="label">{originWords(r).label}</span>
        {originWords(r).detail && <span>{originWords(r).detail}</span>}
        <span className="rv-applies">
          {r.district === '*' ? 'All districts' : r.district} · {types}
        </span>
      </p>
      {r.condition && r.value != null && <p className="small rv-cond">{r.condition}</p>}
      <blockquote className={`rv-quote ${r.state === 'struck' ? 'is-struck' : ''}`}>
        <Quote text={r.quote} />
      </blockquote>
      {r.quote_status === 'failed' ? (
        <p className="warn">Not found word for word in §{r.section} of the saved text. It stays pencil until the quote matches.</p>
      ) : !located ? (
        <p className="warn">The quote is in the file but not where §{r.section} is. Check the citation.</p>
      ) : null}
      <div className={`rv-level v-${lv.trust}`}>
        <p>
          {lv.text}
          {r.ai_checked && <AiTag />}
          {local && <LocalTag action={local.action} />}
        </p>
        {v.reviewer && (
          <p className="small">
            {v.reviewer} ({v.role}) · {dateFmt(v.at)}
            {v.note ? ` · “${v.note}”` : ''}
          </p>
        )}
        {r.sealed && v.reference && (
          <p className="small">
            Reference: <ConfirmationLine reference={v.reference} recorder={v.reviewer} published={!!confirmedBy && !isLocal(confirmedBy, publishedIds())} />
          </p>
        )}
      </div>
      {r.question_for_city && (
        <p className="rv-qfc">
          <span className="label">Question for the City</span> {r.question_for_city}
        </p>
      )}
      {ambiguous && !form && <p className="small muted">Signing checks that the value matches the text. The question for the City stays open, and stays in the letter, until you record the City’s answer.</p>}
      {!form && (
        <div className="form-actions">
          {canSign && (
            <button type="button" className="btn btn-ink" onClick={() => setForm('sign')}>
              Sign as source-checked
            </button>
          )}
          {ambiguous && (
            <button type="button" className="btn btn-ink" onClick={() => setForm('confirm')}>
              Record City confirmation
            </button>
          )}
          {r.state !== 'struck' && (
            <button type="button" className="btn" onClick={() => setForm('strike')}>
              Strike
            </button>
          )}
        </div>
      )}
      {form && (
        <ReviewForm
          kind={form}
          onCancel={() => setForm(null)}
          onSubmit={(x) => {
            const cityNo = form === 'confirm' && x.choice === 'no';
            const res = add({
              rule_id: r.id,
              question_id: null,
              reviewer: x.name,
              role: x.role,
              action: form === 'sign' ? 'source_checked' : form === 'strike' || cityNo ? 'struck' : 'city_confirmed',
              quote: r.quote,
              decision: form === 'sign' ? 'matches the quoted text' : form === 'strike' ? 'does not match' : cityNo ? 'the City says this reading is wrong' : 'the City confirms this reading',
              reason: x.reason,
              choice: null,
              reference: form === 'confirm' ? x.ref ?? null : null,
            });
            if (res.ok) done();
            return res.problems;
          }}
        />
      )}
      {r.history.length > 0 && (
        <details className="rv-hist">
          <summary>
            History · {r.history.length} {r.history.length === 1 ? 'entry' : 'entries'}
          </summary>
          <History list={r.history} />
        </details>
      )}
    </article>
  );
}

export function questionTrust(q: QuestionState): 'pencil' | 'red' | 'ink' {
  return q.status === 'open' ? 'pencil' : q.status === 'assumed' ? 'red' : 'ink';
}

export function QuestionCard({ q, active, onLocate, add, located }: { q: QuestionState; active: boolean; onLocate: () => void; add: AddEntry; located: boolean }) {
  const [form, setForm] = useState<null | 'assume-yes' | 'assume-no' | 'confirm'>(null);
  const card = useRef<HTMLElement>(null);
  const t = questionTrust(q);
  const kind: TrustKind = q.status === 'city_confirmed' ? 'sealed' : t;
  return (
    <article
      ref={card}
      tabIndex={-1}
      id={`rv-card-q:${q.question.id}`}
      className={`rv-card rv-question is-${kind} ${active ? 'is-active' : ''}`}
      data-question-id={q.question.id}
      data-trust={t}
    >
      <div className="rv-card-head">
        <TrustMark kind={kind} label={q.status === 'open' ? 'open question' : q.status} />
        <p className="rv-value rv-qtext">
          <Ev trust={t}>{q.question.question}</Ev>
        </p>
        <button type="button" className="rv-locate" onClick={onLocate} aria-label={`Show the clause in §${q.question.section}`} disabled={!located}>
          <Chip trust="pencil">§{q.question.section}</Chip>
        </button>
      </div>
      <p className="rv-origin">
        <span className="label">Open question · ask the {q.question.ask}</span>
        <span className="rv-applies">affects {q.question.affects.join(', ')}</span>
      </p>
      <blockquote className="rv-quote">
        <Quote text={q.question.quote} />
      </blockquote>
      <div className={`rv-level v-${t}`}>
        {q.status === 'open' && <p>Open. Only the City can settle what this clause means. Until it does, the range stays open and the inquiry asks it.</p>}
        {q.status === 'assumed' && (
          <p>
            Assumed <strong>{q.choice}</strong> by {q.by} ({q.role}){q.at ? `, ${dateFmt(q.at)}` : ''}. Red: an assumption to explore the outcome, not an answer.
          </p>
        )}
        {q.status === 'city_confirmed' && (
          <p>
            <Seal /> City-confirmed <strong>{q.choice}</strong>: <ConfirmationLine reference={q.reference} recorder={q.by} published={questionDecisionPublished(q.question.id, q.at, q.by)} />
          </p>
        )}
      </div>
      {!form && (
        <div className="form-actions">
          <button type="button" className="btn btn-red" onClick={() => setForm('assume-yes')}>
            Assume yes
          </button>
          <button type="button" className="btn btn-red" onClick={() => setForm('assume-no')}>
            Assume no
          </button>
          <button type="button" className="btn btn-ink" onClick={() => setForm('confirm')}>
            Record City confirmation
          </button>
        </div>
      )}
      {form && (
        <ReviewForm
          kind={form}
          onCancel={() => setForm(null)}
          onSubmit={(x) => {
            const choice = form === 'confirm' ? x.choice! : form === 'assume-yes' ? 'yes' : 'no';
            const res = add({
              rule_id: null,
              question_id: q.question.id,
              reviewer: x.name,
              role: x.role,
              action: form === 'confirm' ? 'city_confirmed' : 'assumed',
              quote: q.question.quote,
              decision: form === 'confirm' ? `City says ${choice}` : `assume ${choice}`,
              reason: x.reason,
              choice,
              reference: form === 'confirm' ? x.ref! : null,
            });
            if (res.ok) {
              setForm(null);
              requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
            }
            return res.problems;
          }}
        />
      )}
    </article>
  );
}
