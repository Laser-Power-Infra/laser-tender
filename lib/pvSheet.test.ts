import test from "node:test";
import assert from "node:assert/strict";
import { mapPvRows, summarizePvRows, indexSeriesFromRows, type SheetRow } from "./pvSheet.ts";

// Rows copied from the live Circulars sheet on 24-Nov-2026, in sheet_snapshot form ({header: displayed text}, blanks dropped).
const PMA = "PMA-IE@PREVIOUS MONTH AVG - IEEMA";
const contracts: SheetRow[] = [
  { "Contract Number": "RC25Y-00088", "ITEM NAME": "1 CORE X 150 SQ. MM. AL/UNARD. (XLPE)", "ITEM CODE": "FA0600019", QTY: "0.5", "LOT REVIEWED": "1st lot", "IEEMA/ CACMAI": "IEEMA", "PV BASE DATE": "01-Dec-24", "PV OFFER DATE": "04-Dec-25", "APPLICABLE DATE": "01-Oct-25", "PV VALUE": "11,015", "SPECIAL JOIN (Contract@Item@Lot)": "RC25Y-00088@FA0600019@1st lot", "PV TERMS": "PHYSICAL DELIVERY AT STORE(-)", "PV DAYS (code)": PMA, "SCH END": "19-Nov-2025", "OFFER RECOMMENDATION": "ALREADY OFFERED 04-Dec-25 (PV/km 11,015)" },
  { "Contract Number": "RC26Y-00068", "ITEM NAME": "3 CORE X 400 SQ. MM AL/ARM - WIRE (XLPE) - 33 KV", "ITEM CODE": "FA1300080", QTY: "11.5", "LOT REVIEWED": "1st lot", "IEEMA/ CACMAI": "IEEMA", "PV BASE DATE": "01-Dec-25", "PV OFFER DATE": "05-Nov-26", "APPLICABLE DATE": "01-Sep-26", "PV VALUE": "751,047", "SPECIAL JOIN (Contract@Item@Lot)": "RC26Y-00068@FA1300080@1st lot", "SCH END": "07-Oct-2026" },
  { "Contract Number": "S325Y-00027", "ITEM NAME": "3 CORE X 70 SQ MM + 1 CORE X 16 SQ MM + 1 CORE X 50 SQ MM (AB CABLES) (INSULATED)", "ITEM CODE": "FA0100030", QTY: "223.697", "LOT REVIEWED": "11th lot", "IEEMA/ CACMAI": "IEEMA", "PV BASE DATE": "01-Apr-25", "PV OFFER DATE": "NOT OFFERED", "APPLICABLE DATE": "01-Oct-26", "PV VALUE": "87,096", "SPECIAL JOIN (Contract@Item@Lot)": "S325Y-00027@FA0100030@11th lot", "PV TERMS": "BackfromInspOffer date(-)", "PV DAYS (code)": PMA, "SCH END": "04-Dec-2026", "OFFER RECOMMENDATION": "HOLD - offer on/after 01-Dec-26 (gain 3,039,819)" },
  { "Contract Number": "RC26Y-00088", "ITEM NAME": "3 CORE X 300 SQ. MM. AL/ARM - WIRE (XLPE) - HDPE - 11 KV", "ITEM CODE": "FA1300329", QTY: "10", "LOT REVIEWED": "1st lot", "IEEMA/ CACMAI": "IEEMA", "PV BASE DATE": "BASE DATE MISSING", "PV OFFER DATE": "NOT OFFERED", "APPLICABLE DATE": "01-Sep-26", "PV VALUE": "BASE DATE MISSING", "SPECIAL JOIN (Contract@Item@Lot)": "RC26Y-00088@FA1300329@1st lot", "SCH END": "29-Oct-2026" },
  { "Contract Number": "RC25Y-00138", "ITEM NAME": "COVERED CONDUCTOR - 1 CORE X 232 SQ. MM. (AAAC) - AL-59 - 33 KV", "ITEM CODE": "FA2900061", QTY: "1", "LOT REVIEWED": "1st lot", "IEEMA/ CACMAI": "IEEMA", "PV BASE DATE": "01-Jan-25", "PV OFFER DATE": "NOT OFFERED", "APPLICABLE DATE": "01-Apr-26", "PV VALUE": "MVCC - index pending", "SPECIAL JOIN (Contract@Item@Lot)": "RC25Y-00138@FA2900061@1st lot", "SCH END": "20-May-2026" },
];
const factors: SheetRow[] = [
  { "ITEM CODE": "FA0600019", "PV FAMILY": "LV", "ARMOUR KEY": "UNARD", AlF: "0.425", CuF: "0", XLF: "0.078", "SMIF (Cu tape)": "0", "FeF / FeW": "0", "CCF (PVC/PE)": "0.388", STATUS: "OK" },
  { "ITEM CODE": "FA1300080", "PV FAMILY": "HT", "ARMOUR KEY": "WIRE", AlF: "3.374", CuF: "0", XLF: "3.229", "SMIF (Cu tape)": "0.164", "FeF / FeW": "8.76", "CCF (PVC/PE)": "5.736", STATUS: "OK" },
  { "ITEM CODE": "FA0100030", "PV FAMILY": "AB", "ARMOUR KEY": "UNARD", AlF: "0.774", CuF: "0", XLF: "0.226", "SMIF (Cu tape)": "0", "FeF / FeW": "0", "CCF (PVC/PE)": "0", STATUS: "OK" },
  { "ITEM CODE": "FA1300329", "PV FAMILY": "HT", "ARMOUR KEY": "WIRE", AlF: "2.635", CuF: "0", XLF: "1.167", "SMIF (Cu tape)": "0.11", "FeF / FeW": "5.182", "CCF (PVC/PE)": "3.161", STATUS: "OK" },
  { "ITEM CODE": "FA2900061", "PV FAMILY": "MVCC", "ARMOUR KEY": "UNARD", "WA (Al)": "0.648", "WF (Steel)": "0", WSc: "0.1265", WI: "0.1894", WO: "0.1202", "WAL (AL-59)": "0", STATUS: "OK" },
];
const D = "IEEMA CABLE INDEX DATE (1st of month)", T = "TYPE (CIRCULAR / PROVISIONAL)";
const ix = (date: string, al: string, cu: string, flat: string, wire: string, pvc: string, xl: string, pe: string, type = "CIRCULAR"): SheetRow =>
  ({ [D]: date, "AL (LME Al ingot)": al, "CU (wire rod)": cu, "STEEL FLAT 4x0.8": flat, "STEEL WIRE 1.6": wire, "PVC CW-22": pvc, "XLPE LV": xl, "PE ST7": pe, [T]: type });
const index: SheetRow[] = [
  ix("1-Dec-2024", "252941.00", "820039.00", "78250.00", "76750.00", "159825.00", "147843.00", "142750.00"),
  ix("1-Apr-2025", "242517.00", "853722.00", "76250.00", "74750.00", "156325.00", "155947.00", "148000.00"),
  ix("1-Oct-2025", "279579.00", "1027752.00", "81250", "79750.00", "156825.00", "158844.00", "145750.00"),
  ix("1-Dec-2025", "298490.00", "1144212.00", "78250", "76750.00", "151825.00", "156296.00", "147000.00"),
  ix("1-Sep-2026", "376221.00", "1469513.00", "92250", "90750.00", "189375.00", "186462.00", "204500.00"),
  ix("1-Oct-2026", "344733.00", "1472961.00", "92250", "90750.00", "196375.00", "191261.00", "207750.00"),
  ix("11/1/2026", "362289.9972", "1353607.337", "92250", "90750.00", "196375.00", "191261.00", "207750.00", "PROVISIONAL (main metal only)"),
];
const TODAY = "2026-11-24";
const rows = mapPvRows(contracts, factors, index, TODAY);
const by = (key: string) => rows.find(r => r.key.startsWith(key))!;

test("index tab: the M/D/YYYY provisional row is read as 1-Nov-2026 and marked provisional", () => {
  const al = indexSeriesFromRows(index).AL!;
  assert.deepEqual(al[al.length - 1], { date: "2026-11-01", value: 362289.9972, provisional: true });
});
test("RC25Y-00088: our PV equals the sheet's PV VALUE (11,015/km)", () => {
  const r = by("RC25Y-00088");
  assert.equal(r.pv, 11015); assert.equal(r.sheetPv, 11015); assert.equal(r.diff, 0); assert.equal(r.status, "MATCH");
  assert.equal(r.pctPv, null); assert.ok(r.warnings.some(w => /base price missing/.test(w)));        // sheet: "BASE PRICE PENDING"
  assert.match(r.advice!, /^ALREADY OFFERED 04-Dec-25/);
});
test("HT wire-armoured row matches the sheet too (SMIF on Cu, FeW on steel wire), with the XLPE LV/HV caveat", () => {
  const r = by("RC26Y-00068");
  assert.equal(r.pv, 751047); assert.equal(r.status, "MATCH");
  assert.ok(r.warnings.some(w => /LV\/HV selection not verified/.test(w)));
  assert.ok(r.warnings.some(w => /days code missing/.test(w)) && r.warnings.some(w => /terms missing/.test(w)));
});
test("not offered + days code: offer-now-or-wait advice with the provisional month, lot gain as in the sheet", () => {
  const r = by("S325Y-00027");
  assert.equal(r.pv, 87096); assert.equal(r.status, "MATCH");
  assert.equal(r.advice, "WAIT: +13589/unit next month (provisional) = +3039819 for the lot");      // sheet: gain 3,039,819
});
test("missing base date is flagged, never assumed", () => {
  const r = by("RC26Y-00088");
  assert.equal(r.status, "NOT COMPUTED"); assert.equal(r.pv, null); assert.equal(r.note, "base date missing");
  assert.ok(r.warnings.some(w => /base date missing/.test(w)));
});
test("MVCC / conductor / CACMAI rows are not computed", () => {
  assert.match(by("RC25Y-00138").note, /^not verified: MVCC/); assert.equal(by("RC25Y-00138").pv, null);
  const [cacmai] = mapPvRows([{ ...contracts[0], "IEEMA/ CACMAI": "CACMAI" }], factors, index, TODAY);
  assert.equal(cacmai.status, "NOT COMPUTED"); assert.equal(cacmai.pv, null); assert.equal(cacmai.note, "not verified: CACMAI formula");
  assert.equal(cacmai.sheetPv, 11015);                                                               // the sheet's value is still shown
  const [cond] = mapPvRows([contracts[0]], [{ ...factors[0], "PV FAMILY": "CONDUCTOR" }], index, TODAY);
  assert.match(cond.note, /^not verified: conductor/);
});
test("a different sheet value is reported as DIFFER; ceiling; summary line", () => {
  const [d] = mapPvRows([{ ...contracts[0], "PV VALUE": "11,500" }], factors, index, TODAY);
  assert.equal(d.status, "DIFFER"); assert.equal(d.diff, -485);
  const [c] = mapPvRows([{ ...contracts[0], "BASE PRICE/ PO PRICE WITHOUT FREIGHT/ GST": "40,000" }], factors, index, TODAY);
  assert.equal(c.pvCapped, 8000); assert.equal(c.ceilingApplied, true); assert.equal(c.status, "MATCH"); assert.equal(c.pctPv, 0.2);
  assert.equal(summarizePvRows(rows), "5 rows, 3 match the sheet, 0 differ, 2 not computed");
});
