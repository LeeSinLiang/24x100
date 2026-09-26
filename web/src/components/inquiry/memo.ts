// The memo the inquiry screen shows and exports. For a scored lot it is the engine's inquiry exactly
// (buildInquiry). For a lot the engine refused to score, the memo becomes a records question: the
// zoning questions wait until the records agree. Text added here carries no quantities of its own
// (checked with the engine's numbersIn), so every number in the export still traces to the engine.
import { numbersIn, type Inquiry, type InquiryItem, type InquirySection } from '@engine/inquiry';
import type { BlockFile, LotResult } from '@engine/types';

export type MemoSection = Omit<InquirySection, 'id'> & { id: InquirySection['id'] | 'records'; note?: string };

export interface Memo {
  title: string;
  subtitle: string;
  date: string;
  recipients: { who: string; why: string }[];
  sections: MemoSection[];
  disclaimer: string;
  check: { ok: boolean; unknown: string[]; checked: number };
  markdown: string;
  text: string;
  refused: boolean;
}

/** Same line format as the engine's markdown, so both kinds of memo read alike. */
export function memoMarkdown(m: Pick<Memo, 'title' | 'subtitle' | 'recipients' | 'sections' | 'disclaimer'>): string {
  const lines: string[] = [`# ${m.title}`, m.subtitle, '', `To: ${m.recipients.map((x) => `${x.who} (${x.why})`).join('; ')}`, ''];
  for (const sec of m.sections) {
    lines.push(`## ${sec.heading}${sec.to ? ` (for ${sec.to})` : ''}`);
    if (!sec.items.length && sec.note) lines.push(sec.note);
    for (const it of sec.items) lines.push(`- ${it.trust === 'red' ? '[our assumption] ' : it.trust === 'pencil' ? '[open] ' : it.trust === 'struck' ? '[set aside] ' : ''}${it.text}${it.cite ? ` (${it.cite})` : ''}`);
    lines.push('');
  }
  lines.push(`_${m.disclaimer}_`);
  return lines.join('\n');
}

export function plainText(markdown: string): string {
  return markdown.replace(/^#+ /gm, '').replace(/_/g, '');
}

export function fromInquiry(inq: Inquiry): Memo {
  const sections: MemoSection[] = inq.sections.map((s) =>
    !s.items.length && s.id === 'questions' ? { ...s, note: 'No open code questions for this scenario.' } : s,
  );
  const noted = sections.some((s) => s.note);
  const markdown = noted ? memoMarkdown({ ...inq, sections }) : inq.markdown;
  return { ...inq, sections, markdown, text: noted ? plainText(markdown) : inq.text, refused: false };
}

function where(block: BlockFile, r: LotResult) {
  const p = block.parcels.find((x) => x.pin === r.pins[0])!;
  const addr = `${p.addr.replace(' (no number)', '')} (lot ${p.lot}${p.lot_suffix ?? ''})`;
  return { p, addr };
}

export function recordsMemo(inq: Inquiry, r: LotResult, block: BlockFile): Memo {
  const { p, addr } = where(block, r);
  const disagree = r.refusal?.code === 'records_disagree';
  const ask: InquiryItem[] = disagree
    ? [
        { text: `Which lot area is right for ${addr}? The County assessment and the City parcel map disagree by more than we can work with, so we can’t check the zoning rules yet.`, trust: 'pencil' },
        { text: `Is there a recorded survey, deed plan or subdivision plan for this parcel (PIN ${p.pin}) that shows its dimensions?`, trust: 'pencil' },
        { text: 'If the assessed lot area is out of date, how do we ask for it to be corrected?', trust: 'pencil' },
      ]
    : [{ text: `We could not check ${addr} against the zoning rules. Which record should we rely on to settle it?`, trust: 'pencil' }];

  const records: MemoSection = {
    id: 'records',
    heading: 'The records question',
    to: disagree ? 'Allegheny County Office of Property Assessments; City Real Estate' : 'City of Pittsburgh, Department of City Planning',
    items: ask,
  };
  const sections: MemoSection[] = [];
  for (const s of inq.sections) {
    if (s.id === 'questions') {
      sections.push(records);
      sections.push({ ...s, to: undefined, items: [], note: 'None yet. We can’t check the zoning rules for this lot until the records agree; we will write again once they do.' });
    } else sections.push(s);
  }
  const recipients = [
    ...(disagree ? [{ who: 'Allegheny County Office of Property Assessments', why: 'the assessed lot area' }] : []),
    // The zoning, community and financing letters wait until the lot can be scored.
    ...inq.recipients.filter((x) => !/^(Zoning Administrator|RCO|Urban Redevelopment)/.test(x.who)),
  ];
  const title = disagree ? `Records question: lot area of ${addr}` : `Records question: ${addr}`;

  // Number check: the engine's own check, plus proof that the text added here adds no quantities.
  const unknown = [...inq.check.unknown];
  for (const it of ask) for (const n of numbersIn(it.text)) unknown.push(`${n} in "${it.text.slice(0, 80)}…" (added by the records memo)`);
  const base = { title, subtitle: inq.subtitle, recipients, sections, disclaimer: inq.disclaimer };
  const markdown = memoMarkdown(base);
  return { ...base, date: inq.date, check: { ok: unknown.length === 0, unknown, checked: inq.check.checked }, markdown, text: plainText(markdown), refused: true };
}
