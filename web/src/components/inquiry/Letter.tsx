// The inquiry as a one-page letter. Facts are ink with their citations; questions are pencil; our
// proposal and assumptions are red and labeled; set-aside rules are struck. Rendering only: every
// sentence comes from the memo model (engine inquiry, or the records memo for a refused lot).
import type { InquiryItem } from '@engine/inquiry';
import type { EffectiveRule, LotResult, RuleSet } from '@engine/types';
import { Chip, dateFmt, Ev, Label } from '../ui';
import { TrustMark } from '../review/marks';
import type { Memo, MemoSection } from './memo';

const SEC = /^§\s?(\d{3}\.\d{2}(?:\.[A-Za-z0-9]+)*(?:\([a-z0-9]+\))?)$/;

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

function recordRef(cite: string, pin: string): string | undefined {
  if (/City-Owned Properties|County assessment/.test(cite)) return `record:${pin}:city`;
  if (/undermined/i.test(cite)) return `record:${pin}:undermined`;
  if (/slope/i.test(cite)) return `record:${pin}:slope25`;
  return undefined;
}

function Cites({ cite, rs, used, pin, itemTrust }: { cite: string; rs: RuleSet; used: Set<string>; pin: string; itemTrust: string }) {
  const parts = cite.split(/,\s*/);
  if (!parts.every((p) => SEC.test(p))) {
    // A record citation takes the item's own state: only an ink fact gets an ink chip.
    const ref = recordRef(cite, pin);
    return (
      <span className="iq-cites" data-record={ref}>
        <Chip refId={ref} trust={itemTrust === 'ink' ? 'ink' : 'pencil'}>
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

function Item({ it, sec, rs, used, pin }: { it: InquiryItem; sec: MemoSection; rs: RuleSet; used: Set<string>; pin: string }) {
  const na = sec.id === 'not_assessed';
  const muted = sec.id === 'struck' && it.trust !== 'struck'; // "Nothing struck yet."
  const kind = na || muted ? null : it.trust;
  const tag = it.trust === 'red' ? (sec.id === 'build' ? 'our proposal' : 'our assumption') : it.trust === 'struck' ? 'set aside' : null;
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
            <Cites cite={it.cite} rs={rs} used={used} pin={pin} itemTrust={it.trust} />
          </>
        )}
      </span>
    </li>
  );
}

export function Letter({ memo, result, rs }: { memo: Memo; result: LotResult; rs: RuleSet }) {
  const used = usedRuleIds(result);
  const pin = result.pins[0];
  return (
    <article className="iq-sheet" aria-labelledby="iq-title">
      <header className="iq-head">
        <div className="iq-stamp" aria-label="Draft. You send it; 24×100 never sends anything.">
          <span>Draft</span>
          <span className="iq-stamp-sub">you send it</span>
        </div>
        <Label>Draft inquiry · {dateFmt(memo.date)}</Label>
        <h1 id="iq-title" className="iq-title">
          {memo.title}
        </h1>
        <p className="iq-sub">{memo.subtitle}</p>
        <div className="iq-to">
          <Label as="span" className="iq-to-h">
            To
          </Label>
          <ul>
            {memo.recipients.map((x) => (
              <li key={x.who}>
                <strong>{x.who}</strong> <span className="muted">· {x.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </header>
      {memo.sections.map((sec) => {
        const List = sec.id === 'questions' || sec.id === 'money' || sec.id === 'records' ? 'ol' : 'ul';
        return (
          <section key={sec.id} className={`iq-sec iq-sec-${sec.id}`} aria-labelledby={`iq-h-${sec.id}`} data-section={sec.id}>
            <h2 id={`iq-h-${sec.id}`} className="iq-h">
              {sec.heading}
            </h2>
            {sec.to && <p className="iq-for">For: {sec.to}</p>}
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
      <footer className="iq-disc">
        <p>{memo.disclaimer}</p>
      </footer>
    </article>
  );
}
