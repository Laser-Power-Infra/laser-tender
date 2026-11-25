// Costing engine: one item -> full breakdown. DRAFT ONLY: the engine never sends quotations, never fills a Quotation No.
// and never changes a quoted price (instructions section 9). It only produces numbers + sources for Touhid's review (column L).
import { RmLine, RateRow, RmPolicy, rmRateFor, round2, interestPct, InterestInput } from './rules.ts';

export interface ItemInput {
  qty: number; unit: string;
  rmLines: RmLine[];                         // from resolveConsumption()
  rmRates: RateRow[]; rmPolicy: RmPolicy; baseDate?: string | null; today: string;
  drumCostPerUnit: number;                   // already per unit of qty (drum cost / length etc. - see COSTING_RULES.md TO VERIFY)
  freightPerUnit: number;                    // from freightTotal().total / qty
  pct: { mfg: number; profit: number; insp: number; ttr: number; gst: number };   // fractions, e.g. 0.18
  interest: InterestInput;                   // pct is derived: 1% / 30 days
  specialVaPct?: number | null;              // only if DVG approval is present (caller enforces)
}
export interface RmDetailOut { rm_name: string; consumption: number; unit?: string; rate: number | null; rate_date: string | null; amount: number | null; consumption_source: string; source_ref: string; formula: string; rate_note: string }
export interface ItemOutput {
  rm_cost: number; drum_cost: number; freight: number; ex_works: number; price_ex_gst: number; gst: number; price_incl_gst: number;
  interest: { pct: number; days: number; basis: string };
  rm_detail: RmDetailOut[]; warnings: string[]; markup_order: 'TOUHID_SHEETS_PARTIAL';
}

/** Markup order, taken from Touhid's own costings (CLAUDE COSTINGS sheet, tab "TOUHID ITEMS", 265 costed items, read 24 Nov 2026):
 *    cost      = RM cost + drum cost (per km)                       - "Total RM cost/km" = RM heads + "Drum/km" on every item
 *    1st EXW   = cost x (1 + MFG %)                                  - exact on 265 of 265
 *    EXW       = 1st EXW x (1 + Intt % + Insp % [+ TTR %])           - additive, exact on the 3 items that carry Intt/Insp
 *    price     = EXW x (1 + GST %)                                   - exact on 260 of 265
 *  NOT verified, because no item in those sheets uses them: PROF % and special VA % (placed with MFG, following the sheet's column
 *  order FIRM / MFG / PROF -> 1st EXW), TTR % (placed with Intt/Insp, following Intt / Insp / TTR -> EXW), FIRM %, and freight. */
export function applyMarkups(base: { rm: number; drum: number }, pct: ItemInput['pct'], interestPct: number, vaPct: number) {
  const cost = base.rm + base.drum;
  const mfg = cost * pct.mfg;
  const profit = cost * (pct.profit + vaPct);
  const firstExw = cost + mfg + profit;
  const insp = firstExw * pct.insp;
  const ttr = firstExw * pct.ttr;
  const interest = firstExw * (interestPct / 100);
  return { exWorks: firstExw + insp + ttr + interest, parts: { mfg, insp, ttr, profit, interest } };
}

export function costItem(i: ItemInput): ItemOutput {
  const warnings: string[] = [];
  const rm_detail: RmDetailOut[] = i.rmLines.map(l => {
    const r = rmRateFor(i.rmRates, l.rm_name, i.rmPolicy, i.today, i.baseDate);
    if (r.rate == null) warnings.push(`${l.rm_name}: ${r.note}`);
    else if (r.note.includes('FLAG')) warnings.push(`${l.rm_name}: ${r.note}`);
    return { rm_name: l.rm_name, consumption: l.consumption, unit: l.unit, rate: r.rate, rate_date: r.rate_date, amount: r.rate == null ? null : round2(l.consumption * r.rate),
      consumption_source: l.source, source_ref: l.source_ref, formula: `${l.formula} | amount = consumption x rate`, rate_note: r.note };
  });
  if (rm_detail.some(d => d.amount == null)) warnings.push('RM cost incomplete: at least one RM has no rate');
  const rm = rm_detail.reduce((a, d) => a + (d.amount ?? 0), 0);
  const ip = interestPct(i.interest);
  const m = applyMarkups({ rm, drum: i.drumCostPerUnit }, i.pct, ip.pct, i.specialVaPct ?? 0);
  const exWorks = m.exWorks;
  const priceEx = exWorks + i.freightPerUnit;
  const gst = priceEx * i.pct.gst;
  return {
    rm_cost: round2(rm), drum_cost: round2(i.drumCostPerUnit), freight: round2(i.freightPerUnit), ex_works: round2(exWorks),
    price_ex_gst: round2(priceEx), gst: round2(gst), price_incl_gst: round2(priceEx + gst),
    interest: ip, rm_detail, warnings, markup_order: 'TOUHID_SHEETS_PARTIAL',
  };
}
