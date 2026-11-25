// "PV PROV open contracts" screen: sheet_snapshot rows (data = {header: displayed text}) of the Circulars tabs
// "PV PROV open contracts" + "PV ITEM FACTORS" + "PV INDEX MONTHLY" -> our PV per unit next to the sheet's own "PV VALUE".
// Only the linear IEEMA cable formula is verified (COSTING_RULES.md PV sections B and H): CACMAI, conductor and MVCC rows are
// shown with the sheet's value and a "not verified" note, never computed. Nothing is assumed: a missing base date / terms /
// days code is flagged. The index month is the sheet's own "APPLICABLE DATE" column (cross-checked when a days code exists).
import {
  type IndexKey, type IndexPoint, type IndexSeries, type IndexSpec, type PvComponent,
  FACTOR_INDEX_MAP, addMonths, firstOfMonth, indexSpecFor, offerAdvice, parseSheetDate, pvValue,
} from "../costing/pv";

export type SheetRow = Record<string, string>;
export type PvRowStatus = "MATCH" | "DIFFER" | "COMPUTED" | "NOT COMPUTED";   // COMPUTED = we have a value, the sheet shows no number
export interface PvRow {
  key: string; contract: string; itemCode: string; itemName: string; lot: string; customer: string;
  baseDate: string | null; applicableDate: string | null;
  sheetPvText: string; sheetPv: number | null;
  pv: number | null; pvCapped: number | null; diff: number | null; pctPv: number | null; ceilingApplied: boolean;
  status: PvRowStatus; note: string;                    // note = why it was not computed
  advice: string | null; sheetAdvice: string; warnings: string[];
}

const num = (t: string | undefined): number | null => {
  const s = (t ?? "").replace(/[,₹\s]/g, ""); if (!s) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};

// PV INDEX MONTHLY headers (matched by prefix so a renamed unit in brackets does not break the read).
const INDEX_COLS: [string, IndexKey][] = [
  ["AL", "AL"], ["CU", "CU"], ["STEEL FLAT", "STEEL_FLAT"], ["STEEL WIRE", "STEEL_WIRE"], ["PVC", "PVC"],
  ["XLPE LV", "XLPE_LV"], ["XLPE HV", "XLPE_HV"], ["PE", "PE"], ["ZINC", "ZINC"],
];
const cell = (r: SheetRow, prefix: string) => { const k = Object.keys(r).find(h => h === prefix || h.startsWith(prefix + " ")); return k ? r[k] : undefined; };

/** The index date column is always the 1st of a month, but the provisional row is displayed as M/D/YYYY ("11/1/2026"). */
function indexMonth(t: string | undefined): string | null {
  const m = (t ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${(m[2] === "1" ? m[1] : m[2]).padStart(2, "0")}-01`;
  const d = parseSheetDate(t); return d && firstOfMonth(d);
}

export function indexSeriesFromRows(rows: SheetRow[]): IndexSeries {
  const series: IndexSeries = {};
  for (const r of rows) {
    const date = indexMonth(cell(r, "IEEMA CABLE INDEX DATE")); if (!date) continue;
    const provisional = /PROVISIONAL/i.test(cell(r, "TYPE") ?? "");
    for (const [prefix, key] of INDEX_COLS) {
      const value = num(cell(r, prefix)); if (value == null) continue;
      (series[key] ??= [] as IndexPoint[]).push(provisional ? { date, value, provisional } : { date, value });
    }
  }
  return series;
}

/** PV ITEM FACTORS row -> linear components. The single "FeF / FeW" column is steel wire for WIRE armour, steel flat otherwise. */
function componentsFor(f: SheetRow): PvComponent[] {
  const steel = f["ARMOUR KEY"] === "WIRE" ? "FeW" : "FeF";
  const cols: [string, string][] = [["AlF", "AlF"], ["CuF", "CuF"], ["XLF", "XLF"], ["SMIF", "SMIF (Cu tape)"], [steel, "FeF / FeW"], ["CCF", "CCF (PVC/PE)"]];
  return cols.map(([name, col]) => ({ name, factor: num(f[col]) ?? 0, indexKey: FACTOR_INDEX_MAP[name] })).filter(c => c.factor !== 0);
}

const NOT_VERIFIED_FAMILY: Record<string, string> = {
  CONDUCTOR: "not verified: conductor formula (WA/WF weights, ratio form)",
  MVCC: "not verified: MVCC covered-conductor formula (WA/WAL/WSc/WI/WO weights)",
};

export function mapPvRows(contracts: SheetRow[], factors: SheetRow[], index: SheetRow[], today: string): PvRow[] {
  const series = indexSeriesFromRows(index);
  const factorByItem = new Map(factors.map(f => [(f["ITEM CODE"] ?? "").trim(), f]));
  return contracts.map(r => {
    const g = (k: string) => (r[k] ?? "").trim();
    const warnings: string[] = [];
    const baseDate = parseSheetDate(g("PV BASE DATE")), applicableDate = parseSheetDate(g("APPLICABLE DATE"));
    const terms = g("PV TERMS"), code = g("PV DAYS (code)"), basis = g("IEEMA/ CACMAI").toUpperCase();
    const offered = parseSheetDate(g("PV OFFER DATE")), schEnd = parseSheetDate(g("SCH END")) ?? parseSheetDate(g("LAST DATE (DELIVERY SCH END)"));
    const f = factorByItem.get(g("ITEM CODE")), family = (f?.["PV FAMILY"] ?? "").trim().toUpperCase();
    if (!baseDate) warnings.push("PV base date missing - take it from the contract/docket, do not assume");
    if (!terms) warnings.push("PV terms missing");
    if (!code) warnings.push("PV days code missing - applicable date is the sheet's, not derived");

    let codeSpec: IndexSpec | null = null, codeError = "";
    if (code) try { codeSpec = indexSpecFor(code, today); } catch { codeError = `unknown PV days code: ${code}`; }

    const note =
      basis !== "IEEMA" ? (basis ? `not verified: ${basis} formula` : "IEEMA/CACMAI basis missing")
      : !f ? "item not in PV ITEM FACTORS"
      : NOT_VERIFIED_FAMILY[family] ? NOT_VERIFIED_FAMILY[family]
      : !baseDate ? "base date missing"
      : !applicableDate ? "applicable date missing"
      : codeError ? codeError
      : codeSpec && codeSpec.kind !== "MONTHLY" ? `not verified: days code ${code.split("@")[0]} needs a daily index (only the monthly IEEMA index is loaded)`
      : "";

    const sheetPvText = g("PV VALUE"), sheetPv = /\d/.test(sheetPvText) ? num(sheetPvText) : null;
    const row: PvRow = {
      key: g("SPECIAL JOIN (Contract@Item@Lot)") || `${g("Contract Number")}@${g("ITEM CODE")}@${g("LOT REVIEWED")}`,
      contract: g("Contract Number"), itemCode: g("ITEM CODE"), itemName: g("ITEM NAME"), lot: g("LOT REVIEWED"), customer: g("Customer Name"),
      baseDate, applicableDate, sheetPvText, sheetPv, pv: null, pvCapped: null, diff: null, pctPv: null, ceilingApplied: false,
      status: "NOT COMPUTED", note, advice: null, sheetAdvice: g("OFFER RECOMMENDATION"), warnings,
    };
    if (note || !f || !baseDate || !applicableDate) return row;

    const components = componentsFor(f);
    // "CEILING LIMIT" is blank in every live row: its format (20 / 20% / 0.2) is not confirmed, all three are read as 20 %.
    const ceil = num(g("CEILING LIMIT").replace("%", ""));
    const at = (applicableSpec: IndexSpec) => pvValue({
      components, series, baseSpec: { kind: "MONTHLY", month: baseDate }, applicableSpec,
      basePrice: num(g("BASE PRICE/ PO PRICE WITHOUT FREIGHT/ GST")), ceilingPct: ceil == null ? undefined : ceil > 1 ? ceil / 100 : ceil,
    });
    const o = at({ kind: "MONTHLY", month: applicableDate });
    warnings.push(...o.notes);
    if (o.pv == null) return { ...row, note: "index missing" };

    if (baseDate !== firstOfMonth(baseDate)) warnings.push(`base date ${baseDate} is not the 1st: index of that month used`);
    if ((f["STATUS"] ?? "OK").trim().toUpperCase() !== "OK") warnings.push(`PV ITEM FACTORS status: ${f["STATUS"]}`);
    if (family === "HT" && components.some(c => c.name === "XLF")) warnings.push("XLPE LV index used for an HT cable (LV/HV selection not verified)");
    if (/HDPE|\bPE\b/i.test(g("ITEM NAME")) && components.some(c => c.name === "CCF")) warnings.push("CCF priced on the PVC index for a PE-sheathed item (PE vs PVC not verified)");
    if (o.provisionalUsed) warnings.push("provisional index used for main metals");
    if (o.status === "CEILING APPLIED" && o.pv < 0) warnings.push("ceiling applied to a negative PV (not verified)");
    if (codeSpec?.kind === "MONTHLY") {
      // Cross-check only (never replaces the sheet's date): event = offer date, or today when not offered, capped by the schedule end.
      const start = offered ?? today, event = schEnd && schEnd < start ? schEnd : start;
      const derived = indexSpecFor(code, event);
      if (derived.kind === "MONTHLY" && derived.month !== firstOfMonth(applicableDate)) warnings.push(`CHECK applicable date: sheet ${applicableDate}, rule ${code.split("@")[0]} on ${event} gives ${derived.month}`);
    }

    let advice: string | null = null;
    const qty = num(g("QTY")) ?? 0;
    if (offered) advice = offerAdvice({ today, lastDate: schEnd, pvThisMonth: o.pvCapped!, pvNextMonthProvisional: null, qty, alreadyOfferedOn: g("PV OFFER DATE") }).recommendation;
    else if (codeSpec) {                                   // offer now vs next month needs the days code: no code -> no advice (flagged above)
      const now = at(codeSpec), next = at(indexSpecFor(code, addMonths(today, 1)));
      if (now.pvCapped != null) advice = offerAdvice({ today, lastDate: schEnd, pvThisMonth: now.pvCapped, pvNextMonthProvisional: next.pvCapped, qty }).recommendation;
    }

    const diff = sheetPv == null ? null : o.pv - sheetPv;                          // "PV VALUE" is the uncapped figure
    return {
      ...row, pv: o.pv, pvCapped: o.pvCapped, pctPv: o.pctPv, ceilingApplied: o.status === "CEILING APPLIED", diff, advice,
      status: diff == null ? "COMPUTED" : Math.abs(diff) <= 1 ? "MATCH" : "DIFFER",        // 1 = rounding
    };
  });
}

export function summarizePvRows(rows: PvRow[]): string {
  const n = (s: PvRowStatus) => rows.filter(r => r.status === s).length;
  const extra = n("COMPUTED") ? `, ${n("COMPUTED")} computed where the sheet has no number` : "";
  return `${rows.length} rows, ${n("MATCH")} match the sheet, ${n("DIFFER")} differ, ${n("NOT COMPUTED")} not computed${extra}`;
}
