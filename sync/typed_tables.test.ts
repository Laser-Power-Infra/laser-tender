import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from './lib.ts';
import { schemaSql } from './env.ts';
import { rowsToSnapshot, replaceTab } from './gsheets_sync.ts';
import { sheetDate, sheetNumber, rmRatesFromTab, nonChainBomFromTab, loadTypedTables, freightRatesFromTab, freightAbnormalFromTab, drumMasterFromTab, drumsPerTruckFromTab } from './typed_tables.ts';
import { freightPerTrip, drumFromMaster } from '../costing/rules.ts';

// Header + data rows copied (cut down to a few columns) from the live sheets, 24 Nov 2026.
const RM_RATES = [
  ['DATE', 'ACSR CORE WIRE', 'Alumimium', 'Barium Chromate Tape', 'Copper', 'PVC COMPOUND 1.48\r', 'ANTI-TRACKING COMPOUND'],
  ['23-Feb-2021', '64', '177', '', '711', '', 'HT XLPE SIOPLASS'],          // stray text in the last column of the first rows
  ['5-Aug-2021', '68', '218', '550', '740'],
  ['24-Nov-2026', '88', '341', '320', '1338', '101', '170'],
];
const MKT_CP = [
  ['', '', '340.62', '1410', '', 'RS0100087'],                                // row 1: latest values / ERP codes, not the header
  ['RM ITEM NAME', 'FINISHED GOODS', 'Aluminium Wire Rod', 'Copper Rod', 'STEEL WIRE 2.70 MM', 'PP FILLER  - 18 MM', 'STEEL WIRE 2.70 MM'],
  ['SOURCE', '', 'THAKURJI', 'AKSHATJI', 'SOUMEN DA', 'SANJAYJI', 'SOUMEN DA'],
  ['UOM', '', 'KG', 'KG', 'KG', '', 'KG'],
  ['1-Sep-2022', '', '213', '661', '#N/A', '', '80.5'],
  ['3-Sep-2022', '', '208', '632', '0', '', '80.5'],
  ['24-Nov-2026', '', '341', '1347.43', '87', '132', '91.5'],
  ['10-Mar-2027'],                                                            // future date rows exist with no rates
];
const NON_CHAIN_BOM = [
  ['', '', '', '', '', '', '', '', '', 'Outer Sheath', '', 'Calculated BOM Name'],
  ['', '', '', '', '', '', '', 'AL/CU WT.', 'AL/CU WT.', 'Insu. - type (xlpe/pvc)', '', 'Calculated BOM Name'],
  ['FG Item', 'ITEM SCHEDULE', 'Item Name', 'BOM Code', 'IS BOM TOTAL', '% DIF FROM IS', 'TOTAL', 'Aluminium Wire Rod', 'Copper Rod', 'XLPE CCV', 'NOT FOUND IN MRP/IS', 'NOT FOUND IN MRP/IS'],
  ['FA0900026', '', '', 'U1-C0003-942', '#N/A', '#N/A', '683', '', '152', '', 'NOT FOUND IN MRP/IS', 'NOT FOUND IN MRP/IS'],
  ['FA1300213', 'HT POWER CABLE - ARD', '1 CORE X 630 SQ. MM. AL/ARM (WOS) (XLPE) - 33 KV', 'U1-C0003-2922', '4,357.00', '10.19%', '4801', '2,616.00', '', '717', 'IS TESTED BOM', 'IS TESTED BOM'],
];

test('sheetDate / sheetNumber read the formats used in the sheets', () => {
  assert.equal(sheetDate('5-Aug-2021'), '2021-08-05');
  assert.equal(sheetDate('24-Nov-2026'), '2026-11-24');
  assert.equal(sheetDate('UOM'), null);
  assert.equal(sheetNumber('2,492.00'), 2492);
  assert.equal(sheetNumber('#N/A'), null);
  assert.equal(sheetNumber(''), null);
});

test('DAILY RM RATES: wide -> long, blanks and stray text skipped, header trimmed', () => {
  const rows = rmRatesFromTab(rowsToSnapshot(RM_RATES, 1), 'DAILY RM RATES', 'DATE');
  assert.equal(rows.length, 3 + 4 + 6);
  assert.deepEqual(rows.find(r => r.rate_date === '2021-08-05' && r.rm_name === 'Copper'),
    { rate_date: '2021-08-05', rm_name: 'Copper', rate: 740, rate_unit: null, source_tab: 'DAILY RM RATES' });
  assert.ok(rows.some(r => r.rm_name === 'PVC COMPOUND 1.48' && r.rate === 101));
  assert.ok(!rows.some(r => r.rate_date === '2021-02-23' && r.rm_name === 'ANTI-TRACKING COMPOUND'));
});

test('DAILY MKT CP: header row 2, UOM row gives the unit, #N/A / 0 / repeated header skipped', () => {
  const rows = rmRatesFromTab(rowsToSnapshot(MKT_CP, 2), 'DAILY MKT CP', 'RM ITEM NAME');
  assert.deepEqual(rows.filter(r => r.rm_name === 'STEEL WIRE 2.70 MM').map(r => [r.rate_date, r.rate]), [['2026-11-24', 87]]);   // first column wins, #N/A and 0 dropped
  assert.ok(!rows.some(r => /_2$/.test(r.rm_name)));
  assert.deepEqual(rows.find(r => r.rate_date === '2026-11-24' && r.rm_name === 'Copper Rod'),
    { rate_date: '2026-11-24', rm_name: 'Copper Rod', rate: 1347.43, rate_unit: 'KG', source_tab: 'DAILY MKT CP' });
  assert.equal(rows.find(r => r.rm_name === 'PP FILLER  - 18 MM')!.rate_unit, null);
  assert.ok(!rows.some(r => r.rate_date === '2027-03-10'));
  assert.equal(rows.length, 2 + 2 + 4);
});

test('NON CHAIN BOM: header row 3, one row per BOM x RM, meta and status columns excluded', () => {
  assert.deepEqual(nonChainBomFromTab(rowsToSnapshot(NON_CHAIN_BOM, 3)), [
    { bom_id: 'U1-C0003-942', erp_code: 'FA0900026', rm_name: 'Copper Rod', consumption: 152, unit: null },
    { bom_id: 'U1-C0003-2922', erp_code: 'FA1300213', rm_name: 'Aluminium Wire Rod', consumption: 2616, unit: null },
    { bom_id: 'U1-C0003-2922', erp_code: 'FA1300213', rm_name: 'XLPE CCV', consumption: 717, unit: null },
  ]);
});

test('loadTypedTables: replaces from the snapshot, idempotent, an unsynced tab keeps its rows', async () => {
  const pglite = new PGlite();                      // the only instance in this file
  await pglite.exec(schemaSql());
  const db = pglite as unknown as Db;
  await replaceTab(db, 'CIRCULARS', 'DAILY RM RATES', rowsToSnapshot(RM_RATES, 1));
  await replaceTab(db, 'CIRCULARS', 'DAILY MKT CP', rowsToSnapshot(MKT_CP, 2));
  await replaceTab(db, 'MASTER_BOM_ACTUAL', 'NON CHAIN BOM', rowsToSnapshot(NON_CHAIN_BOM, 3));
  const expected = { 'rm_rate:DAILY RM RATES': 13, 'rm_rate:DAILY MKT CP': 8, non_chain_bom: 3 };
  assert.deepEqual(await loadTypedTables(db), expected);
  assert.deepEqual(await loadTypedTables(db), expected);
  const count = async (t: string) => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
  assert.equal(await count('rm_rate'), 21);
  const r = (await db.query(`SELECT rate, rate_unit, to_char(rate_date, 'YYYY-MM-DD') AS d FROM rm_rate WHERE rm_name = 'Copper Rod' ORDER BY rate_date DESC LIMIT 1`)).rows[0];
  assert.deepEqual([Number(r.rate), r.rate_unit, r.d], [1347.43, 'KG', '2026-11-24']);

  for (const [tab, grid] of [['FREIGHT RATES', FREIGHT], ['FREIGHT ABNORMAL', ABNORMAL], ['DRUM MASTER', DRUMS], ['DRUMS PER TRUCK MASTER', PER_TRUCK]] as const)
    await replaceTab(db, 'CLAUDE_COSTINGS', tab, rowsToSnapshot(grid as unknown as unknown[][]));
  const withCosting = { ...expected, freight_rate: 4, drum_master: 4, drums_per_truck: 3 };
  assert.deepEqual(await loadTypedTables(db), withCosting);
  assert.deepEqual(await loadTypedTables(db), withCosting);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM freight_rate WHERE abnormal')).rows[0].n), 1);

  await replaceTab(db, 'MASTER_BOM_ACTUAL', 'NON CHAIN BOM', []);            // e.g. a failed sync
  assert.equal((await loadTypedTables(db)).non_chain_bom, undefined);
  assert.equal(await count('non_chain_bom'), 3);
});

// Rows copied from the live CLAUDE COSTINGS sheet, 24 Nov 2026 (cut down to the columns used).
const FREIGHT = [
  ['FROM', 'TO_LOC', 'TO_PIN', 'VEHICLE', 'KM', 'LAST_FO_DATE', 'LAST_FO', 'LAST_RATE_PER_TRUCK', 'MEDIAN_RATE_PER_TRUCK', 'BASIS', 'RATE_FOR_COSTING_PER_TRUCK'],
  ['DHULAGARH', 'ADRA PURULIA', '723121', 'TRAILER', '179', '2025-08-06', 'FO258-00066', '40500', '40500', 'Older than 6 months - +5%', '42525'],
  ['DHULAGARH', 'ADRA PURULIA', '723121', 'TRUCK-10MT', '179', '2025-08-21', 'FO258-00127', '17000', '16850', 'Older than 6 months - +5%', '17692'],   // median x 1.05, rounded
  ['DHULAGARH', 'SOMEWHERE', '', 'TRUCK-9MT', '50', '2026-10-01', 'FO26X-1', '9000', '8800', 'Within 6 months - same rate', '9000'],
  ['DHULAGARH', 'NO DATE', '700001', 'TRUCK-9MT', '5', '', '', '100', '100', 'Within 6 months - same rate', '100'],
];
const ABNORMAL = [
  ['TYPE', 'FO', 'FO_DATE', 'DOC', 'TO_LOC', 'TO_PIN', 'VEHICLE', 'TRUCK', 'NET_WT_KG', 'FREIGHT'],
  ['Token freight (< Rs 100) entered', 'FO267-00023', '2026-07-04', 'LP26Y-01671', 'ADRA PURULIA', '723121', 'TRAILER', 'WB959335', '19980', '50'],
];
const DRUMS = [
  ['Drum Code', 'Drum Type', 'Drum Size (F x b x t x Ft)', 'Drum Cost per Drum (Rs) – derived', 'Std Lengths seen (m)', 'BOM Drum Cost (Rs) w.e.f. 04-Nov-2026', 'Making charge (Rs)'],
  ['MD0100005', 'WOOD', '36 X 14 X 23 X 2', '2585', '500', '1420', '150'],
  ['MD0100003', 'WOOD', '28 X 14 X 23 X 2', '2130', '500', '', ''],
  ['SP0400091', 'STEEL', 'CORRUGATED DISPATCH STEEL DRUM 1800 X 900 X 1000', '24225'],
  ['MD0100090', 'WOOD', '43 X 15 X 36 X 2.5', '', '', '2475', '150'],
];
const PER_TRUCK = [
  ['TRUCK_TYPE', 'DRUM_TYPE', 'DRUM_SIZE', 'MAX_DRUMS_PER_TRUCK', 'TYPICAL_DRUMS_PER_TRUCK'],
  ['TRAILER', 'STEEL', '3150 X 2000 X 1600', '4', '2.2'],
  ['TRUCK-10MT', 'STEEL', 'DRUM - 43 X 15 X 28 X 2.25', '7', '7.5'],
  ['TRUCK-10MT', 'WOODEN', 'DRUM - 43 X 15 X 28 X 2.25', '9', '9'],
  ['TRUCK-9MT', 'WOODEN', 'DRUM - 40 X 15 X 23 X 2', '', ''],
];

test('FREIGHT RATES: pre-uplift rate stored, so the engine rule reproduces the sheet costing rate; abnormal never used', () => {
  const rows = [...freightRatesFromTab(rowsToSnapshot(FREIGHT)), ...freightAbnormalFromTab(rowsToSnapshot(ABNORMAL))];
  assert.deepEqual(rows.map(r => [r.to_pin, r.vehicle_type, r.rate_per_trip, r.rate_date, r.abnormal]), [
    ['723121', 'TRAILER', 40500, '2025-08-06', false],
    ['723121', 'TRUCK-10MT', 16850, '2025-08-21', false],        // the sheet used the median here
    [null, 'TRUCK-9MT', 9000, '2026-10-01', false],
    ['723121', 'TRAILER', 50, '2026-07-04', true],
  ]);
  assert.match(rows[3].source_ref, /FREIGHT ABNORMAL FO267-00023 LP26Y-01671: Token freight/);
  assert.equal(freightPerTrip(rows as any, '723121', 'TRAILER', '2026-11-24').perTrip, 42525);       // = sheet RATE_FOR_COSTING_PER_TRUCK, not the Rs 50 trip
});

test('DRUM MASTER: col N by header prefix, col D fallback, flange only for wooden drums', () => {
  const rows = drumMasterFromTab(rowsToSnapshot(DRUMS));
  assert.deepEqual(rows.map(r => [r.drum_code, r.flange_dia_inch, r.cost_col_n, r.cost_col_d]), [
    ['MD0100005', 36, 1420, 2585], ['MD0100003', 28, null, 2130], ['SP0400091', null, null, 24225], ['MD0100090', 43, 2475, null],
  ]);
  assert.deepEqual(drumFromMaster(rows[0]), { cost: 1420, usedFallback: false });
  assert.deepEqual(drumFromMaster(rows[1]), { cost: 2130, usedFallback: true });
});

test('DRUMS PER TRUCK MASTER: keyed by type|size and vehicle, blank max skipped', () => {
  assert.deepEqual(drumsPerTruckFromTab(rowsToSnapshot(PER_TRUCK)), [
    { drum_code: 'STEEL|3150 X 2000 X 1600', vehicle_type: 'TRAILER', max_drums: 4 },
    { drum_code: 'STEEL|DRUM - 43 X 15 X 28 X 2.25', vehicle_type: 'TRUCK-10MT', max_drums: 7 },
    { drum_code: 'WOODEN|DRUM - 43 X 15 X 28 X 2.25', vehicle_type: 'TRUCK-10MT', max_drums: 9 },
  ]);
});
