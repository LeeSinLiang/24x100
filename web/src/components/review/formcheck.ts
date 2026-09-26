// What the Review, Assume and Record forms need before they save anything: each missing or unusable
// field named, so the form can say it next to the field instead of doing nothing. Pure, for tests.
import { calendarDate, composeReference, cityReferenceProblems, type ReferenceKind } from './reviewlog';

export type FormKind = 'sign' | 'strike' | 'assume-yes' | 'assume-no' | 'confirm';

export interface FormValues {
  name: string;
  role: string;
  reason: string;
  refKind?: ReferenceKind | '';
  refDetail?: string;
  refDate?: string;
  refWho?: string;
}

export type FieldId = 'name' | 'role' | 'reason' | 'refKind' | 'refDetail' | 'refDate' | 'refWho';

/** The label each field shows, so an error names the field the person can see. */
export function fieldLabels(kind: FormKind, refKind: ReferenceKind | '' = ''): Record<FieldId, string> {
  return {
    name: 'Name',
    role: 'Role',
    reason: kind === 'strike' ? 'Why is it wrong?' : 'Note',
    refKind: 'Kind of reference',
    refDetail: refKind === 'case' ? 'Case number' : refKind === 'ticket' ? 'Ticket number' : refKind === 'email' ? 'Email subject or sender' : 'Letter subject or sender',
    refDate: refKind === 'case' || refKind === 'ticket' ? 'Date of the decision' : refKind === 'email' ? 'Date of the email' : 'Date of the letter',
    refWho: 'Who at the City',
  };
}

/** Field → message, in the order the fields appear. Empty when the form can be saved. */
export function formProblems(kind: FormKind, v: FormValues, now = Date.now()): Partial<Record<FieldId, string>> {
  const L = fieldLabels(kind, v.refKind ?? '');
  const p: Partial<Record<FieldId, string>> = {};
  const need = (id: FieldId, val: string | undefined) => {
    if (!(val ?? '').trim()) p[id] = `${L[id]} is required.`;
  };
  need('name', v.name);
  need('role', v.role);
  if (kind === 'confirm') {
    if (!v.refKind) p.refKind = 'Choose the kind of reference: a letter, an email, a case number or a ticket number. A phone call is not a reference.';
    else {
      need('refDetail', v.refDetail);
      if (!p.refDetail && (v.refKind === 'case' || v.refKind === 'ticket') && !/\d/.test(v.refDetail ?? '')) p.refDetail = `${L.refDetail} must contain the number.`;
      if (!p.refDetail && (v.refKind === 'letter' || v.refKind === 'email') && (v.refDetail ?? '').trim().length < 3) p.refDetail = `${L.refDetail}: say which ${v.refKind}.`;
    }
    need('refDate', v.refDate);
    if (!p.refDate) {
      const t = calendarDate(v.refDate);
      if (Number.isNaN(t)) p.refDate = `${L.refDate} must be a date.`;
      else if (t > now + 24 * 3600 * 1000) p.refDate = `${L.refDate} is in the future.`;
    }
    need('refWho', v.refWho);
    // The stored reference must also pass the check the publish step applies.
    if (!Object.keys(p).length) {
      const extra = cityReferenceProblems({ text: composeReference(v.refKind as ReferenceKind, v.refDetail ?? ''), date: v.refDate ?? '', who: v.refWho ?? '' }, now);
      if (extra.length) p.refDetail = extra.join('; ');
    }
  }
  need('reason', v.reason);
  return p;
}
