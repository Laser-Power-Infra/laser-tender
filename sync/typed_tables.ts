// sheet_snapshot -> typed tables (rm_rate, non_chain_bom, freight_rate, drum_master, drums_per_truck). Pure transforms + loadTypedTables(db).
// Layouts below were read from the live sheets on 24 Nov 2026 (not guessed):
//   CIRCULARS / DAILY RM RATES   header row 1: "DATE" + one column per RM; dates "23-Feb-2021"; no unit row.
//   CIRCULARS / DAILY MKT CP     header row 2: "RM ITEM NAME" + one column per RM; row 3 = SOURCE, row 4 = UOM, dates from row 5.
//   MASTER_BOM_ACTUAL / NON CHAIN BOM   header row 3: FG Item, ITEM SCHEDULE, Item Name, BOM Code, IS BOM TOTAL, % DIF FROM IS, TOTAL,
//                                then one column per RM (consumption), last two columns "NOT FOUND IN MRP/IS" (status text).
//   CLAUDE_COSTINGS (read 24 Nov 2026, header row 1 on every tab):
//     FREIGHT RATES            FROM, TO_LOC, TO_PIN, VEHICLE, KM, LAST_FO_DATE (yyyy-mm-dd), LAST_FO, ..., LAST_RATE_PER_TRUCK, MEDIAN_RATE_PER_TRUCK,
//                              MEDIAN_RS_PER_MT, BASIS, RATE_FOR_COSTING_PER_TRUCK, RS_PER_MT_FOR_COSTING. One row per from/to/vehicle.
//     FREIGHT ABNORMAL         TYPE, FO, FO_DATE, DOC, TO_LOC, TO_PIN, VEHICLE, TRUCK, NET_WT_KG, FREIGHT, ... One row per abnormal trip.
//     DRUM MASTER              Drum Code, Drum Type, Drum Size, col D "Drum Cost per Drum (Rs) ...", ..., col N "BOM Drum Cost (Rs) w.e.f. <date>".
//     DRUMS PER TRUCK MASTER   TRUCK_TYPE, DRUM_TYPE, DRUM_SIZE, MAX_DRUMS_PER_TRUCK, ... (drum size text, no drum code).
import { Db, inTransaction } from './lib.ts';

export interface SnapRow { row_no: number; data: Record<string, string> }
export interface RmRateRow { rate_date: string; rm_name: string; rate: number; rate_unit: string | null; source_tab: string }
export interface FreightRateRow { from_location: string | null; to_location: string | null; to_pin: string | null; vehicle_type: string | null; rate_per_trip: number; rate_date: string; abnormal: boolean; source_ref: string }
export interface DrumMasterRow { drum_code: string; description: string | null; flange_dia_inch: number | null; length_m: null; cost_col_n: number | null; cost_col_d: number | null; drum_bom_id: null; source_ref: string }
export interface DrumsPerTruckRow { drum_code: string; vehicle_type: string; max_drums: number }
export interface NonChainBomRow { bom_id: string; erp_code: string | null; rm_name: string; consumption: number; unit: string | null }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "5-Aug-2021" -> "2021-08-05"; anything else -> null. */
export function sheetDate(s: unknown): string | null {
  const m = String(s ?? '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  const mon = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return m && mon >= 0 ? `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
/** "2,492.00" -> 2492; blank, "#N/A" and text -> null. */
export function sheetNumber(s: unknown): number | null {
  const t = String(s ?? '').replace(/,/g, '').trim();
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
}

/** Wide (dates as rows, RMs as columns) -> long. dateKey = header of the date column ("DATE" / "RM ITEM NAME").
 *  A row whose date cell is "UOM" gives the unit per RM. Rates <= 0 and non-numbers are skipped (the engine then carries the last rate forward).
 *  A repeated RM header (rowsToSnapshot names it "<name>_2") keeps the first column only; a repeated date keeps the last row. */
export function rmRatesFromTab(rows: SnapRow[], sourceTab: string, dateKey: string): RmRateRow[] {
  const headers = new Set(rows.flatMap(r => Object.keys(r.data)));
  const isRepeat = (k: string) => /_\d+$/.test(k) && headers.has(k.replace(/_\d+$/, ''));
  const units = rows.find(r => r.data[dateKey]?.trim().toUpperCase() === 'UOM')?.data ?? {};
  const out = new Map<string, RmRateRow>();
  for (const r of rows) {
    const rate_date = sheetDate(r.data[dateKey]);
    if (!rate_date) continue;
    for (const [k, v] of Object.entries(r.data)) {
      const rate = k === dateKey || isRepeat(k) ? null : sheetNumber(v);
      if (rate == null || rate <= 0) continue;
      out.set(`${rate_date}|${k}`, { rate_date, rm_name: k, rate, rate_unit: units[k]?.trim() || null, source_tab: sourceTab });
    }
  }
  return [...out.values()];
}

const BOM_META = new Set(['FG Item', 'ITEM SCHEDULE', 'Item Name', 'BOM Code', 'IS BOM TOTAL', '% DIF FROM IS', 'TOTAL']);
/** One row per BOM, one column per RM -> long. bom_id = "BOM Code", erp_code = "FG Item". The sheet states no unit, so unit stays null. */
export function nonChainBomFromTab(rows: SnapRow[]): NonChainBomRow[] {
  const out = new Map<string, NonChainBomRow>();
  for (const r of rows) {
    const bom_id = r.data['BOM Code']?.trim();
    if (!bom_id) continue;
    for (const [k, v] of Object.entries(r.data)) {
      if (BOM_META.has(k) || k.startsWith('NOT FOUND IN MRP/IS')) continue;
      const consumption = sheetNumber(v);
      if (consumption == null || consumption <= 0) continue;
      out.set(`${bom_id}|${k}`, { bom_id, erp_code: r.data['FG Item']?.trim() || null, rm_name: k, consumption, unit: null });
    }
  }
  return [...out.values()];
}

const txt = (v: unknown) => String(v ?? '').trim() || null;
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : null);

/** FREIGHT RATES -> freight_rate. The sheet's RATE_FOR_COSTING_PER_TRUCK already contains the "+5 % when older than 6 months" uplift,
 *  and costing/rules.ts freightPerTrip applies that rule itself from rate_date. So we store the rate BEFORE the uplift
 *  (the last or the median rate, whichever the sheet used) to avoid adding 5 % twice. */
export function freightRatesFromTab(rows: SnapRow[]): FreightRateRow[] {
  const out: FreightRateRow[] = [];
  for (const r of rows) {
    const d = r.data;
    const rate_date = isoDate(d.LAST_FO_DATE), costing = sheetNumber(d.RATE_FOR_COSTING_PER_TRUCK);
    const last = sheetNumber(d.LAST_RATE_PER_TRUCK), median = sheetNumber(d.MEDIAN_RATE_PER_TRUCK);
    if (!rate_date || costing == null || costing <= 0) continue;
    const k = /^older/i.test(d.BASIS ?? '') ? 1.05 : 1;
    const base = [last, median].find(x => x != null && Math.abs(costing - x * k) <= 1) ?? costing / k;    // sheet rounds to whole rupees
    out.push({ from_location: txt(d.FROM), to_location: txt(d.TO_LOC), to_pin: txt(d.TO_PIN), vehicle_type: txt(d.VEHICLE), rate_per_trip: base, rate_date,
      abnormal: false, source_ref: `FREIGHT RATES ${d.LAST_FO ?? ''} (${d.BASIS ?? ''})`.trim() });
  }
  return out;
}

/** FREIGHT ABNORMAL -> freight_rate with abnormal = true (kept for listing; costing never uses them). */
export function freightAbnormalFromTab(rows: SnapRow[]): FreightRateRow[] {
  const out: FreightRateRow[] = [];
  for (const r of rows) {
    const d = r.data;
    const rate_date = isoDate(d.FO_DATE), rate = sheetNumber(d.FREIGHT);
    if (!rate_date || rate == null) continue;
    out.push({ from_location: null, to_location: txt(d.TO_LOC), to_pin: txt(d.TO_PIN), vehicle_type: txt(d.VEHICLE), rate_per_trip: rate, rate_date,
      abnormal: true, source_ref: `FREIGHT ABNORMAL ${d.FO ?? ''} ${d.DOC ?? ''}: ${d.TYPE ?? ''}`.trim() });
  }
  return out;
}

/** DRUM MASTER -> drum_master. cost_col_n = "BOM Drum Cost (Rs) w.e.f. ..." (the header carries a date, so it is matched by prefix),
 *  cost_col_d = "Drum Cost per Drum (Rs) ...". Flange diameter = first number of a WOOD size ("36 X 14 X 23 X 2", inches);
 *  steel drum sizes are in mm with an unconfirmed dimension order, so their flange stays null. Std length is a list in the sheet -> null. */
export function drumMasterFromTab(rows: SnapRow[]): DrumMasterRow[] {
  const col = (d: Record<string, string>, prefix: string) => { const k = Object.keys(d).find(h => h.startsWith(prefix)); return k ? sheetNumber(d[k]) : null; };
  const out = new Map<string, DrumMasterRow>();
  for (const r of rows) {
    const d = r.data, drum_code = txt(d['Drum Code']);
    if (!drum_code) continue;
    const size = txt(d['Drum Size (F x b x t x Ft)']), type = txt(d['Drum Type']);
    const flange = type === 'WOOD' ? sheetNumber(size?.match(/^\s*(\d+(?:\.\d+)?)\s*X/i)?.[1]) : null;
    out.set(drum_code, { drum_code, description: [type, size].filter(Boolean).join(' ') || null, flange_dia_inch: flange, length_m: null,
      cost_col_n: col(d, 'BOM Drum Cost (Rs)'), cost_col_d: col(d, 'Drum Cost per Drum (Rs)'), drum_bom_id: null, source_ref: 'CLAUDE_COSTINGS / DRUM MASTER' });
  }
  return [...out.values()];
}

/** DRUMS PER TRUCK MASTER -> drums_per_truck. The sheet has no drum code, and the same size text occurs for STEEL and WOODEN,
 *  so drum_code = "<DRUM_TYPE>|<DRUM_SIZE>". Rows without a positive MAX_DRUMS_PER_TRUCK are skipped. */
export function drumsPerTruckFromTab(rows: SnapRow[]): DrumsPerTruckRow[] {
  const out = new Map<string, DrumsPerTruckRow>();
  for (const r of rows) {
    const d = r.data, vehicle_type = txt(d.TRUCK_TYPE), size = txt(d.DRUM_SIZE), max = sheetNumber(d.MAX_DRUMS_PER_TRUCK);
    if (!vehicle_type || !size || max == null || max <= 0) continue;
    const drum_code = `${txt(d.DRUM_TYPE) ?? ''}|${size}`;
    out.set(`${drum_code}|${vehicle_type}`, { drum_code, vehicle_type, max_drums: Math.floor(max) });
  }
  return [...out.values()];
}

const snapshot = async (db: Db, sheetKey: string, tab: string): Promise<SnapRow[]> =>
  (await db.query('SELECT row_no, data FROM sheet_snapshot WHERE sheet_key=$1 AND tab_name=$2 ORDER BY row_no', [sheetKey, tab])).rows;

// Bulk insert through jsonb (one statement per 5000 rows): the rate tabs pivot to several hundred thousand rows.
async function insertRows(db: Db, table: string, rows: object[]) {
  const cols = Object.keys(rows[0] ?? {}).join(', ');
  for (let i = 0; i < rows.length; i += 5000) {
    await db.query(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows.slice(i, i + 5000))]);
  }
}

/** Rebuild the typed tables from sheet_snapshot in one transaction. A tab with no snapshot rows (not synced / sync failed) keeps its old typed rows.
 *  Pass ONE connection (pg Client / PGlite), not a Pool: BEGIN/COMMIT on a Pool are not one transaction. */
export async function loadTypedTables(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await inTransaction(db, async () => {
    for (const [tab, dateKey] of [['DAILY RM RATES', 'DATE'], ['DAILY MKT CP', 'RM ITEM NAME']]) {
      const rows = rmRatesFromTab(await snapshot(db, 'CIRCULARS', tab), tab, dateKey);
      if (!rows.length) continue;
      await db.query('DELETE FROM rm_rate WHERE source_tab=$1', [tab]);
      await insertRows(db, 'rm_rate', rows);
      counts[`rm_rate:${tab}`] = rows.length;
    }
    const bom = nonChainBomFromTab(await snapshot(db, 'MASTER_BOM_ACTUAL', 'NON CHAIN BOM'));
    if (bom.length) {
      await db.query('DELETE FROM non_chain_bom');
      await insertRows(db, 'non_chain_bom', bom);
      counts.non_chain_bom = bom.length;
    }
    const cc = (tab: string) => snapshot(db, 'CLAUDE_COSTINGS', tab);
    const freight = freightRatesFromTab(await cc('FREIGHT RATES'));
    if (freight.length) {        // abnormal rows are replaced together with the normal ones
      const all = [...freight, ...freightAbnormalFromTab(await cc('FREIGHT ABNORMAL'))];
      await db.query('DELETE FROM freight_rate');
      await insertRows(db, 'freight_rate', all);
      counts.freight_rate = all.length;
    }
    for (const [table, rows] of [['drum_master', drumMasterFromTab(await cc('DRUM MASTER'))], ['drums_per_truck', drumsPerTruckFromTab(await cc('DRUMS PER TRUCK MASTER'))]] as const) {
      if (!rows.length) continue;
      await db.query(`DELETE FROM ${table}`);
      await insertRows(db, table, rows);
      counts[table] = rows.length;
    }
  });
  return counts;
}
