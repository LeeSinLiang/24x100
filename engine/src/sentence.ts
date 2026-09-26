// The one sentence that rewrites itself from state (the "lens lab" pattern). Built only from the
// result object, so the words can't disagree with the plate or the ledger. Each segment carries the
// trust of the number it shows and a reference the UI opens in the evidence drawer.
import { NARROW_Q } from './evaluate';
import { ftInt, ft1, int, listAnd } from './format';
import { getQuestion, pick } from './rules';
import { TEMPLATES } from './templates';
import type { BlockFile, LotResult, RuleSet, Trust } from './types';
import type { UnlockOption } from './unlock';

export interface Seg {
  t: string;
  trust?: Trust;
  ref?: string; // "rule:<id>" | "record:<pin>:<field>" | "measure:width" | "question:<id>"
  num?: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtFt(n: number): string {
  return Number.isInteger(Math.round(n * 10) / 10) ? ftInt(n) : ft1(n);
}

function lotsLabel(block: BlockFile, pins: string[]): string {
  const lots = pins.map((p) => block.parcels.find((x) => x.pin === p)?.lot).filter((x): x is number => x != null);
  const s = [...lots].sort((a, b) => a - b);
  return s.length > 1 ? `lots ${s[0]}–${s[s.length - 1]}` : `lot ${s[0]}`;
}

/** "5-7-2025" → "May 2025". */
function monthYear(effective: string): string {
  const m = effective.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  return m ? `${MONTHS[Number(m[1]) - 1]} ${m[3]}` : effective;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2241 Mahon St", or "Lot 34 on Mahon St" when the records carry no house number. */
export function placeName(p: { addr: string; lot: number | null } | undefined): string {
  if (!p) return '';
  const m = p.addr.match(/^(.*) \(no number\)$/);
  return m ? `Lot ${p.lot} on ${m[1]}` : p.addr;
}

export function headline(r: LotResult, block: BlockFile, rs: RuleSet): Seg[] {
  const p0 = block.parcels.find((p) => p.pin === r.pins[0]);
  const addr = placeName(p0) || r.pins[0];
  const tpl = TEMPLATES[r.scenario.type];
  if (r.state === 'refused') {
    if (r.refusal?.code === 'records_disagree') {
      const v = r.refusal.values ?? {};
      return [
        { t: `${v.addr ?? addr}: can't score. ` },
        { t: 'The County says ' },
        { t: `${int(Number(v.assessed))} sf`, num: true, ref: `record:${v.pin}:lotarea` },
        { t: '; the City map measures ' },
        { t: `${int(Number(v.mapped))} sf`, num: true, ref: `record:${v.pin}:poly` },
        { t: '.' },
      ];
    }
    return [{ t: `${addr}: can't score. ` }, { t: r.refusal?.reason ?? '' }];
  }
  const W = r.width!;
  const w = W.deed ?? W.mapped;
  const wSeg: Seg = { t: `${fmtFt(w)} ft`, num: true, trust: W.trust, ref: 'measure:width' };
  const width = r.checks.find((c) => c.id === 'width')!;
  const area = r.checks.find((c) => c.id === 'area')!;
  const minRule = pick(rs, 'min_lot_area');
  const out: Seg[] = [];
  if (r.scenario.type === 'row') {
    const q = getQuestion(rs, NARROW_Q);
    const lots = lotsLabel(block, r.pins);
    out.push({ t: `Rowhouses on ${lots}: end units get ` }, wSeg);
    const alt = r.checks.find((c) => c.id === 'width')!.alternative;
    if (q && q.status === 'open' && alt) {
      out.push({ t: ', or ' }, { t: `${fmtFt(alt.available)} ft`, num: true, trust: 'pencil', ref: `question:${NARROW_Q}` }, { t: ' if the narrow-lot rule covers attached houses' });
    } else if (q && q.status === 'assumed') out.push({ t: ' ' }, { t: 'under your assumption', trust: 'red', ref: `question:${NARROW_Q}` });
    out.push({ t: '.' });
    return out;
  }
  if (r.pins.length > 1) {
    out.push({ t: `Combined, ${lotsLabel(block, r.pins)} give a ${tpl.name.toLowerCase()} ` }, wSeg, { t: ' of width as of right.' });
    return out;
  }
  if (area.status === 'pass' && minRule && typeof minRule.value === 'number') {
    const exact = area.available === minRule.value;
    const since = minRule.enacted ? `Since ${monthYear(minRule.enacted.effective)}, ` : '';
    out.push(
      { t: `${since}${addr} meets the minimum lot size${exact ? ' exactly' : ''} (` },
      { t: `${int(minRule.value)} sf`, num: true, trust: minRule.state === 'ink' ? 'ink' : 'pencil', ref: `rule:${minRule.id}` },
      { t: '). ' },
    );
    if (width.status === 'fail') out.push({ t: `A ${tpl.name.toLowerCase()} still gets ` }, wSeg, { t: '.' });
    else out.push({ t: `A ${tpl.name.toLowerCase()} gets ` }, wSeg, { t: ' of width as of right.' });
    return out;
  }
  if (area.status === 'fail' && minRule && typeof minRule.value === 'number') {
    out.push(
      { t: `${addr} is under the minimum lot size (` },
      { t: `${int(area.available ?? 0)} sf`, num: true, trust: area.trust, ref: `record:${r.pins[0]}:deed` },
      { t: ' of ' },
      { t: `${int(minRule.value)} sf`, num: true, trust: minRule.state === 'ink' ? 'ink' : 'pencil', ref: `rule:${minRule.id}` },
      { t: `), and a ${tpl.name.toLowerCase()} would get ` },
      wSeg,
      { t: '.' },
    );
    return out;
  }
  out.push({ t: `${addr}: a ${tpl.name.toLowerCase()} gets ` }, wSeg, { t: ' of width as of right.' });
  return out;
}

/** The explanation under the headline: geometry · proposal · regulation · procedure, in that order. */
export function explanation(r: LotResult, block: BlockFile): Seg[] {
  if (r.state === 'refused') return [{ t: r.refusal?.reason ?? '' }];
  const tpl = TEMPLATES[r.scenario.type];
  const W = r.width!;
  const w = W.deed ?? W.mapped;
  const width = r.checks.find((c) => c.id === 'width')!;
  const P = r.scenario.proposal;
  const out: Seg[] = [];
  if (r.scenario.type === 'row') {
    out.push({ t: `${width.text} `, trust: width.trust });
  } else {
    out.push(
      { t: `As of right, the widest ${tpl.name.toLowerCase()} here is ` },
      { t: `${fmtFt(w)} ft`, num: true, trust: W.trust, ref: 'measure:width' },
      { t: ` (${W.formula}). ` },
    );
    const rel = r.relief.find((x) => x.check === 'width');
    if (width.status === 'fail' && rel) {
      out.push({ t: 'Your ' }, { t: `${fmtFt(P.width)} ft`, num: true, trust: 'red', ref: 'proposal:width' }, { t: ` proposal needs the ${rel.text.replace(/^side setbacks /, 'side setbacks cut from ').replace(' → ', ' to ')}, which is a variance. ` });
    } else if (width.status === 'pass') {
      out.push({ t: 'Your ' }, { t: `${fmtFt(P.width)} ft`, num: true, trust: 'red', ref: 'proposal:width' }, { t: ' proposal fits. ' });
    }
  }
  const ctx = r.checks.find((c) => c.id === 'contextual');
  if (ctx) out.push({ t: ctx.text, trust: ctx.trust, ref: ctx.rule_ids[0] ? `rule:${ctx.rule_ids[0]}` : undefined });
  const owners = r.pins
    .map((pin) => block.parcels.find((p) => p.pin === pin)!)
    .filter((p) => !p.city)
    .sort((x, y) => (x.lot ?? 0) - (y.lot ?? 0))
    .map((p) => `lot ${p.lot}`);
  if (r.pins.length > 1 && owners.length) out.push({ t: ` ${cap(listAnd(owners))} ${owners.length > 1 ? "aren't" : "isn't"} City-owned.` });
  return out;
}

export function nextStep(u: { recommended: UnlockOption | null; options: UnlockOption[] }, block: BlockFile): { primary: UnlockOption | null; fewest: UnlockOption | null; text: string } {
  const fewest = u.options.find((o) => o.fits && o.discretionary === 0 && !o.hypothetical && !o.pending) ?? null;
  const primary = u.recommended;
  if (!primary && !fewest) return { primary: null, fewest: null, text: 'No lever on this list fits without a variance. Ask for the variance, or ask the City.' };
  const describe = (o: UnlockOption) => {
    const w = o.result.width ? fmtFt(o.result.width.deed ?? o.result.width.mapped) : '—';
    const buy = o.scenario.pins
      .map((pin) => block.parcels.find((p) => p.pin === pin)!)
      .filter((p) => !p.city)
      .map((p) => `lot ${p.lot}`);
    return `${o.label}: ${w} ft${buy.length ? `; ${listAnd(buy)} ${buy.length > 1 ? "aren't" : "isn't"} City-owned` : ''}`;
  };
  const parts = [primary ? describe(primary) : null, fewest && fewest !== primary ? `fewest approvals overall: ${describe(fewest)}` : null].filter(Boolean);
  return { primary, fewest, text: parts.join(' · ') };
}
