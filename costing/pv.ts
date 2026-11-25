// Price Variation (PV) logic, reverse-engineered from the live Circulars sheet (tabs: PV PROV open contracts, PV ITEM FACTORS,
// PV FACTOR MASTER, PV DATE RULE MAP, PV INDEX MONTHLY) and checked against contract RC25Y-00088 (PV 11,015/km reproduced exactly).
//
//   PV per unit  =  SUM_k  factor_k x ( index_k(applicable date) - index_k(base date) )          [IEEMA cable-style linear formula]
//   capped by the contract ceiling (default 20% of base price) when the base price is known.
//
// What is VERIFIED against the sheet: the linear formula, the ceiling column, the date-rule table, the "offer now vs wait" columns.
// What is TO VERIFY: CACMAI/conductor formulas (they use WA/WAL weights, ratio forms may differ), which metals count as "main metals" for
// provisional prices, holiday handling in working-day rules, and whether the ceiling applies to negative PV too.

export type IndexKey = 'AL' | 'CU' | 'STEEL_FLAT' | 'STEEL_WIRE' | 'PVC' | 'XLPE_LV' | 'XLPE_HV' | 'PE' | 'ZINC';
export interface IndexPoint { date: string; value: number; provisional?: boolean }       // date ISO; monthly series use the 1st of the month
export type IndexSeries = Partial<Record<IndexKey, IndexPoint[]>>;

/** PV ITEM FACTORS columns -> which index they multiply (TO VERIFY for XLF with HT cables and CCF with PE sheaths). */
export const FACTOR_INDEX_MAP: Record<string, IndexKey> = { AlF: 'AL', CuF: 'CU', SMIF: 'CU', XLF: 'XLPE_LV', FeF: 'STEEL_FLAT', FeW: 'STEEL_WIRE', CCF: 'PVC', ZnF: 'ZINC' };
export const MAIN_METALS: IndexKey[] = ['AL', 'CU'];                                          // provisional prices only for these (TO VERIFY list)

// ------------------------------------------------------------------ dates
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const d2s = (d: Date) => d.toISOString().slice(0, 10);
const s2d = (s: string) => new Date(s + 'T00:00:00Z');
export const addDays = (s: string, n: number) => { const d = s2d(s); d.setUTCDate(d.getUTCDate() + n); return d2s(d); };
export const firstOfMonth = (s: string) => s.slice(0, 7) + '-01';
export function addMonths(s: string, n: number): string {            // Excel EDATE semantics (clamps to month end)
  const d = s2d(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d2s(d);
}
const isWorking = (s: string) => { const w = s2d(s).getUTCDay(); return w !== 0 && w !== 6; };   // Mon-Fri; public holidays not modelled (TO VERIFY)
export function firstWorkingDay(monthStart: string): string { let d = firstOfMonth(monthStart); while (!isWorking(d)) d = addDays(d, 1); return d; }
export function lastWorkingDay(monthStart: string): string { let d = addDays(addMonths(firstOfMonth(monthStart), 1), -1); while (!isWorking(d)) d = addDays(d, -1); return d; }

/** Sheet date text -> ISO. Accepts 10-Oct-2025, 01-Dec-24, 1-Jul-2013, 20-09-2025, 2025-09-20. Returns null for blanks / "NOT OFFERED" etc. */
export function parseSheetDate(t: string | null | undefined): string | null {
  if (!t) return null; const s = t.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[a-z]*[-\/ ](\d{2,4})$/);
  if (m) { const mo = MON.indexOf(m[2].toLowerCase()); if (mo < 0) return null; const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// ------------------------------------------------------------------ PV terms: which event date drives the index (PV DATE RULE MAP, section B)
export type EventKind = 'OFFER' | 'DISPATCH' | 'DELIVERY' | 'DI' | 'INSP_NOMINATION' | 'MC' | 'NOT_APPLICABLE';
export function eventKindForTerms(terms: string | null | undefined): EventKind {
  const t = (terms ?? '').toLowerCase().replace(/\s+/g, '');
  if (!t || t === 'na') return 'NOT_APPLICABLE';
  if (t.includes('offer')) return 'OFFER';
  if (t.includes('dispatch')) return 'DISPATCH';
  if (t.includes('delivery')) return 'DELIVERY';
  if (t.includes('backfromdi')) return 'DI';
  if (t.includes('nomination') || t.includes('inspection')) return 'INSP_NOMINATION';
  if (t.includes('mc')) return 'MC';
  return 'NOT_APPLICABLE';
}
/** "BackfromInspOffer date(-), 1ST DAY OF PREVIOUS MONTH" style terms: the offer date is moved to the 1st of the previous month. */
export const termsMoveToFirstOfPrevMonth = (terms: string | null | undefined) => /1ST DAY OF PREVIOUS MONTH/i.test(terms ?? '');

// ERP calendar codes PV1..PVG -> signed days from the event (PV DATE RULE MAP section A)
export const ERP_PV_DAYS: Record<string, { event: EventKind; days: number }> = {
  PV1: { event: 'DISPATCH', days: 60 }, PV2: { event: 'DISPATCH', days: -60 }, PV3: { event: 'DISPATCH', days: 30 }, PV4: { event: 'DISPATCH', days: -30 },
  PV5: { event: 'DISPATCH', days: 90 }, PV6: { event: 'DISPATCH', days: -90 },
  PV7: { event: 'INSP_NOMINATION', days: 60 }, PV8: { event: 'INSP_NOMINATION', days: -60 }, PV9: { event: 'INSP_NOMINATION', days: 30 }, PVA: { event: 'INSP_NOMINATION', days: -30 },
  PVB: { event: 'INSP_NOMINATION', days: 90 }, PVC: { event: 'INSP_NOMINATION', days: -90 },
  PVD: { event: 'OFFER', days: -30 }, PVE: { event: 'OFFER', days: -60 }, PVF: { event: 'OFFER', days: -90 }, PVG: { event: 'OFFER', days: -15 },
};

// ------------------------------------------------------------------ "PV Days" code -> index date rule (PV DATE RULE MAP section C)
export type IndexSpec =
  | { kind: 'MONTHLY'; month: string }            // index published for that month (key = 1st of month)
  | { kind: 'MONTH_AVG'; month: string }          // average of the daily series over that calendar month (CACMAI)
  | { kind: 'DAILY'; date: string };              // daily series value on/before that date

/** E = event date. Returns how to read the index. Code is matched on the text before '@' (or the whole text). */
export function indexSpecFor(pvDaysCode: string, E: string): IndexSpec {
  const code = pvDaysCode.split('@')[0].trim().toUpperCase(); const txt = pvDaysCode.toUpperCase();
  const prevMonth = firstOfMonth(addMonths(firstOfMonth(E), -1));
  if (code === 'PMA-IE' && !txt.includes('CACMAI')) return { kind: 'MONTHLY', month: firstOfMonth(addDays(E, -30)) };
  if (code === 'PMA-IE' || code === 'PMA-CA') return { kind: 'MONTH_AVG', month: prevMonth };         // "PMA-IE@PREVIOUS MONTH AVG - CACMAI" appears under PMA-IE in the sheet
  if (code === 'PMD-IE' || code === 'PMD-CA') return { kind: 'DAILY', date: addMonths(E, -1) };
  if (code === '1WDPM-IE' || code === '1WDPM-CA') return { kind: 'DAILY', date: firstWorkingDay(prevMonth) };
  if (code === 'LWDPM-CA') return { kind: 'DAILY', date: lastWorkingDay(prevMonth) };
  const n = code.match(/^(15|30)DP-CA$/) ?? txt.match(/^(15|30) DAYS PRIOR/);
  if (n) return { kind: 'DAILY', date: addDays(E, -Number(n[1])) };
  throw new Error(`unknown PV days code: ${pvDaysCode}`);
}

export interface IndexLookup { value: number | null; provisional: boolean; note: string }
/** Read an index value. Daily/monthly lookups carry forward the last known point on/before the date. Provisional points are used only for MAIN_METALS;
 *  other RMs fall back to the last circular (non-provisional) value - rule stated by Puja. */
export function lookupIndex(series: IndexPoint[] | undefined, spec: IndexSpec, key: IndexKey = 'AL'): IndexLookup {
  if (!series?.length) return { value: null, provisional: false, note: 'no series' };
  const usable = series.filter(p => !p.provisional || MAIN_METALS.includes(key)).sort((a, b) => a.date.localeCompare(b.date));
  const pick = (cut: string) => { let b: IndexPoint | null = null; for (const p of usable) if (p.date <= cut && (!b || p.date >= b.date)) b = p; return b; };
  if (spec.kind === 'MONTH_AVG') {
    const end = addDays(addMonths(spec.month, 1), -1); const pts = usable.filter(p => p.date >= spec.month && p.date <= end);
    if (!pts.length) return { value: null, provisional: false, note: `no daily points in ${spec.month.slice(0, 7)}` };
    return { value: pts.reduce((a, p) => a + p.value, 0) / pts.length, provisional: pts.some(p => p.provisional), note: `avg of ${pts.length} points` };
  }
  const cut = spec.kind === 'MONTHLY' ? spec.month : spec.date; const p = pick(cut);
  return p ? { value: p.value, provisional: !!p.provisional, note: `${p.date}${p.provisional ? ' (provisional)' : ''}` } : { value: null, provisional: false, note: `no index on/before ${cut}` };
}

// ------------------------------------------------------------------ PV value
export interface PvComponent { name: string; factor: number; indexKey: IndexKey }      // e.g. { name:'AlF', factor:0.425, indexKey:'AL' }
export interface PvInput {
  components: PvComponent[]; baseSpec: IndexSpec; applicableSpec: IndexSpec; series: IndexSeries;
  basePrice?: number | null;                // per unit, without freight/GST (column N of PV PROV)
  ceilingPct?: number;                      // default 0.20
}
export interface PvOutput {
  pv: number | null; pvCapped: number | null; pctPv: number | null; status: 'OK' | 'BASE PRICE PENDING' | 'INDEX MISSING' | 'CEILING APPLIED';
  parts: { name: string; factor: number; base: number | null; applicable: number | null; delta: number | null; amount: number | null }[]; notes: string[]; provisionalUsed: boolean;
}
export function pvValue(i: PvInput): PvOutput {
  const notes: string[] = []; let provisionalUsed = false; let missing = false; let sum = 0;
  const parts = i.components.filter(c => c.factor !== 0).map(c => {
    const b = lookupIndex(i.series[c.indexKey], i.baseSpec, c.indexKey), a = lookupIndex(i.series[c.indexKey], i.applicableSpec, c.indexKey);
    if (a.provisional) provisionalUsed = true;
    if (b.value == null || a.value == null) { missing = true; notes.push(`${c.name}/${c.indexKey}: base=${b.note}; applicable=${a.note}`); return { name: c.name, factor: c.factor, base: b.value, applicable: a.value, delta: null, amount: null }; }
    const delta = a.value - b.value; const amount = c.factor * delta; sum += amount;
    return { name: c.name, factor: c.factor, base: b.value, applicable: a.value, delta, amount };
  });
  if (missing) return { pv: null, pvCapped: null, pctPv: null, status: 'INDEX MISSING', parts, notes, provisionalUsed };
  const pv = Math.round(sum);
  if (!i.basePrice) return { pv, pvCapped: pv, pctPv: null, status: 'BASE PRICE PENDING', parts, notes: [...notes, 'base price missing: ceiling not applied'], provisionalUsed };
  const cap = (i.ceilingPct ?? 0.2) * i.basePrice;
  const capped = Math.abs(pv) > cap ? Math.sign(pv) * Math.round(cap) : pv;     // negative side capped too: TO VERIFY
  return { pv, pvCapped: capped, pctPv: capped / i.basePrice, status: capped !== pv ? 'CEILING APPLIED' : 'OK', parts, notes, provisionalUsed };
}

/** "% CHANGE IN COND" column: change of the Al index between base and applicable date. */
export const pctChangeInConductor = (alBase: number, alApplicable: number) => (alApplicable - alBase) / alBase;

// ------------------------------------------------------------------ offer now or later (PV OFFER RECOMMENDATION columns)
export interface OfferAdviceInput { today: string; lastDate: string | null; pvThisMonth: number; pvNextMonthProvisional: number | null; qty: number; alreadyOfferedOn?: string | null }
export interface OfferAdvice { recommendation: string; gainPerUnit: number; lotGain: number }
export function offerAdvice(i: OfferAdviceInput): OfferAdvice {
  const gain = i.pvNextMonthProvisional == null ? 0 : i.pvNextMonthProvisional - i.pvThisMonth;
  const lotGain = Math.round(gain * i.qty);
  if (i.alreadyOfferedOn) return { recommendation: `ALREADY OFFERED ${i.alreadyOfferedOn} (PV/unit ${i.pvThisMonth})`, gainPerUnit: 0, lotGain: 0 };
  if (i.lastDate && i.lastDate < i.today) return { recommendation: 'SCHEDULE OVER - schedule-date index applies; offer ASAP (LD risk)', gainPerUnit: gain, lotGain };
  const nextMonthStart = addMonths(firstOfMonth(i.today), 1);
  const canWait = i.pvNextMonthProvisional != null && (!i.lastDate || i.lastDate >= nextMonthStart);
  if (canWait && gain > 0) return { recommendation: `WAIT: +${Math.round(gain)}/unit next month (provisional) = +${lotGain} for the lot`, gainPerUnit: gain, lotGain };
  return { recommendation: i.pvNextMonthProvisional == null ? 'OFFER NOW (next month index not available)' : gain > 0 ? 'OFFER NOW (schedule ends before next month)' : 'OFFER NOW (waiting does not gain)', gainPerUnit: gain, lotGain };
}
/** Best offer month between contract date and schedule end. months = [{month:'2025-11-01', pv}] -> best + extra vs the current line. */
export function bestOfferMonth(months: { month: string; pv: number }[], currentPv: number): { month: string; pv: number; extra: number } | null {
  if (!months.length) return null; const b = months.reduce((m, x) => (x.pv > m.pv ? x : m));
  return { ...b, extra: Math.round(b.pv - currentPv) };
}

// ------------------------------------------------------------------ quote-stage PV costing (before order)
/** For a PV-basis enquiry the quote price is built with RM rates ON THE ENQUIRY BASE DATE (rmPolicy 'PV' in engine.ts) - base date is taken from the
 *  docket, never assumed (IEEMA default = one month before tender opening is NOT used). This helper gives the PV clause summary to print on the costing sheet. */
export function pvClauseSummary(o: { basis: 'IEEMA' | 'CACMAI'; baseDate: string | null; terms: string | null; pvDaysCode: string | null; ceilingPct?: number }): string[] {
  const w: string[] = [];
  if (!o.baseDate) w.push('PV base date missing in docket - ASK, do not assume (FLAG)');
  if (!o.terms) w.push('PV terms (offer/dispatch/delivery basis) missing (FLAG)');
  if (!o.pvDaysCode) w.push('PV days code missing (FLAG)');
  return [`${o.basis} PV; base date ${o.baseDate ?? '?'}; terms ${o.terms ?? '?'}; index rule ${o.pvDaysCode ?? '?'}; ceiling ${(o.ceilingPct ?? 0.2) * 100}%`, ...w];
}
