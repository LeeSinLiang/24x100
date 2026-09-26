// The inquiry: a one-page draft a CDC could send. A template fills in the facts from the engine
// result; questions come from the rule store's question_for_city fields and from open checks. Every
// number in the memo must appear in the engine output, or export is blocked (spec §10).
import { APPROVAL_LABEL, TEMPLATES } from './templates';
import type { BlockFile, EffectiveRule, LotResult, MoneyResult, RuleSet, Trust } from './types';

export interface InquiryItem {
  text: string;
  trust: Trust | 'struck';
  cite?: string; // "§903.03.C" or "City-Owned Properties, status updated 2016-11-17"
}
export interface InquirySection {
  id: 'build' | 'facts' | 'questions' | 'money' | 'struck' | 'assumptions' | 'not_assessed';
  heading: string;
  to?: string; // who the questions are for
  items: InquiryItem[];
}
export interface Inquiry {
  title: string;
  subtitle: string;
  date: string;
  recipients: { who: string; why: string }[];
  sections: InquirySection[];
  disclaimer: string;
  check: { ok: boolean; unknown: string[]; checked: number };
  text: string;
  markdown: string;
}

export const DISCLAIMER =
  'Decision support, not legal, financial or zoning advice. The City of Pittsburgh interprets its own code. Draft prepared with 24×100 from public records; not sent automatically.';

function usd(n: number): string {
  const v = Math.round(n / 1000) * 1000;
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
}
function ft(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

/** Numbers that are names, not quantities: addresses, lot numbers, sections, dates, PINs, ordinances. */
function stripIdentifiers(s: string): string {
  return s
    .replace(/§\s?\d{3}\.\d{2}(?:\.[A-Z0-9]+)*(?:\([a-z0-9]+\))?/g, '')
    .replace(/\b\d{4}[A-Z]\d{5}[A-Z0-9]{6}\b/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\b\d{1,2} [A-Z][a-z]{2,8} \d{4}\b/g, '')
    .replace(/\b(Ord\.( No\.)?|Bill|File) [\d-]+/g, '')
    .replace(/\bBlock [\dA-Z-]+/g, '')
    .replace(/\b\d+ [A-Z][a-z]+ (St|Way|Ave|Street|Avenue)\b/g, '')
    .replace(/\b[Ll]ots? \d+[A-Z]?(?:[–-]\d+)?(?:(?:,| and) \d+)*/g, '')
    .replace(/\bWard \d+/g, '')
    .replace(/\bFY\s?\d{4}/g, '')
    .replace(/\bplan lot \d+/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '');
}

export function numbersIn(s: string): number[] {
  return [...stripIdentifiers(s).matchAll(/(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function allowedNumbers(r: LotResult, m: MoneyResult | null, rs: RuleSet, block: BlockFile): Set<number> {
  const s = new Set<number>([0, 1, 2, 3, 4, 100]);
  const add = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return;
    s.add(v);
    s.add(Math.round(v));
    s.add(Math.round(v * 10) / 10);
    s.add(Math.round(v / 1000) * 1000);
  };
  for (const meas of [r.width, r.depth, ...r.units.map((u) => u.width)]) if (meas) [meas.deed, meas.mapped, ...meas.terms.map((t) => t.value)].forEach(add);
  for (const c of r.checks) [c.required, c.available, c.shortfall, c.alternative?.available, c.available != null && c.unit === 'share' ? c.available * 100 : null].forEach(add);
  for (const x of r.relief) [x.from, x.to].forEach(add);
  if (r.score) [r.score.hi, r.score.lo].forEach(add);
  [...r.approvals.ink, ...r.approvals.pencil].forEach((a) => add(a.weight));
  const P = r.scenario.proposal;
  [P.width, P.depth, P.stories, P.height, P.units, P.home_sqft, r.units.length].forEach(add);
  for (const rule of rs.rules) if (typeof rule.value === 'number') add(rule.value);
  if (m) {
    [m.homes, m.sqft, m.value.median, m.value.q1, m.value.q3, m.value.newest, m.value.count, m.cost.lo, m.cost.hi, ...m.cost.hard_psf, m.break_even_psf.value, m.gap.lo, m.gap.hi, m.affordable.price, m.affordable.income, m.affordable.household].forEach(add);
  }
  if (r.refusal?.values) Object.values(r.refusal.values).forEach((v) => typeof v === 'number' && add(v));
  // Record values the engine read for these lots (areas quoted in the lot-area check).
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)).filter((p): p is NonNullable<typeof p> => !!p);
  for (const p of ps) [p.mapped_area, p.assess?.lotarea, p.deed ? p.deed.front * p.deed.depth : null, p.deed?.front, p.deed?.depth].forEach(add);
  [ps.reduce((a, p) => a + p.mapped_area, 0), ps.reduce((a, p) => a + (p.assess?.lotarea ?? 0), 0), ps.reduce((a, p) => a + (p.deed ? p.deed.front * p.deed.depth : 0), 0)].forEach(add);
  return s;
}

function lotsWords(block: BlockFile, pins: string[]): string {
  const ps = pins.map((p) => block.parcels.find((x) => x.pin === p)!);
  return ps.map((p) => `${p.addr.replace(' (no number)', '')} (lot ${p.lot}${p.lot_suffix ?? ''})`).join(', ');
}

export function buildInquiry(r: LotResult, block: BlockFile, rs: RuleSet, m: MoneyResult | null, date: string): Inquiry {
  const tpl = TEMPLATES[r.scenario.type];
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)!).sort((a, b) => (a.lot ?? 0) - (b.lot ?? 0));
  const P = r.scenario.proposal;
  const cityLots = ps.filter((p) => p.city);
  const others = ps.filter((p) => !p.city);
  const rco = (ps[0].overlays ?? []).find((o) => o.startsWith('RCO'))?.replace(/^RCO - /, '');
  const homes = r.scenario.type === 'row' ? r.units.length : P.units;
  const sections: InquirySection[] = [];

  sections.push({
    id: 'build',
    heading: 'What we want to build',
    items: [
      {
        text: `A ${tpl.name.toLowerCase()} (${homes} home${homes === 1 ? '' : 's'}) on ${lotsWords(block, r.pins)}, ${block.meta.neighborhood}, zoned ${r.district}. Proposed ${r.scenario.type === 'row' ? `units ${ft(P.width)} ft wide` : `${ft(P.width)} ft wide`}, ${ft(P.depth)} ft deep, ${P.stories} stories, ${ft(P.height)} ft tall.`,
        trust: 'red',
      },
    ],
  });

  const facts: InquiryItem[] = [];
  if (r.state === 'refused') {
    facts.push({ text: `We could not score this lot. ${r.refusal?.reason ?? ''}`, trust: 'ink' });
  } else {
    const W = r.width!;
    const inkRule = (ids: string[]) => ids.map((id) => rs.rules.find((x) => x.id === id)).filter((x): x is EffectiveRule => !!x);
    const secs = (ids: string[]) => [...new Set(inkRule(ids).map((x) => `§${x.section}`))].join(', ');
    const wCheck = r.checks.find((c) => c.id === 'width')!;
    if (W.trust === 'ink' && wCheck.trust !== 'pencil') {
      facts.push({ text: `Buildable width as of right: ${W.formula} ft by the deed dimensions (${ft(W.mapped)} ft on the City map).`, trust: 'ink', cite: secs(W.rule_ids) });
    }
    if (r.depth && r.depth.trust === 'ink') facts.push({ text: `Buildable depth as of right: ${r.depth.formula} ft.`, trust: 'ink', cite: secs(r.depth.rule_ids) });
    for (const c of r.checks) {
      if (['width', 'depth'].includes(c.id)) continue;
      if (c.trust === 'ink' && c.status !== 'open' && c.status !== 'needs_survey') facts.push({ text: c.text.replace(/^Your /, 'Our '), trust: 'ink', cite: secs(c.rule_ids) || (c.id === 'ownership' ? 'City-Owned Properties; County assessment' : c.id === 'undermined' ? 'City undermined-areas layer' : c.id === 'grading' ? 'City slope layer' : undefined) });
    }
    for (const x of r.relief) facts.push({ text: `To build the proposal as drawn, it would need ${x.text} (${APPROVAL_LABEL[x.approval].toLowerCase()}).`, trust: 'ink', cite: `§${x.section}` });
  }
  sections.push({ id: 'facts', heading: 'What the code and the records say', items: facts });

  const qs: InquiryItem[] = [];
  for (const q of r.questions) if (q.ask === 'Zoning Administrator' || q.id.startsWith('q.rule')) qs.push({ text: q.text, trust: q.trust === 'red' ? 'red' : 'pencil', cite: q.section ? `§${q.section}` : undefined });
  for (const c of r.checks) {
    if (c.trust === 'pencil' && (c.status === 'open' || c.status === 'needs_survey') && c.id !== 'width') {
      const q =
        c.id === 'use'
          ? `Is a ${tpl.name.toLowerCase()} permitted by right in ${r.district}? (${c.text})`
          : c.id === 'parking'
            ? `What parking is required, and can relief be granted for this lot? (${c.text})`
            : c.id === 'grading'
              ? `Does grading review or a geotechnical report apply here? (${c.text})`
              : c.id === 'area'
                ? `Which lot area governs: the deed, the County assessment or the City map? (${c.text})`
                : c.text;
      qs.push({ text: q, trust: 'pencil' });
    }
    if (c.id === 'contextual' && c.trust === 'pencil') qs.push({ text: `${c.text} Can a contextual side setback be used here, and what evidence of the neighbor's setback is acceptable?`, trust: 'pencil' });
  }
  sections.push({ id: 'questions', heading: 'Questions for the Zoning Administrator', to: 'Zoning Administrator, Department of City Planning', items: qs });

  const money: InquiryItem[] = [];
  for (const q of r.questions) if (q.ask === 'City Real Estate') money.push({ text: q.text, trust: 'pencil' });
  if (cityLots.length) money.push({ text: `What would the City ask for ${cityLots.map((p) => p.addr.replace(' (no number)', ` (lot ${p.lot})`)).join(' and ')} through a public sale, and what is the process and timeline?`, trust: 'pencil' });
  if (others.length) money.push({ text: `${others.map((p) => `Lot ${p.lot}`).join(' and ')} ${others.length > 1 ? 'are' : 'is'} not in the City's inventory (County owner type: ${others.map((p) => (p.assess?.ownercat ?? 'unknown').toLowerCase()).join(', ')}). Can the City help reach the owner, or package the lots together?`, trust: 'pencil' });
  if (m) {
    money.push({
      text: `At the Ward 5 median sale price (${usd(m.value.median)}, ${m.value.count} valid sales since 2023), a builder would need hard costs at or below $${Math.round(m.break_even_psf.value)} per sq ft to break even. At our assumed $${m.cost.hard_psf[0]}–$${m.cost.hard_psf[1]} per sq ft, the gap is about ${usd(m.gap.lo)}–${usd(m.gap.hi)} per home. Which URA or partner programs could close a gap like this for small for-sale infill? (Our assumptions are listed below; we are not assuming eligibility.)`,
      trust: 'red',
    });
  }
  sections.push({ id: 'money', heading: 'Questions about money', to: 'City Real Estate; Urban Redevelopment Authority (URA)', items: money });

  const struck = rs.rules.filter((x) => x.state === 'struck').map((x) => ({ text: `${x.field.replaceAll('_', ' ')}: "${x.quote.slice(0, 120)}${x.quote.length > 120 ? '…' : ''}" (struck by ${x.history.filter((h) => h.action === 'struck').slice(-1)[0]?.reviewer ?? 'a reviewer'})`, trust: 'struck' as const, cite: `§${x.section}` }));
  sections.push({ id: 'struck', heading: 'Checked and set aside', items: struck.length ? struck : [{ text: 'Nothing struck yet.', trust: 'ink' }] });

  const assumptions: InquiryItem[] = [
    { text: `The building we described above (width, depth, stories, height) is our proposal, not a requirement.`, trust: 'red' },
    ...r.questions.filter((q) => q.trust === 'red').map((q) => ({ text: `We explored an answer to an open question, but we are not relying on it: ${q.text}`, trust: 'red' as const })),
  ];
  if (m) assumptions.push({ text: `Costs are our placeholders: hard cost $${m.cost.hard_psf[0]}–$${m.cost.hard_psf[1]} per sq ft; ${m.sqft.toLocaleString('en-US')} sq ft per home; lot price unknown.`, trust: 'red' });
  sections.push({ id: 'assumptions', heading: 'Our assumptions (red)', items: assumptions });

  sections.push({
    id: 'not_assessed',
    heading: 'Not assessed',
    items: [
      { text: 'Water and sewer capacity; soils and old fill; title, liens and back taxes. We have not checked these.', trust: 'ink' },
      { text: `Community priorities: we will bring this to the Registered Community Organization${rco ? ` (${rco})` : ''} before choosing a design.`, trust: 'ink' },
    ],
  });

  const recipients = [
    ...(cityLots.length ? [{ who: 'City of Pittsburgh, Department of City Planning, Real Estate', why: 'public-sale inquiry for the City-owned lots' }] : []),
    { who: 'Zoning Administrator, Department of City Planning', why: 'the open code questions' },
    ...(rco ? [{ who: `RCO: ${rco}`, why: 'the community meeting' }] : []),
    ...(m ? [{ who: 'Urban Redevelopment Authority of Pittsburgh', why: 'gap financing; programs are pointers, not promises' }] : []),
  ];

  const title = `Inquiry: ${tpl.name.toLowerCase()} at ${ps.map((p) => p.addr.replace(' (no number)', ` (lot ${p.lot})`)).join(' + ')}`;
  const subtitle = `${block.meta.name}, ${block.meta.neighborhood} · ${r.district} · draft ${date}`;
  const lines: string[] = [`# ${title}`, subtitle, '', `To: ${recipients.map((x) => `${x.who} (${x.why})`).join('; ')}`, ''];
  for (const sec of sections) {
    lines.push(`## ${sec.heading}${sec.to ? ` (for ${sec.to})` : ''}`);
    for (const it of sec.items) lines.push(`- ${it.trust === 'red' ? '[our assumption] ' : it.trust === 'pencil' ? '[open] ' : it.trust === 'struck' ? '[set aside] ' : ''}${it.text}${it.cite ? ` (${it.cite})` : ''}`);
    lines.push('');
  }
  lines.push(`_${DISCLAIMER}_`);
  const markdown = lines.join('\n');
  const text = markdown.replace(/^#+ /gm, '').replace(/_/g, '');

  // Number check: every quantity in the memo appears in the engine output.
  const allowed = allowedNumbers(r, m, rs, block);
  const unknown: string[] = [];
  let checked = 0;
  for (const sec of sections)
    for (const it of sec.items) {
      if (it.trust === 'struck') continue;
      for (const n of numbersIn(it.text)) {
        checked++;
        if (!allowed.has(n)) unknown.push(`${n} in "${it.text.slice(0, 80)}…"`);
      }
    }
  return { title, subtitle, date, recipients, sections, disclaimer: DISCLAIMER, check: { ok: unknown.length === 0, unknown, checked }, text, markdown };
}
