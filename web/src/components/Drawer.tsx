// The evidence drawer: every number opens here, with the quote or record it came from.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { findQuote, locateSection } from '@engine/source';
import { AI_ROLE } from '@engine/rules';
import type { AuditEntry, BlockFile, EffectiveRule, LotResult, MoneyResult, QuestionState, RuleSet, Trust } from '@engine/types';
import { publishedIds, questionDecisionPublished } from '../lib/audit';
import { ASSUMPTIONS, COMPS_BY_WARD, COMPS_RAW_BY_WARD, HUD, codeFor } from '../lib/data';
import { fieldLabels, formProblems, type FieldId, type FormKind } from './review/formcheck';
import { AiTag, ConfirmationLine, LocalTag } from './review/marks';
import { composeReference, isLocal, lastDecisionOf, REFERENCE_KINDS, type ReferenceKind } from './review/reviewlog';
import { dateFmt, Ev, ftFmt, Label, money1 } from './ui';

type AddAudit = (e: Omit<AuditEntry, 'id' | 'at'>) => { ok: boolean; problems: string[] };

interface Props {
  refId: string | null;
  onClose: () => void;
  block: BlockFile;
  rs: RuleSet;
  result: LotResult | null;
  money: MoneyResult | null;
  addAudit: AddAudit;
  setProposal?: (k: 'w' | 'd' | 'st' | 'h', v: number) => void;
  present: boolean;
}

const FIELD: Record<string, string> = {
  min_lot_area: 'Minimum lot size',
  front_setback: 'Front setback',
  rear_setback: 'Rear setback',
  side_setback_interior: 'Interior side setback',
  side_setback_exterior: 'Exterior (street) side setback',
  party_wall_side: 'Party-wall side setback',
  contextual_side: 'Contextual side setback',
  contextual_rear: 'Contextual rear setback',
  narrow_lot_side_table: 'Narrow-lot side yards',
  max_height_ft: 'Maximum height',
  max_stories: 'Maximum stories',
  grading_review: 'Grading on steep slopes',
  lot_of_record: 'Lot of record',
};
export function fieldName(f: string): string {
  if (FIELD[f]) return FIELD[f];
  const m = f.match(/^(use|parking)_(.*)$/);
  if (m) return `${m[1] === 'use' ? 'Use permission' : 'Parking minimum'}: ${({ detached: 'detached house', two: 'two-unit house', row: 'rowhouse', three: 'three-unit house' } as Record<string, string>)[m[2]] ?? m[2]}`;
  return f.replaceAll('_', ' ');
}

export function ruleValue(r: EffectiveRule): string {
  if (Array.isArray(r.value)) {
    const last = r.value[r.value.length - 1];
    return `table by lot width; ${last.max_width} ft and below: ${last.interior} ft interior, ${last.streetside} ft street side`;
  }
  if (r.value == null) return r.condition ?? '—';
  if (r.field === 'contextual_side') return `not below ${r.value} ft, and only next to a built lot; district setback when neighbors are vacant`;
  if (r.unit === 'use') return ({ P: 'permitted by right', S: 'special exception', SPR: 'Site Plan Review', N: 'not permitted' } as Record<string, string>)[String(r.value)] ?? String(r.value);
  if (r.unit === 'sf') return `${Number(r.value).toLocaleString('en-US')} sf`;
  if (r.unit === 'spaces_per_unit') return `${r.value} per unit`;
  return `${r.value} ${r.unit === 'stories' ? 'stories' : r.unit}`;
}

export function Excerpt({ file, section, quote }: { file: string; section: string; quote: string }) {
  const box = useRef<HTMLQuoteElement>(null);
  useEffect(() => {
    const m = box.current?.querySelector('mark');
    if (m && box.current) box.current.scrollTop = Math.max(0, (m as HTMLElement).offsetTop - box.current.offsetTop - 40);
  }, [file, section, quote]);
  const text = codeFor(file);
  if (!text) return <p className="muted">Source text not bundled.</p>;
  const span = locateSection(text, section);
  const q = findQuote(text, quote, span ?? undefined) ?? findQuote(text, quote);
  if (!q) return <p className="warn">The quote was not found in the saved text. Treat this rule as unverified.</p>;
  let lo = Math.max(span?.start ?? 0, q.start - 320);
  const nl = text.lastIndexOf('\n', q.start);
  if (nl > lo && q.start - nl < 320) lo = nl + 1;
  else while (lo > (span?.start ?? 0) && /\S/.test(text[lo - 1])) lo--;
  const hi = Math.min(span?.end ?? text.length, q.end + 320);
  const tidy = (s: string) => s.replace(/\n\s*\n+/g, '\n').replace(/ \| \n/g, ' | ');
  return (
    <blockquote className="excerpt" ref={box}>
      {lo > (span?.start ?? 0) ? '… ' : ''}
      {tidy(text.slice(lo, q.start))}
      <mark>{tidy(text.slice(q.start, q.end))}</mark>
      {tidy(text.slice(q.end, hi))}
      {hi < (span?.end ?? text.length) ? ' …' : ''}
    </blockquote>
  );
}

function useReviewer(): [{ name: string; role: string }, (v: { name: string; role: string }) => void] {
  const [v, setV] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('lot24x100.reviewer') ?? '') as { name: string; role: string };
    } catch {
      return { name: '', role: '' };
    }
  });
  const save = (x: { name: string; role: string }) => {
    setV(x);
    try {
      window.localStorage.setItem('lot24x100.reviewer', JSON.stringify(x));
    } catch {
      /* ignore */
    }
  };
  return [v, save];
}

const KIND_WORDS: Record<ReferenceKind, string> = { letter: 'Letter', email: 'Email', case: 'Case number', ticket: 'Ticket number' };

export function ReviewForm({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: FormKind;
  onSubmit: (x: { name: string; role: string; reason: string; ref?: { text: string; date: string; who: string }; choice?: 'yes' | 'no' }) => string[];
  onCancel: () => void;
}) {
  const [who, setWho] = useReviewer();
  const [reason, setReason] = useState(kind.startsWith('assume') ? 'Exploring the outcome; not a City answer.' : '');
  const [refKind, setRefKind] = useState<ReferenceKind | ''>('');
  const [refDetail, setRefDetail] = useState('');
  const [refDate, setRefDate] = useState('');
  const [refWho, setRefWho] = useState('Zoning Administrator');
  const [choice, setChoice] = useState<'yes' | 'no'>('yes');
  const [problems, setProblems] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const uid = useId();
  useEffect(() => first.current?.focus(), []);
  const title = { sign: 'Sign as source-checked', strike: 'Strike this rule', 'assume-yes': 'Assume yes (red)', 'assume-no': 'Assume no (red)', confirm: 'Record City confirmation' }[kind];
  const values = { name: who.name, role: who.role, reason, refKind, refDetail, refDate, refWho };
  // Errors appear after the first attempt to save, and then follow the fields as they are filled in.
  const errors = tried ? formProblems(kind, values) : {};
  const L = fieldLabels(kind, refKind);
  const errId = (f: FieldId) => `${uid}-${f}-err`;
  const inv = (f: FieldId) => (errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': errId(f) } : {});
  const err = (f: FieldId) =>
    errors[f] ? (
      <p className="field-error" id={errId(f)}>
        {errors[f]}
      </p>
    ) : null;
  const missing = Object.keys(errors) as FieldId[];
  return (
    <form
      className="review-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setTried(true);
        if (Object.keys(formProblems(kind, values)).length) {
          setProblems([]);
          requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
          return;
        }
        const ref = kind === 'confirm' && refKind ? { text: composeReference(refKind, refDetail), date: refDate, who: refWho.trim() } : undefined;
        const p = onSubmit({ name: who.name.trim(), role: who.role.trim(), reason: reason.trim(), ref, choice: kind === 'confirm' ? choice : undefined });
        setProblems(p);
      }}
    >
      <Label as="h3">{title}</Label>
      {kind === 'sign' && <p className="small">Source-checked means: the rule matches the quoted text. It is not a City interpretation.</p>}
      {kind.startsWith('assume') && <p className="small red">An assumption lets you explore the outcome. It stays red, the verdict keeps the open question, and the letter still asks the City.</p>}
      {kind === 'confirm' && (
        <p className="small">Record only an answer the City gave in writing or on file: a letter, an email, or a case or ticket number. It is saved in this browser under your name; 24×100 does not check it with the City.</p>
      )}
      <div className="form-row">
        <div className="field">
          <label>
            Name
            <input ref={first} value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} autoComplete="name" required {...inv('name')} />
          </label>
          {err('name')}
        </div>
        <div className="field">
          <label>
            Role
            <input value={who.role} onChange={(e) => setWho({ ...who, role: e.target.value })} placeholder="e.g. Housing lead" required {...inv('role')} />
          </label>
          {err('role')}
        </div>
      </div>
      {kind === 'confirm' && (
        <>
          <fieldset className="choice">
            <legend>The City's answer</legend>
            <label>
              <input type="radio" checked={choice === 'yes'} onChange={() => setChoice('yes')} /> Yes
            </label>
            <label>
              <input type="radio" checked={choice === 'no'} onChange={() => setChoice('no')} /> No
            </label>
          </fieldset>
          <fieldset className="choice ref-kind" {...(errors.refKind ? { 'aria-describedby': errId('refKind') } : {})}>
            <legend>{L.refKind}</legend>
            {(Object.keys(REFERENCE_KINDS) as ReferenceKind[]).map((k) => (
              <label key={k}>
                <input type="radio" name={`${uid}-kind`} checked={refKind === k} onChange={() => setRefKind(k)} {...(errors.refKind ? { 'aria-invalid': true as const } : {})} /> {KIND_WORDS[k]}
              </label>
            ))}
          </fieldset>
          {err('refKind')}
          <div className="form-row">
            <div className="field">
              <label>
                {L.refDetail}
                <input
                  value={refDetail}
                  onChange={(e) => setRefDetail(e.target.value)}
                  required
                  placeholder={refKind === 'case' || refKind === 'ticket' ? 'e.g. ZBA 2026-0412' : 'e.g. Re: narrow-lot side yards'}
                  {...inv('refDetail')}
                />
              </label>
              {err('refDetail')}
            </div>
            <div className="field">
              <label>
                {L.refDate}
                <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} required {...inv('refDate')} />
              </label>
              {err('refDate')}
            </div>
          </div>
          <div className="field">
            <label>
              {L.refWho}
              <input value={refWho} onChange={(e) => setRefWho(e.target.value)} required {...inv('refWho')} />
            </label>
            {err('refWho')}
          </div>
        </>
      )}
      <div className="field">
        <label>
          {L.reason}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required placeholder={kind === 'sign' ? 'e.g. compared with the §903.03.C table row' : ''} {...inv('reason')} />
        </label>
        {err('reason')}
      </div>
      {missing.length > 0 && (
        <p className="warn" role="alert">
          Not saved. Check: {missing.map((f) => L[f].replace(/\?$/, '')).join(', ')}.
        </p>
      )}
      {problems.length > 0 && (
        <p className="warn" role="alert">
          Not saved: {problems.join('; ')}.
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-ink">
          {title}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="small muted">Saved in this browser's review log with the time, and marked "not published" until your steward publishes it: use "Send to the steward" on the review screen.</p>
    </form>
  );
}

/** Whether a log entry is saved only in this browser (not in data/rules/reviews.json). */
function localEntry(e: AuditEntry): boolean {
  return isLocal(e, publishedIds());
}

export function History({ list }: { list: AuditEntry[] }) {
  if (!list.length) return null;
  return (
    <div className="history">
      <Label>Review log</Label>
      <ol>
        {[...list].reverse().map((e) => (
          <li key={e.id}>
            <span className="h-when">{dateFmt(e.at)}</span> <strong>{e.reviewer}</strong> <span className="muted">({e.role})</span> · {e.action.replace('_', ' ')}
            {e.choice ? ` ${e.choice}` : ''}: {e.reason}
            {e.reference ? (
              <>
                {' · '}
                <ConfirmationLine reference={e.reference} recorder={e.reviewer} published={!localEntry(e)} />
              </>
            ) : null}
            {localEntry(e) && !e.reference ? <span className="muted"> · in this browser, not published</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Where the answer key comes from. Its in-app verification (an AI research pass, or a person's
 *  signature) is shown separately, from the engine. */
export const ANSWER_KEY_WORDS = 'answer key from the team’s research notes (checked against the code text by a person on the team)';

export function levelWords(r: EffectiveRule): { trust: Trust | 'struck'; text: string } {
  if (r.state === 'struck') return { trust: 'struck', text: 'Struck by a reviewer. Not used.' };
  if (r.sealed) return { trust: 'ink', text: 'City-confirmed.' };
  if (r.state === 'ink') return { trust: 'ink', text: r.ai_checked ? 'Source-checked by an AI agent. A teammate should re-check it.' : 'Source-checked by a named person.' };
  if (r.dagger) return { trust: 'pencil', text: 'Pencil: read by an AI and not yet checked by a person (†).' };
  return { trust: 'pencil', text: 'Pencil: proposed by the model, not reviewed. It does not count as ink yet.' };
}

export function RuleCard({ r, rs, addAudit }: { r: EffectiveRule; rs: RuleSet; addAudit: AddAudit }) {
  const [form, setForm] = useState<null | 'sign' | 'strike'>(null);
  const lv = levelWords(r);
  const v = r.verification;
  const q = rs.questions.find((x) => x.question.affects.includes(r.id));
  const last = lastDecisionOf(r);
  const confirmedBy = [...r.history].reverse().find((e) => e.action === 'city_confirmed') ?? null;
  return (
    <article className="card" data-rule-id={r.id} data-trust={r.state} data-ai-checked={r.ai_checked ? '1' : undefined} data-local={last && localEntry(last) ? '1' : undefined}>
      <Label>
        {fieldName(r.field)} · {r.district === '*' ? 'all districts' : r.district}
      </Label>
      <p className="card-value">
        <Ev trust={lv.trust}>{ruleValue(r)}</Ev>
      </p>
      {r.condition && <p className="small">{r.condition}</p>}
      <p className="small">
        <strong>§{r.section}</strong> · saved text of{' '}
        <a href={r.source_url} target="_blank" rel="noreferrer">
          ecode360
        </a>
        , retrieved {r.retrieved ?? '2026-09-26'}
        {r.origin === 'extracted' && r.model ? ` · proposed by ${r.model} (prompt ${String(r.prompt_sha).slice(0, 8)})` : r.origin === 'answer_key' ? ` · ${ANSWER_KEY_WORDS}` : ''}
      </p>
      <Excerpt file={r.source_file} section={r.section} quote={r.quote} />
      <div className={`verification v-${lv.trust}`}>
        <p>
          {lv.text}
          {r.ai_checked && <AiTag />}
          {last && localEntry(last) && <LocalTag action={last.action} />}
        </p>
        {v.reviewer && (
          <p className="small">
            {v.reviewer} ({v.role}) · {dateFmt(v.at)}
            {v.note ? ` · “${v.note}”` : ''}
          </p>
        )}
        {r.sealed && v.reference && (
          <p className="small">
            Reference: <ConfirmationLine reference={v.reference} recorder={v.reviewer} published={!!confirmedBy && !localEntry(confirmedBy)} />
          </p>
        )}
      </div>
      {q && (
        <p className="small pencil-note">
          Open question: {q.question.question}
        </p>
      )}
      {r.question_for_city && (
        <p className="small pencil-note">
          Question for the City: {r.question_for_city} Signing checks the value against the text; this question stays open, and in the letter, until the City answers.
        </p>
      )}
      {!form && (
        <div className="form-actions">
          {r.question_for_city && !r.sealed && r.state !== 'struck' && (
            <a className="btn" href={`?view=review&district=${r.district === '*' ? 'RM-M' : r.district}&section=${r.id}`}>
              Record the City’s answer
            </a>
          )}
          {(r.state !== 'ink' || r.ai_checked || v.role === AI_ROLE) && r.state !== 'struck' && (
            <button className="btn btn-ink" onClick={() => setForm('sign')}>
              Sign as source-checked
            </button>
          )}
          {r.state !== 'struck' && (
            <button className="btn" onClick={() => setForm('strike')}>
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
            const res = addAudit({ rule_id: r.id, question_id: null, reviewer: x.name, role: x.role, action: form === 'sign' ? 'source_checked' : 'struck', quote: r.quote, decision: form === 'sign' ? 'matches the quoted text' : 'does not match', reason: x.reason, choice: null, reference: null });
            if (res.ok) setForm(null);
            return res.problems;
          }}
        />
      )}
      <History list={r.history} />
    </article>
  );
}

export function QuestionCard({ q, addAudit }: { q: QuestionState; addAudit: AddAudit }) {
  const [form, setForm] = useState<null | 'assume-yes' | 'assume-no' | 'confirm'>(null);
  return (
    <article className="card" data-question-id={q.question.id} data-trust={q.status === 'city_confirmed' ? 'ink' : q.status === 'assumed' ? 'red' : 'pencil'}>
      <Label>Open question · ask the {q.question.ask}</Label>
      <p className="card-q">{q.question.question}</p>
      <Excerpt file={q.question.source_file} section={q.question.section} quote={q.question.quote} />
      <div className={`verification v-${q.status === 'city_confirmed' ? 'ink' : q.status === 'assumed' ? 'red' : 'pencil'}`}>
        {q.status === 'open' && <p>Open. The range stays open and the inquiry asks it.</p>}
        {q.status === 'assumed' && (
          <p>
            Assumed <strong>{q.choice}</strong> by {q.by} ({q.role}). Red: an assumption, not an answer.
          </p>
        )}
        {q.status === 'city_confirmed' && (
          <p>
            City-confirmed <strong>{q.choice}</strong>: <ConfirmationLine reference={q.reference} recorder={q.by} published={questionDecisionPublished(q.question.id, q.at, q.by)} />
          </p>
        )}
      </div>
      {!form && (
        <div className="form-actions">
          <button className="btn btn-red" onClick={() => setForm('assume-yes')}>
            Assume yes
          </button>
          <button className="btn btn-red" onClick={() => setForm('assume-no')}>
            Assume no
          </button>
          <button className="btn btn-ink" onClick={() => setForm('confirm')}>
            Record City confirmation
          </button>
        </div>
      )}
      {form && (
        <ReviewForm
          kind={form}
          onCancel={() => setForm(null)}
          onSubmit={(x) => {
            const res = addAudit({
              rule_id: null,
              question_id: q.question.id,
              reviewer: x.name,
              role: x.role,
              action: form === 'confirm' ? 'city_confirmed' : 'assumed',
              quote: q.question.quote,
              decision: form === 'confirm' ? `City says ${x.choice}` : `assume ${form === 'assume-yes' ? 'yes' : 'no'}`,
              reason: x.reason,
              choice: form === 'confirm' ? x.choice! : form === 'assume-yes' ? 'yes' : 'no',
              reference: form === 'confirm' ? x.ref! : null,
            });
            if (res.ok) setForm(null);
            return res.problems;
          }}
        />
      )}
    </article>
  );
}

function RecordCard({ block, pin, field }: { block: BlockFile; pin: string; field: string }) {
  const p = block.parcels.find((x) => x.pin === pin);
  if (!p) return <p>Record not found.</p>;
  const src = (id: string) => block.meta.sources.find((s) => s.id.includes(id));
  const rows: [string, ReactNode, string][] = [];
  const a = p.assess;
  if (field === 'lotarea' || field === 'deed' || field === 'poly') {
    rows.push(['Assessed lot area', a?.lotarea != null ? `${a.lotarea.toLocaleString('en-US')} sf` : 'none', `County assessment · as of ${a?.asof ?? '—'}`]);
    rows.push(['Legal description', a?.legal ?? '—', 'County assessment (LEGAL1)']);
    rows.push(['Deed dimensions', p.deed ? `${p.deed.front} × ${p.deed.depth} ft = ${(p.deed.front * p.deed.depth).toLocaleString('en-US')} sf` : 'not in the legal text', 'parsed from LEGAL1']);
    rows.push(['Mapped area', `${Math.round(p.mapped_area).toLocaleString('en-US')} sf`, 'City parcel polygon (PGHParcels), measured in local feet']);
    rows.push(['Mapped ÷ assessed', p.recon.ratio != null ? `${p.recon.ratio.toFixed(2)}×` : '—', `tolerance ±${Math.round(block.meta.recon_tolerance * 100)}% (red, editable)`]);
  }
  if (field === 'city') {
    rows.push(['City inventory', p.city ? `${p.city.status} · ${p.city.inventory ?? ''}` : 'not in the City-Owned Properties list', 'WPRDC City-Owned Properties']);
    if (p.city?.status_updated) rows.push(['Status last updated', p.city.status_updated, 'from the same dataset; may be stale']);
    rows.push(['County owner type', a?.ownercat ?? '—', 'County assessment OWNERDESC (a category, never a name)']);
  }
  if (field === 'slope25') rows.push(['Share at 25%+ slope', `${Math.round(p.slope25 * 100)}%`, 'City slope layer (PGHWebSlope25), a derived threshold, not the steep-slope overlay']);
  if (field === 'undermined') rows.push(['Share undermined', `${Math.round(p.undermined * 100)}%`, 'City undermined-areas layer']);
  if (field === 'built') rows.push(['Built', p.built ? 'yes' : 'no (vacant)', `building footprints (2023) and the assessment${p.built_basis ? `: ${p.built_basis}` : ''}`]);
  const s1 = src('assess') ?? src('wprdc');
  return (
    <article className="card">
      <Label>Record · {p.addr} · lot {p.lot}{p.lot_suffix ?? ''}</Label>
      <p className="small">PIN {p.pin}</p>
      <table className="kv">
        <tbody>
          {rows.map(([k, v, s]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <Ev trust="ink">{v}</Ev>
                <div className="small muted">{s}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        Block file pulled {dateFmt(block.meta.pulled)}. {s1?.url ? <a href={s1.url}>Dataset</a> : null}
      </p>
    </article>
  );
}

function MeasureCard({ result, which, rs }: { result: LotResult; which: 'width' | 'depth'; rs: RuleSet }) {
  const m = which === 'width' ? result.width : result.depth;
  if (!m) return null;
  return (
    <article className="card">
      <Label>Buildable {which}, as of right</Label>
      <p className="card-value">
        <Ev trust={m.trust}>{m.formula}</Ev>
      </p>
      <table className="kv">
        <tbody>
          {m.terms.map((t, i) => (
            <tr key={i}>
              <th>{i === 0 ? '' : '−'} {t.label}</th>
              <td>{ftFmt(t.value)} ft</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Deed dimensions lead for rule checks; the City map measures {ftFmt(m.mapped)} ft (shape and drawing only).
      </p>
      <p className="small">Rules used: {[...new Set(m.rule_ids)].map((id) => rs.rules.find((r) => r.id === id)).filter(Boolean).map((r) => `${fieldName(r!.field)} §${r!.section}`).join('; ')}</p>
    </article>
  );
}

function ProposalCard({ result, setProposal }: { result: LotResult; setProposal?: Props['setProposal'] }) {
  const P = result.scenario.proposal;
  const fields: ['w' | 'd' | 'st' | 'h', string, number][] = [
    ['w', 'Width (ft)', P.width],
    ['d', 'Depth (ft)', P.depth],
    ['st', 'Stories', P.stories],
    ['h', 'Height (ft)', P.height],
  ];
  return (
    <article className="card">
      <Label>Your proposal (red)</Label>
      <p className="small">The building you want. Changing it changes the relief you would ask for, never the rules.</p>
      <div className="form-row wrap">
        {fields.map(([k, lab, v]) => (
          <label key={k} className="red">
            {lab}
            <input type="number" min={1} value={v} onChange={(e) => setProposal?.(k, Number(e.target.value))} />
          </label>
        ))}
      </div>
      <p className="small">{P.home_sqft.toLocaleString('en-US')} sf per home (from the template, red).</p>
    </article>
  );
}

function MoneyCard({ kind, money }: { kind: string; money: MoneyResult | null }) {
  const ward = money?.comps.ward ?? 5;
  const COMPS = COMPS_BY_WARD[ward] ?? null;
  const COMPS_RAW = COMPS_RAW_BY_WARD[ward];
  if (kind === 'comps' && COMPS && COMPS_RAW) {
    return (
      <article className="card">
        <Label>Comparable sales · Ward {ward} · since 2023</Label>
        <p className="card-value">
          <Ev trust="ink">
            {COMPS.counts.valid_1_2_unit} valid 1–2 unit sales · median {money1(COMPS.median)} · IQR {money1(COMPS.q1)}–{money1(COMPS.q3)}
          </Ev>
        </p>
        <p className="small">
          WPRDC Allegheny County real-estate sales (CC0), valid sales ≥ $10,000, joined to assessments for single-family, rowhouse, townhouse and two-family homes. Pulled {dateFmt(COMPS.meta.pulled)}. Quartiles: {COMPS.quantile_method ?? 'inclusive'} method.
        </p>
        <p className="small">{(COMPS_RAW.counts as unknown as { note?: string }).note}</p>
        <table className="kv compact">
          <tbody>
            {COMPS.newest.slice(0, 3).map((n) => (
              <tr key={n.addr}>
                <th>
                  {n.addr} <span className="muted">built {n.yearbuilt}</span>
                </th>
                <td>
                  {money1(n.price)} · {n.sqft?.toLocaleString('en-US')} sf · {n.saledate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {money?.comps.thin && <p className="warn">Thin market: fewer sales than your threshold. Treat the median as shaky.</p>}
        <p className="small">The median is mostly older homes. It is not an appraisal, and not what a new build would appraise at.</p>
      </article>
    );
  }
  if (kind === 'hud' && HUD) {
    return (
      <article className="card">
        <Label>HUD FY2026 income limits · {HUD.area_name}</Label>
        <p className="card-value">
          <Ev trust="ink">Median family income {money1(HUD.median)}; 80% limit for 3 people {money1(HUD.l80[2])}</Ev>
        </p>
        <p className="small">
          Source: <a href={HUD.source_url}>{HUD.source_url}</a>
        </p>
        {money && <p className="small red">Affordable price at 80% AMI uses your assumptions: {money.affordable.formula}.</p>}
      </article>
    );
  }
  if (kind.startsWith('assumption')) {
    return (
      <article className="card" data-assumptions="1">
        <Label>Assumptions behind the money (red)</Label>
        <p className="small">
          These are ours (the 24×100 team’s placeholders and conventions, and practitioners’ estimates), not settings you can change here. To change one, edit <code>data/assumptions.json</code> and rebuild; the app doesn’t edit them yet.
        </p>
        <table className="kv compact">
          <tbody>
            {ASSUMPTIONS.map((a) => (
              <tr key={a.key}>
                <th className="red">{a.label}</th>
                <td>
                  <span className="red">{Array.isArray(a.value) ? `${a.value[0]}–${a.value[1]}` : a.value}</span> {a.unit}
                  <div className="small muted">
                    {a.supplied_by} ({a.role}). {a.note}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    );
  }
  if ((kind.startsWith('estimate') || kind === 'sitework') && money) {
    const e = money.estimates.find((x) => x.id === kind.split(':')[1]) ?? money.estimates.find((x) => x.default)!;
    return (
      <article className="card">
        <Label>{kind === 'sitework' ? 'Site work, single unit · practitioner estimate' : `${e.label} · practitioner estimate`}</Label>
        {kind === 'sitework' ? (
          <>
            <p className="card-value">
              <Ev trust="estimate">
                {money1(money.site_work.lo)}–{money1(money.site_work.hi)}
              </Ev>
            </p>
            <p className="small">{money.site_work.note}</p>
            <p className="small">Supplied by {money.site_work.supplied_by}.</p>
          </>
        ) : (
          <>
            <p className="card-value">
              <Ev trust="estimate">{e.formula}</Ev>
            </p>
            <p className="small">
              {e.note} Supplied by {e.supplied_by}. An estimate from one practitioner, not a published benchmark; costs vary a lot with builder size, and the production-builder line is speculative, never averaged in.
            </p>
            <p className="small">
              What’s left is the newest new-build sale ({money.new_build ? money1(money.new_build.value) : '—'}; one sale; may be price-restricted) minus vertical construction. Site work, soft costs and land have to come out of it.
            </p>
          </>
        )}
        <p className="small">To check the costs: a builder’s price, or {money.source_leads.join(', ')}. We have not checked these.</p>
        <p className="small red">With your assumptions: {money.with_assumptions.formula}.</p>
      </article>
    );
  }
  return <p>Nothing to show.</p>;
}

export function Drawer(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.refId) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [p.refId]);
  if (!p.refId) return null;
  const [kind, ...rest] = p.refId.split(':');
  const arg = rest.join(':');
  let body: ReactNode = <p>Nothing to show.</p>;
  if (kind === 'rule') {
    const r = p.rs.rules.find((x) => x.id === arg);
    body = r ? <RuleCard r={r} rs={p.rs} addAudit={p.addAudit} /> : <p>This rule is not loaded for {p.rs.district}.</p>;
  } else if (kind === 'question') {
    const q = p.rs.questions.find((x) => x.question.id === arg);
    body = q ? <QuestionCard q={q} addAudit={p.addAudit} /> : <p>Question not found.</p>;
  } else if (kind === 'record') {
    const [pin, field] = arg.split(':');
    body = <RecordCard block={p.block} pin={pin} field={field} />;
  } else if (kind === 'measure' && p.result) {
    body = <MeasureCard result={p.result} which={arg as 'width' | 'depth'} rs={p.rs} />;
  } else if (kind === 'proposal' && p.result) {
    body = <ProposalCard result={p.result} setProposal={p.setProposal} />;
  } else if (kind === 'money') {
    body = <MoneyCard kind={arg} money={p.money} />;
  }
  return (
    <>
      <div className="drawer-scrim" onClick={p.onClose} aria-hidden="true" />
      <aside className={`drawer ${p.present ? 'is-present' : ''}`} role="dialog" aria-modal="true" aria-label="Evidence" tabIndex={-1} ref={ref}>
        <header className="drawer-head">
          <Label as="h2">Evidence</Label>
          <button className="btn btn-quiet" onClick={p.onClose} aria-label="Close evidence">
            Close ✕
          </button>
        </header>
        <div className="drawer-body">{body}</div>
      </aside>
    </>
  );
}
