// The inquiry: a one-page draft a CDC could send. A template fills in the facts from the engine
// result; questions come from the rule store's question_for_city fields and from open checks. Every
// number in the memo must appear in the engine output, or export is blocked (spec §10).
import { APPROVAL_LABEL, TEMPLATES } from './templates';
import type { BlockFile, EffectiveRule, LotResult, MoneyResult, RuleSet, Trust } from './types';
import { siteUnknowns, varianceWords } from './verdict';

export interface InquiryItem {
  text: string;
  trust: Trust | 'struck' | 'estimate';
  cite?: string; // "§903.03.C" or "City-Owned Properties, status updated 2016-11-17"
}
export interface InquirySection {
  id: 'build' | 'money' | 'facts' | 'questions' | 'site' | 'next' | 'struck' | 'assumptions' | 'not_assessed';
  heading: string;
  to?: string; // who the questions are for
  items: InquiryItem[];
}
export interface Inquiry {
  title: string;
  subtitle: string;
  date: string;
  from: string;
  recipients: { who: string; why: string }[];
  sections: InquirySection[];
  disclaimer: string;
  check: { ok: boolean; unknown: string[]; checked: number };
  text: string;
  markdown: string;
}

/** The sender fills this in; 24×100 never writes as anyone. */
export const FROM_PLACEHOLDER = '[your name, organization and contact]';

export const DISCLAIMER =
  'Decision support, not legal, financial or zoning advice. The City of Pittsburgh interprets its own code. Draft prepared with 24×100 from public records; not sent automatically.';

function cap(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

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
    [m.homes, m.sqft, m.vertical.lo, m.vertical.hi, ...m.vertical.psf, m.gap.lower_bound, m.break_even_psf.value, m.with_assumptions.lo, m.with_assumptions.hi, m.comps.median, m.comps.q1, m.comps.q3, m.comps.count, m.affordable.price, m.affordable.income, m.affordable.household, ...m.signals.map((x) => x.value)].forEach(add);
    [m.with_assumptions.soft * 100, m.with_assumptions.financing * 100].forEach(add);
  }
  if (m) for (const sig of m.signals) numbersIn(sig.label).forEach(add); // e.g. the comparable's floor area
  [80, 30].forEach(add); // "80% AMI", "30% of income": definitions, not results  if (r.refusal?.values) Object.values(r.refusal.values).forEach((v) => typeof v === 'number' && add(v));
  [25].forEach(add); // "25% slope or steeper" is the layer's definition
  // Record values the engine read for these lots (areas quoted in the lot-area check).
  const ps = r.pins.map((p) => block.parcels.find((x) => x.pin === p)).filter((p): p is NonNullable<typeof p> => !!p);
  for (const p of ps) [p.mapped_area, p.assess?.lotarea, p.deed ? p.deed.front * p.deed.depth : null, p.deed?.front, p.deed?.depth, p.slope25 * 100, p.undermined * 100].forEach(add);
  [ps.reduce((a, p) => a + p.mapped_area, 0), ps.reduce((a, p) => a + (p.assess?.lotarea ?? 0), 0), ps.reduce((a, p) => a + (p.deed ? p.deed.front * p.deed.depth : 0), 0)].forEach(add);
  return s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2016-11-17" → "17 Nov 2016" in prose sent to people. */
export function humanDates(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`);
}

/** "a two-unit house", "a row of 3 attached houses". */
function buildingPhrase(type: string, homes: number): string {
  return type === 'row' ? `a row of ${homes} attached houses` : type === 'three' ? 'a three-unit house' : type === 'two' ? 'a two-unit house' : 'a detached house';
}

function lotRange(ps: { lot: number | null; lot_suffix?: string | null }[]): string {
  const n = ps.map((p) => p.lot ?? 0).sort((a, b) => a - b);
  return n.length > 1 ? `lots ${n[0]}–${n[n.length - 1]}` : `lot ${n[0]}${ps[0].lot_suffix ?? ''}`;
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
        text: `${cap(buildingPhrase(r.scenario.type, homes))} (${homes} home${homes === 1 ? '' : 's'}) on ${lotsWords(block, [...r.pins].sort((a, b) => (block.parcels.find((p) => p.pin === a)?.lot ?? 0) - (block.parcels.find((p) => p.pin === b)?.lot ?? 0)))}, ${block.meta.neighborhood}, zoned ${r.district}. We propose ${r.scenario.type === 'row' ? `houses ${ft(P.width)} ft wide` : `a building ${ft(P.width)} ft wide`}, ${ft(P.depth)} ft deep, ${P.stories} stories and ${ft(P.height)} ft tall.`,
        trust: 'red',
      },
    ],
  });

  const facts: InquiryItem[] = [];
  if (r.state === 'refused') {
    const v = r.refusal?.values ?? {};
    facts.push({
      text:
        r.refusal?.code === 'records_disagree'
          ? `The records disagree about this lot's size: the County assessment says ${Number(v.assessed).toLocaleString('en-US')} sf and the City's parcel map measures ${Number(v.mapped).toLocaleString('en-US')} sf, more than the difference we can work with.`
          : `We could not check this lot against the zoning rules yet: ${r.refusal?.reason ?? ''}`,
      trust: 'ink',
      cite: r.refusal?.code === 'records_disagree' ? 'County assessment; City parcel map' : undefined,
    });
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
      if (c.trust === 'ink' && c.status !== 'open' && c.status !== 'needs_survey') {
        const text = humanDates(c.text.replace(/^Your /, 'Our '));
        const cite = secs(c.rule_ids) || (c.id === 'ownership' ? 'City-Owned Properties; County assessment' : c.id === 'undermined' ? 'City undermined-areas layer' : c.id === 'grading' ? 'City slope layer' : undefined);
        facts.push({ text, trust: 'ink', cite: cite && !text.includes(cite) ? cite : undefined });
      }
    }
    for (const x of r.relief)
      facts.push({
        text: `It doesn't fit as of right: what we propose would need ${x.text}. ${x.approval === 'variance' ? varianceWords(x.text.startsWith('side setbacks')) : APPROVAL_LABEL[x.approval]}`,
        trust: 'ink',
        cite: `§${x.section}`,
      });
  }
  sections.push({ id: 'facts', heading: 'What the code and the records say', items: facts });

  const qs: InquiryItem[] = [];
  const phrase = buildingPhrase(r.scenario.type, homes);
  const ruleOf = (c: { rule_ids: string[] }) => c.rule_ids.map((id) => rs.rules.find((x) => x.id === id)).find(Boolean);
  for (const q of r.questions) {
    if (q.ask !== 'Zoning Administrator' && !q.id.startsWith('q.rule')) continue;
    if (/grading|slope/i.test(q.id) && r.checks.some((c) => c.id === 'grading' && c.status === 'open')) continue; // asked once, below
    qs.push({ text: q.text, trust: q.trust === 'red' ? 'red' : 'pencil', cite: q.section ? `§${q.section}` : undefined });
  }
  for (const c of r.checks) {
    if (!(c.trust === 'pencil' && (c.status === 'open' || c.status === 'needs_survey') && c.id !== 'width')) {
      if (c.id === 'contextual' && c.trust === 'pencil') qs.push({ text: `${humanDates(c.text).replace(/\s*\(§[^)]+\)\.?$/, '.')} Can a contextual side setback be used here, and what evidence of the neighbor's setback do you accept?`, trust: 'pencil', cite: '§925.06.C' });
      continue;
    }
    const rule = ruleOf(c);
    if (c.id === 'use') {
      qs.push({
        text: rule
          ? `Our unchecked reading of the use table says ${phrase} is ${String(rule.value) === 'P' ? 'permitted by right' : 'not permitted by right'} in ${r.district}. Is that right?`
          : `Is ${phrase} permitted by right in ${r.district}?`,
        trust: 'pencil',
        cite: '§911.02',
      });
    } else if (c.id === 'parking') {
      qs.push({
        text:
          c.required != null && c.required > 0
            ? `Our unchecked reading is that ${c.required} parking space${c.required === 1 ? '' : 's'} would be required; we haven't checked that they fit. What is required here, and can relief be granted on a lot this size?`
            : 'What parking is required here, and can relief be granted on a lot this size?',
        trust: 'pencil',
        cite: '§914.02.A',
      });
    } else if (c.id === 'grading') {
      const pctSlope = c.available != null ? Math.round(c.available * 100) : null;
      qs.push({ text: `${pctSlope != null ? `About ${pctSlope}% of the lot is 25% slope or steeper on the City's slope layer. ` : ''}Does grading review or a geotechnical report apply to building here?`, trust: 'pencil', cite: rule ? `§${rule.section}` : '§915.02.A' });
    } else if (c.id === 'area') {
      qs.push({ text: 'The deed and the County assessment fall on different sides of the minimum lot size. Which governs, and would a survey settle it?', trust: 'pencil' });
    } else if (c.id === 'undermined') {
      qs.push({ text: humanDates(c.text), trust: 'pencil' });
    }
  }
  sections.push({ id: 'questions', heading: 'Questions for the Zoning Administrator', to: 'Zoning Administrator, Department of City Planning', items: qs });

  // Money first (spec §0.12): a screening estimate, before any zoning or site spending.
  const moneyItems: InquiryItem[] = [];
  if (m) {
    const top = m.signals.find((x) => x.id === m.gap.signal)!;
    moneyItems.push({
      text: `Vertical construction: $${m.vertical.psf[0]}–$${m.vertical.psf[1]} per sq ft (an estimate from a practitioner at the hackathon; vertical construction only, excluding site work) × ${m.sqft.toLocaleString('en-US')} sq ft = ${usd(m.vertical.lo)}–${usd(m.vertical.hi)} per home.`,
      trust: 'estimate',
    });
    for (const sig of m.signals) moneyItems.push({ text: `${sig.label}: ${usd(sig.value)} (${sig.note}).`, trust: sig.evidence === 'red' ? 'red' : 'ink' });
    moneyItems.push({
      text: m.gap.positive
        ? `So the gap is at least ${usd(m.gap.lower_bound)} per home against the highest of these (${top.label}), before site work, land, soft costs and financing. This is a lower bound from a screening estimate, not a pro forma.`
        : `Vertical construction at the low end comes in under the highest value signal (${top.label}); site work, land, soft costs and financing are not in this number.`,
      trust: 'estimate',
    });
  } else moneyItems.push({ text: 'Not assessed: we have no comparable sales loaded for this ward.', trust: 'ink' });
  sections.splice(1, 0, { id: 'money', heading: 'Money first (screening estimate)', items: moneyItems });

  // Site: not assessed, could change the decision. No dollar amounts.
  const site = siteUnknowns(r, block);
  sections.push({
    id: 'site',
    heading: 'Site: not assessed, and it could change the decision',
    items: site.map((row) => ({ text: `${row.label}. ${row.signals.join(' ')} What resolves it: ${row.resolves} (cost: ${row.cost}).`, trust: 'ink' as const })),
  });

  // What to check next, in order: cheapest to learn first. Each says what answer would change the decision.
  const next: InquiryItem[] = [];
  const cityNames = cityLots.map((p) => p.addr.replace(' (no number)', ` (lot ${p.lot})`));
  const cityQ = r.questions.filter((q) => q.ask === 'City Real Estate').map((q) => humanDates(q.text));
  next.push({
    text: `Free: City Real Estate and the URA. ${others.length ? `Who owns ${others.map((p) => `lot ${p.lot}`).join(' and ')} (County owner type: ${others.map((p) => (p.assess?.ownercat ?? 'unknown').toLowerCase()).join(', ')}), and would they sell? ` : ''}${cityNames.length ? `What would the City ask for ${cityNames.join(' and ')}, and what are the process and timeline? ` : ''}${cityQ.join(' ')} This changes the decision if a lot can't be had or the price widens the gap.`,
    trust: 'pencil',
  });
  next.push({
    text: `Free: gap financing. ${m && m.gap.positive ? `Is there gap financing for small for-sale infill of at least ${usd(m.gap.lower_bound)} per home?` : 'Is there gap financing for small for-sale infill here?'} Ask the URA which programs apply; we are not naming programs or assuming eligibility. This changes the decision if no program can cover the gap.`,
    trust: 'pencil',
  });
  next.push({
    text: `Low cost: the Zoning Administrator, by letter or a pre-application meeting, with the questions above. This changes the decision if the reading of the rules changes what fits${r.relief.length ? ' or whether a variance is realistic' : ''}.`,
    trust: 'pencil',
  });
  next.push({
    text: `Paid, and only if the first three pass: ${site.map((x) => x.resolves).join('; ')}. Any of them can change the cost or rule the lot out.`,
    trust: 'pencil',
  });
  sections.push({ id: 'next', heading: 'What to check next, in order', items: next });

  const struck = rs.rules.filter((x) => x.state === 'struck').map((x) => ({ text: `${x.field.replaceAll('_', ' ')}: "${x.quote.slice(0, 120)}${x.quote.length > 120 ? '…' : ''}" (struck by ${x.history.filter((h) => h.action === 'struck').slice(-1)[0]?.reviewer ?? 'a reviewer'})`, trust: 'struck' as const, cite: `§${x.section}` }));
  sections.push({ id: 'struck', heading: 'Checked and set aside', items: struck.length ? struck : [{ text: 'Nothing struck yet.', trust: 'ink' }] });

  const assumptions: InquiryItem[] = [
    { text: `The building we described above (width, depth, stories, height) is our proposal, not a requirement.`, trust: 'red' },
    ...r.questions.filter((q) => q.trust === 'red').map((q) => ({ text: `We explored an answer to an open question, but we are not relying on it: ${q.text}`, trust: 'red' as const })),
  ];
  if (m) assumptions.push({ text: `Soft costs (${Math.round(m.with_assumptions.soft * 100)}%) and financing (${Math.round(m.with_assumptions.financing * 100)}%) are our assumptions and are left out of the gap; with them, vertical construction comes to ${usd(m.with_assumptions.lo)}–${usd(m.with_assumptions.hi)} per home, still without site work or land. Home size: ${m.sqft.toLocaleString('en-US')} sq ft (our proposal).`, trust: 'red' });
  sections.push({ id: 'assumptions', heading: 'Our assumptions', items: assumptions });

  sections.push({
    id: 'not_assessed',
    heading: 'Not assessed',
    items: [
      { text: 'Title, liens and back taxes. Soil, environmental, water and sewer: see the site section above.', trust: 'ink' },
      { text: `Community priorities: we will bring this to the Registered Community Organization${rco ? ` (${rco})` : ''} before choosing a design.`, trust: 'ink' },
    ],
  });

  const recipients = [
    ...(cityLots.length ? [{ who: 'City of Pittsburgh, Department of City Planning, Real Estate', why: 'public-sale inquiry for the City-owned lots' }] : []),
    { who: 'Zoning Administrator, Department of City Planning', why: 'the open code questions' },
    ...(rco ? [{ who: `RCO: ${rco}`, why: 'the community meeting' }] : []),
    ...(m ? [{ who: 'Urban Redevelopment Authority of Pittsburgh', why: 'gap financing for small for-sale infill' }] : []),
  ];

  const title =
    ps.length > 1
      ? `${tpl.name} on ${lotRange(ps)}, ${ps.find((p) => p.addr_street)?.addr_street ?? block.meta.main_street} (${block.meta.name})`
      : `${tpl.name} at ${ps[0].addr.replace(' (no number)', '')} (lot ${ps[0].lot}${ps[0].lot_suffix ?? ''}, ${block.meta.name})`;
  const subtitle = `${block.meta.name}, ${block.meta.neighborhood} · ${r.district} · draft ${date}`;
  const lines: string[] = [`# ${title}`, subtitle, '', `To: ${recipients.map((x) => `${x.who} (${x.why})`).join('; ')}`, `From: ${FROM_PLACEHOLDER}`, ''];
  for (const sec of sections) {
    lines.push(`## ${sec.heading}${sec.to ? ` (for ${sec.to})` : ''}`);
    sec.items.forEach((it, i) => lines.push(`${sec.id === 'next' ? `${i + 1}.` : '-'} ${it.trust === 'red' ? (sec.id === 'build' ? '[our proposal] ' : '[our assumption] ') : it.trust === 'estimate' ? '[screening estimate] ' : it.trust === 'pencil' && sec.id !== 'next' ? '[open] ' : it.trust === 'struck' ? '[set aside] ' : ''}${it.text}${it.cite ? ` (${it.cite})` : ''}`));
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
  return { title, subtitle, date, from: FROM_PLACEHOLDER, recipients, sections, disclaimer: DISCLAIMER, check: { ok: unknown.length === 0, unknown, checked }, text, markdown };
}
