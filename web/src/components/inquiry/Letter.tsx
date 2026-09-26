// One draft letter to one office, on a sheet; and the sender's checklist, which is never sent. Facts
// are ink with their citations; questions are pencil; our proposal and assumptions are red and labeled;
// practitioner estimates are violet; set-aside rules are struck. Rendering only: every sentence comes
// from the engine (buildInquiry).
import { FROM_PLACEHOLDER, type InquiryItem, type InquiryLetter, type InquirySection } from '@engine/inquiry';
import type { EffectiveRule, LotResult, RuleSet } from '@engine/types';
import { Chip, dateFmt, Ev, Label } from '../ui';
import { TrustMark } from '../review/marks';

const SEC = /^§\s?(\d{3}\.\d{2}(?:\.[A-Za-z0-9]+)*(?:\([a-z0-9]+\))*)$/;

function usedRuleIds(r: LotResult): Set<string> {
  const ids = new Set<string>();
  for (const m of [r.width, r.depth]) m?.rule_ids.forEach((id) => ids.add(id));
  for (const c of r.checks) c.rule_ids.forEach((id) => ids.add(id));
  for (const u of r.units) u.width.rule_ids.forEach((id) => ids.add(id));
  return ids;
}

/** The rule a "§903.03.C" citation points at: one the result used, ink first, answer key first. */
function ruleForSection(sec: string, rs: RuleSet, used: Set<string>): EffectiveRule | undefined {
  const cands = rs.rules.filter((x) => x.section === sec && x.state !== 'struck');
  const rank = (x: EffectiveRule) => (used.has(x.id) ? 0 : 4) + (x.state === 'ink' ? 0 : 2) + (x.origin === 'answer_key' ? 0 : 1);
  return [...cands].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
}

/** The record a non-§ citation opens: the engine names it; older citations fall back to the first lot. */
function recordRef(it: InquiryItem, pin: string): string | undefined {
  if (it.ref) return it.ref;
  const cite = it.cite ?? '';
  if (/parcel map|legal description|deed/i.test(cite)) return `record:${pin}:lotarea`;
  if (/City-Owned Properties|County assessment/.test(cite)) return `record:${pin}:city`;
  if (/undermined/i.test(cite)) return `record:${pin}:undermined`;
  if (/slope/i.test(cite)) return `record:${pin}:slope25`;
  return undefined;
}

function Cites({ it, rs, used, pin }: { it: InquiryItem; rs: RuleSet; used: Set<string>; pin: string }) {
  const cite = it.cite!;
  const parts = cite.split(/,\s*/);
  if (!parts.every((p) => SEC.test(p))) {
    // A record citation takes the item's own state: only an ink fact gets an ink chip.
    const ref = recordRef(it, pin);
    return (
      <span className="iq-cites" data-record={ref}>
        <Chip refId={ref} trust={it.trust === 'ink' ? 'ink' : 'pencil'}>
          {cite}
        </Chip>
      </span>
    );
  }
  return (
    <span className="iq-cites">
      {parts.map((p) => {
        const sec = p.match(SEC)![1];
        const rule = ruleForSection(sec, rs, used);
        const trust = rule && rule.state === 'ink' ? 'ink' : 'pencil';
        return (
          <span key={p} className="iq-cite" data-rule-id={rule?.id} data-trust={rule ? rule.state : undefined}>
            <Chip refId={rule ? `rule:${rule.id}` : undefined} trust={trust}>
              §{sec}
            </Chip>
          </span>
        );
      })}
    </span>
  );
}

function Item({ it, sec, rs, used, pin }: { it: InquiryItem; sec: InquirySection; rs: RuleSet; used: Set<string>; pin: string }) {
  const na = sec.id === 'not_assessed';
  const muted = sec.id === 'struck' && it.trust !== 'struck'; // "Nothing struck yet."
  const kind = na || muted ? null : it.trust;
  const tag = it.trust === 'red' ? (sec.id === 'build' ? 'our proposal' : 'our assumption') : it.trust === 'struck' ? 'set aside' : it.trust === 'estimate' ? 'screening estimate' : null;
  return (
    <li className={`iq-item is-${na ? 'na' : muted ? 'none' : it.trust}`} data-trust={na || muted ? undefined : it.trust} data-section={sec.id}>
      <span className="iq-mark" aria-hidden="true">
        {kind ? <TrustMark kind={kind} label={it.trust} /> : na ? <span className="iq-dash">—</span> : null}
      </span>
      <span className="iq-text">
        {tag && <span className={`iq-tag iq-tag-${it.trust}`}>{tag}</span>}
        {na || muted ? <span className="muted">{it.text}</span> : <Ev trust={it.trust}>{it.text}</Ev>}
        {it.cite && (
          <>
            {' '}
            <Cites it={it} rs={rs} used={used} pin={pin} />
          </>
        )}
      </span>
    </li>
  );
}

const ORDERED = new Set<InquirySection['id']>(['questions', 'money', 'records', 'next']);

function Sections({ sections, result, rs, prefix }: { sections: InquirySection[]; result: LotResult; rs: RuleSet; prefix: string }) {
  const used = usedRuleIds(result);
  const pin = result.pins[0];
  return (
    <>
      {sections.map((sec) => {
        const List = ORDERED.has(sec.id) ? 'ol' : 'ul';
        const hid = `${prefix}-h-${sec.id}`;
        return (
          <section key={sec.id} className={`iq-sec iq-sec-${sec.id}`} aria-labelledby={hid} data-section={sec.id}>
            <h2 id={hid} className="iq-h">
              {sec.heading}
            </h2>
            {sec.items.length ? (
              <List className="iq-items">
                {sec.items.map((it, i) => (
                  <Item key={i} it={it} sec={sec} rs={rs} used={used} pin={pin} />
                ))}
              </List>
            ) : (
              <p className="iq-none">{sec.note ?? 'None.'}</p>
            )}
          </section>
        );
      })}
    </>
  );
}

export function Letter({ letter, result, rs }: { letter: InquiryLetter; result: LotResult; rs: RuleSet }) {
  return (
    <article className="iq-sheet" aria-labelledby="iq-title" data-office={letter.office}>
      <header className="iq-head">
        <div className="iq-stamp" aria-label="Draft. You send it; 24×100 never sends anything.">
          <span>Draft</span>
          <span className="iq-stamp-sub">you send it</span>
        </div>
        <Label>Draft letter · {letter.tab}</Label>
        <h1 id="iq-title" className="iq-title">
          {letter.subject}
        </h1>
        <dl className="iq-to">
          <dt className="label">To</dt>
          <dd>
            <strong>{letter.to}</strong>
          </dd>
          <dt className="label">From</dt>
          <dd className="red" data-trust="red">
            {FROM_PLACEHOLDER} <span className="small muted">(you fill this in; 24×100 never writes as anyone)</span>
          </dd>
          <dt className="label">Date</dt>
          <dd>{dateFmt(letter.date)}</dd>
        </dl>
      </header>
      <p className="iq-opening">{letter.opening}</p>
      <Sections sections={letter.sections} result={result} rs={rs} prefix="iq" />
      <footer className="iq-disc">
        <p>{letter.disclaimer}</p>
      </footer>
    </article>
  );
}

/** What the sender checks before and around sending: never part of a letter. */
export function Checklist({ sections, result, rs }: { sections: InquirySection[]; result: LotResult; rs: RuleSet }) {
  return (
    <aside className="iq-cover" aria-labelledby="iq-cover-h">
      <header className="iq-cover-head">
        <h2 id="iq-cover-h" className="iq-cover-title">
          Your checklist
        </h2>
        <span className="label">For you · not part of any letter · included in the full download</span>
      </header>
      <Sections sections={sections} result={result} rs={rs} prefix="iq-cover" />
    </aside>
  );
}
