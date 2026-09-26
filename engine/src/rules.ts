// Rule store → effective rules. Verification has three levels (spec §0.5.1):
// unreviewed (pencil) · source-checked (ink) · City-confirmed (ink + seal). Assumptions are red and
// apply only to questions. Every decision is an audit entry; the effective state is the file's
// state folded with its audit entries in time order.
import type {
  AuditEntry,
  EffectiveRule,
  Question,
  QuestionState,
  Rule,
  RuleField,
  RuleSet,
  TemplateId,
  Trust,
} from './types';

export const AI_ROLE = 'AI agent';

/** Reasons an audit entry is not accepted (it then has no effect). */
export function auditProblems(e: AuditEntry): string[] {
  const p: string[] = [];
  if (!e.reviewer?.trim()) p.push('reviewer name is required');
  if (!e.role?.trim()) p.push('role is required');
  if (!e.reason?.trim()) p.push('a reason or note is required');
  if (!e.at || Number.isNaN(Date.parse(e.at))) p.push('time is required');
  if (e.action === 'city_confirmed') {
    if (!e.reference?.text?.trim() || !e.reference?.date?.trim() || !e.reference?.who?.trim())
      p.push('City confirmation needs a reference, a date and who confirmed it');
  }
  if (e.action === 'assumed' && !e.question_id) p.push('only questions can be assumed');
  if ((e.action === 'assumed' || e.action === 'city_confirmed') && e.question_id && !e.choice)
    p.push('choose yes or no');
  if (!e.rule_id && !e.question_id) p.push('entry refers to no rule or question');
  return p;
}

function byTime(a: AuditEntry, b: AuditEntry): number {
  return Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id);
}

export function effectiveRule(rule: Rule, audit: AuditEntry[]): EffectiveRule {
  const history = audit.filter((e) => e.rule_id === rule.id && auditProblems(e).length === 0).sort(byTime);
  let level = rule.verification.level;
  let struck = false;
  let humanSigned = rule.verification.level !== 'unreviewed' && rule.verification.role !== AI_ROLE;
  let aiChecked = rule.verification.level !== 'unreviewed' && rule.verification.role === AI_ROLE;
  let verification = { ...rule.verification };
  for (const e of history) {
    if (e.action === 'source_checked') {
      level = level === 'city_confirmed' ? level : 'source_checked';
      struck = false;
      verification = { level, reviewer: e.reviewer, role: e.role, at: e.at, note: e.reason, reference: verification.reference };
      if (e.role !== AI_ROLE) {
        humanSigned = true;
        aiChecked = false;
      }
    } else if (e.action === 'city_confirmed') {
      level = 'city_confirmed';
      struck = false;
      verification = { level, reviewer: e.reviewer, role: e.role, at: e.at, note: e.reason, reference: e.reference };
      humanSigned = true;
      aiChecked = false;
    } else if (e.action === 'struck') {
      struck = true;
    } else if (e.action === 'reopened') {
      level = 'unreviewed';
      struck = false;
      humanSigned = false;
      aiChecked = false;
      verification = { level, reviewer: null, role: null, at: null, note: null, reference: null };
    }
  }
  // A † rule is never ink until a person (not an AI agent) signs it.
  let state: EffectiveRule['state'] = struck ? 'struck' : level === 'unreviewed' ? 'pencil' : 'ink';
  if (state === 'ink' && rule.dagger && !humanSigned) state = 'pencil';
  return {
    ...rule,
    verification: { ...verification, level },
    state,
    sealed: !struck && level === 'city_confirmed',
    ai_checked: state === 'ink' && aiChecked,
    history,
  };
}

export function questionState(q: Question, audit: AuditEntry[]): QuestionState {
  const history = audit.filter((e) => e.question_id === q.id && auditProblems(e).length === 0).sort(byTime);
  let st: QuestionState = { question: q, status: 'open', choice: null, by: null, role: null, at: null, reference: null };
  for (const e of history) {
    if (e.action === 'assumed') st = { ...st, status: 'assumed', choice: e.choice, by: e.reviewer, role: e.role, at: e.at, reference: null };
    else if (e.action === 'city_confirmed')
      st = { ...st, status: 'city_confirmed', choice: e.choice, by: e.reviewer, role: e.role, at: e.at, reference: e.reference };
    else if (e.action === 'reopened') st = { ...st, status: 'open', choice: null, by: null, role: null, at: null, reference: null };
  }
  return st;
}

const LEVEL_RANK = { city_confirmed: 3, source_checked: 2, unreviewed: 1 } as const;

export function buildRuleSet(district: string, rules: Rule[], questions: Question[], audit: AuditEntry[]): RuleSet {
  const mine = rules.filter((r) => r.district === district || r.district === '*');
  return {
    district,
    rules: mine.map((r) => effectiveRule(r, audit)),
    questions: questions.filter((q) => q.district === '*' || q.district === district).map((q) => questionState(q, audit)),
  };
}

/** The best non-struck rule for a field (and template, when the rule is template-specific). */
export function pick(rs: RuleSet, field: RuleField, template?: TemplateId | 'row_end'): EffectiveRule | undefined {
  const cands = rs.rules.filter(
    (r) =>
      r.field === field &&
      r.state !== 'struck' &&
      (!template || r.applies_to.includes('*') || r.applies_to.includes(template)),
  );
  cands.sort(
    (a, b) =>
      (a.state === 'ink' ? 0 : 1) - (b.state === 'ink' ? 0 : 1) ||
      LEVEL_RANK[b.verification.level] - LEVEL_RANK[a.verification.level] ||
      (a.origin === 'answer_key' ? 0 : 1) - (b.origin === 'answer_key' ? 0 : 1) ||
      a.id.localeCompare(b.id),
  );
  return cands[0];
}

export function ruleTrust(r: EffectiveRule | undefined): Trust {
  return r && r.state === 'ink' ? 'ink' : 'pencil';
}

const ORDER: Trust[] = ['ink', 'pencil', 'red'];
/** Weakest input wins: red beats pencil beats ink. */
export function weakest(...ts: Trust[]): Trust {
  return ts.reduce<Trust>((acc, t) => (ORDER.indexOf(t) > ORDER.indexOf(acc) ? t : acc), 'ink');
}

export function getQuestion(rs: RuleSet, id: string): QuestionState | undefined {
  return rs.questions.find((q) => q.question.id === id);
}
