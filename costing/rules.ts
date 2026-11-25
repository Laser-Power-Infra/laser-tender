// Pure costing rules taken from "LASER Costing - All Instructions" (project doc, 16 Nov 2026).
// Everything here is deterministic and unit-tested. Items marked TO VERIFY are interpretations Puja/Touhid must confirm
// by running the parity harness (parity.ts) against Touhid's sheets.

export type ConsumptionSource = 'DOCKET_SPEC' | 'SAME_UTILITY_SPEC' | 'APPROVED_GTP' | 'GTP_SENT_TO_UTILITY' | 'IS_STANDARD';
/** Source order from section 5 of the instructions. Never guess consumption: if none is available the caller must flag the item, not invent numbers. */
export const CONSUMPTION_ORDER: ConsumptionSource[] = ['DOCKET_SPEC', 'SAME_UTILITY_SPEC', 'APPROVED_GTP', 'GTP_SENT_TO_UTILITY', 'IS_STANDARD'];

export interface RmLine { rm_name: string; consumption: number; unit?: string; source: ConsumptionSource; source_ref: string; formula: string }
export interface ConsumptionCandidate { source: ConsumptionSource; source_ref: string; lines: Omit<RmLine, 'source' | 'source_ref'>[] }

export function resolveConsumption(cands: ConsumptionCandidate[]): RmLine[] | null {
  for (const s of CONSUMPTION_ORDER) {
    const c = cands.find(x => x.source === s && x.lines.length > 0);
    if (c) return c.lines.map(l => ({ ...l, source: c.source, source_ref: c.source_ref }));
    }
  return null;     // caller: mark item "consumption not available - ask Soumitra/Soumyashree", never assume
}

// ------------------------------------------------------------------ RM rates
export interface RateRow { rate_date: string; rm_name: string; rate: number }
export type RmPolicy = 'FIRM' | 'PV';
export interface RateResult { rate: number | null; rate_date: string | null; note: string }

const iso = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** FIRM (or price basis not stated) -> today's rate. PV -> rate on the enquiry base date. Already-sent firm quotation -> pass its quotation date as baseDate with policy 'PV'.
 *  Uses the latest rate on or before the target date (rates are carried forward, as the DAILY MKT CP rule says). */
export function rmRateFor(rates: RateRow[], rm: string, policy: RmPolicy, today: string, baseDate?: string | null): RateResult {
  let target = today; let note = 'firm: today';
  if (policy === 'PV') {
    if (baseDate) { target = iso(baseDate); note = 'price variation: enquiry base date'; }
    else note = 'PV but no base date -> used today (FLAG)';
  }
  let best: RateRow | null = null;
  for (const r of rates) if (r.rm_name === rm && r.rate_date <= target && (!best || r.rate_date > best.rate_date)) best = r;
  return best ? { rate: best.rate, rate_date: best.rate_date, note } : { rate: null, rate_date: null, note: `no rate on/before ${target} (FLAG)` };
}

// ------------------------------------------------------------------ interest
export interface InterestInput { statedCreditDays?: number | null; partyLastQuoteDays?: number | null; orderValueRupees: number }
/** 1% per 30 days. Terms stated -> use; else party's last quote; else < Rs 50 lakh = advance (0 days), > Rs 50 lakh = 60 days LC. */
export function interestPct(i: InterestInput): { pct: number; days: number; basis: string } {
  let days: number; let basis: string;
  if (i.statedCreditDays != null) { days = i.statedCreditDays; basis = 'party terms'; }
  else if (i.partyLastQuoteDays != null) { days = i.partyLastQuoteDays; basis = "party's last quote"; }
  else if (i.orderValueRupees < 50_00_000) { days = 0; basis = 'default: < Rs 50 lakh = advance'; }
  else { days = 60; basis = 'default: >= Rs 50 lakh = 60 days LC'; }   // boundary (exactly 50 lakh) TO VERIFY
  return { pct: (days / 30) * 1, days, basis };
}

// ------------------------------------------------------------------ drums
export const DRUM_MAKING_UP_TO_54 = 150, DRUM_MAKING_ABOVE_54 = 200;
export const drumMakingCharge = (flangeInch: number) => (flangeInch <= 54 ? DRUM_MAKING_UP_TO_54 : DRUM_MAKING_ABOVE_54);
export const mmToInch = (mm: number) => mm / 25.4;

/** Drum cost from DRUM MASTER: column N; blank -> column D and list for Puja (usedFallback=true). */
export function drumFromMaster(m: { cost_col_n: number | null; cost_col_d: number | null }): { cost: number | null; usedFallback: boolean } {
  if (m.cost_col_n != null) return { cost: m.cost_col_n, usedFallback: false };
  if (m.cost_col_d != null) return { cost: m.cost_col_d, usedFallback: true };
  return { cost: null, usedFallback: false };
}
/** Drum cost built from its BOM: sum(consumption x last purchase rate) + making charge. No BOM -> approx 3 x flange price. */
export function drumFromBom(bom: { consumption: number; lastRate: number }[] | null, flangeInch: number, flangePrice?: number): { cost: number | null; basis: string } {
  if (bom && bom.length) return { cost: bom.reduce((a, b) => a + b.consumption * b.lastRate, 0) + drumMakingCharge(flangeInch), basis: 'drum BOM x last purchase rate + making' };
  if (flangePrice != null) return { cost: 3 * flangePrice, basis: 'no drum BOM: 3 x flange price' };
  return { cost: null, basis: 'no drum BOM and no flange price (FLAG)' };
}

// ------------------------------------------------------------------ freight
export interface FreightRow { to_pin: string | null; to_location?: string | null; vehicle_type: string; rate_per_trip: number; rate_date: string; abnormal: boolean }
const monthsBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / (30.4375 * 86400000);

/** Per-trip freight for a vehicle type. Rules: never FREIGHT ABNORMAL; <= 6 months old as is, older +5%; several rates for the same vehicle -> lowest;
 *  no history for the pin -> nearest by pin-code prefix (longest shared prefix, minimum 3 digits - TO VERIFY with Puja). */
export function freightPerTrip(rows: FreightRow[], pin: string, vehicle: string, today: string): { perTrip: number | null; basis: string } {
  const ok = rows.filter(r => !r.abnormal && r.vehicle_type === vehicle);
  const adj = (r: FreightRow) => (monthsBetween(r.rate_date, today) <= 6 ? r.rate_per_trip : r.rate_per_trip * 1.05);
  const exact = ok.filter(r => r.to_pin === pin);
  const pick = (rs: FreightRow[]) => rs.reduce((m, r) => (adj(r) < adj(m) ? r : m));
  if (exact.length) return { perTrip: round2(adj(pick(exact))), basis: `pin ${pin} history (lowest)` };
  for (let n = pin.length - 1; n >= 3; n--) {
    const near = ok.filter(r => r.to_pin && r.to_pin.slice(0, n) === pin.slice(0, n));
    if (near.length) return { perTrip: round2(adj(pick(near))), basis: `nearest by pin prefix ${pin.slice(0, n)} (FLAG: verify)` };
  }
  return { perTrip: null, basis: 'no freight history (FLAG)' };
}
/** Always a full truck/trailer: trips = ceil(drums / max drums per truck); total = trips x per-trip. No delivery location -> ex-works, no freight. */
export function freightTotal(perTrip: number | null, drums: number, maxDrumsPerTruck: number, hasDeliveryLocation: boolean): { total: number; trips: number; basis: string } {
  if (!hasDeliveryLocation) return { total: 0, trips: 0, basis: 'ex-works (no delivery location)' };
  if (perTrip == null || maxDrumsPerTruck <= 0) return { total: 0, trips: 0, basis: 'freight not computable (FLAG)' };
  const trips = Math.ceil(drums / maxDrumsPerTruck);
  return { total: round2(trips * perTrip), trips, basis: `${trips} full truck(s) x ${perTrip}` };
}

// ------------------------------------------------------------------ BOM match (<= 1%)
/** Match the item's computed RM consumption against NON CHAIN BOMs. Interpretation (TO VERIFY): same RM set and every RM within 1% (relative).
 *  Returns the closest matching bom_id or null -> caller writes "no matching non-chain BOM". */
export function matchNonChainBom(required: Record<string, number>, boms: Record<string, Record<string, number>>, tol = 0.01): { bomId: string | null; note: string } {
  let best: { id: string; worst: number } | null = null;
  const keys = Object.keys(required);
  for (const [id, lines] of Object.entries(boms)) {
    const bk = Object.keys(lines);
    if (bk.length !== keys.length || !keys.every(k => k in lines)) continue;
    const worst = Math.max(...keys.map(k => (required[k] === 0 ? (lines[k] === 0 ? 0 : Infinity) : Math.abs(lines[k] - required[k]) / Math.abs(required[k]))));
    if (worst <= tol && (!best || worst < best.worst)) best = { id, worst };
  }
  return best ? { bomId: best.id, note: `matched within ${(best.worst * 100).toFixed(2)}%` } : { bomId: null, note: 'no matching non-chain BOM' };
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
