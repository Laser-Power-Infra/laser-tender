// Parity harness: compare engine output with Touhid's existing sheets so the markup order can be corrected.
// Input JSON: [{ docket, item, expected: { rm_cost, ex_works, price_ex_gst, ... }, input: <ItemInput> }]
//   npx tsx costing/parity.ts costing/parity_cases.json
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { costItem, ItemInput, ItemOutput } from './engine.ts';

export interface ParityCase { docket: string; item: string; input: ItemInput; expected: Partial<Pick<ItemOutput, 'rm_cost' | 'drum_cost' | 'freight' | 'ex_works' | 'price_ex_gst' | 'gst' | 'price_incl_gst'>> }
export interface ParityRow { docket: string; item: string; field: string; expected: number; got: number; diffPct: number; ok: boolean }

export function runParity(cases: ParityCase[], tolPct = 0.5): ParityRow[] {
  const rows: ParityRow[] = [];
  for (const c of cases) {
    const out = costItem(c.input) as unknown as Record<string, number>;
    for (const [field, exp] of Object.entries(c.expected)) {
      const got = out[field]; const diffPct = exp === 0 ? Math.abs(got) : Math.abs(got - (exp as number)) / Math.abs(exp as number) * 100;
      rows.push({ docket: c.docket, item: c.item, field, expected: exp as number, got, diffPct, ok: diffPct <= tolPct });
    }
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]; if (!file) { console.error('usage: tsx costing/parity.ts cases.json'); process.exit(2); }
  const rows = runParity(JSON.parse(fs.readFileSync(file, 'utf8')));
  rows.filter(r => !r.ok).forEach(r => console.log(`MISMATCH ${r.docket} ${r.item} ${r.field}: expected ${r.expected} got ${r.got} (${r.diffPct.toFixed(2)}%)`));
  console.log(`${rows.filter(r => r.ok).length}/${rows.length} fields within tolerance`);
  process.exit(rows.every(r => r.ok) ? 0 : 1);
}
