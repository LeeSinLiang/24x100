import { readFileSync } from 'node:fs';
import { buildRuleSet, DEFAULT_SETTINGS, proposalFor, type BlockFile, type Question, type Rule, type AuditEntry, type EvalContext, type TemplateId, type Scenario } from '../src';

export const block10K = (): BlockFile => JSON.parse(readFileSync('data/blocks/10K.json', 'utf8'));
export const baseRules = (): Rule[] => [
  ...JSON.parse(readFileSync('data/rules/base/rm-m.json', 'utf8')),
  ...JSON.parse(readFileSync('data/rules/base/pgh.json', 'utf8')),
];
export const questions = (): Question[] => JSON.parse(readFileSync('data/rules/questions.json', 'utf8'));

export function ctxFor(block: BlockFile, opts: { rules?: Rule[]; audit?: AuditEntry[]; district?: string } = {}): EvalContext {
  const rs = buildRuleSet(opts.district ?? 'RM-M', opts.rules ?? baseRules(), questions(), opts.audit ?? []);
  return { block, rs, settings: DEFAULT_SETTINGS };
}

export function pinOf(block: BlockFile, lot: number, suffix: string | null = null): string {
  const p = block.parcels.find((x) => x.lot === lot && (x.lot_suffix ?? null) === suffix && x.pin.startsWith('0010K'));
  if (!p) throw new Error(`lot ${lot} not found`);
  return p.pin;
}

export function scen(block: BlockFile, type: TemplateId, lots: number[], over: Partial<Scenario['proposal']> = {}): Scenario {
  return { type, pins: lots.map((l) => pinOf(block, l)), proposal: proposalFor(type, over) };
}
