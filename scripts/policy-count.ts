// The policy agent's counter (agents/policy): one override in, the same counts build-scenarios.ts writes for S1–S3 out.
// The agent never counts; this runs the citywide classifier through countScenario(), and says which stored rules the
// override touched (none = nothing to change, and the agent refuses).
//   echo '{"value":{"district":"R2-L","field":"rear_setback","to":20}}' | npx tsx scripts/policy-count.ts
import { readFileSync } from 'node:fs';
import { summarize } from '../engine/src/city';
import { classifyAll, countScenario, loadInputs, TYPES, type Override } from './build-scenarios';

const ov: Override = JSON.parse(readFileSync(0, 'utf8'));
const inp = loadInputs();
const base = new Map(TYPES.map((t) => [t, classifyAll(inp, t, null)]));
const districts = summarize(inp.lots, base.get('two')!, 'two').districts.filter((d) => d.computed).map((d) => d.zone);
const matched = ov.value
  ? (inp.rules as unknown as Record<string, unknown>[])
      .filter((r) => r.district === ov.value!.district && r.field === ov.value!.field)
      .map(({ id, value, unit, section, source_file, applies_to }) => ({ id, value, unit, section, source_file, applies_to }))
  : [];
process.stdout.write(JSON.stringify({ districts, matched_rules: matched, by_type: countScenario(inp, base, ov) }) + '\n');
