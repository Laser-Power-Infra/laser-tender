import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Db, SsSheet, loadColumns, coerce, mapRow, normTitle } from './lib.ts';
import { syncSheet } from './smartsheet_sync.ts';
import { rowsToSnapshot, replaceTab } from './gsheets_sync.ts';
import { buildRowPayload } from './mirror_to_smartsheet.ts';
import { compareRecords, checkSheet } from './parity_check.ts';
import { seed, alignDocketCounter } from './seed.ts';
import { schemaSql } from './env.ts';

const cols = loadColumns();
// One PGlite for the whole file, schema reset per test: a new instance per test runs V8 out of WASM code space.
let pglite: PGlite | undefined;
async function freshDb() {
  pglite ??= new PGlite();
  await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' + schemaSql());
  return pglite as unknown as Db;
}
/** Build a Smartsheet-API-shaped sheet from {title: value} objects, using the real column titles from columns.json. */
function fakeSheet(kind: 'sales_enquiry' | 'item_list', rows: Record<string, unknown>[], startId = 1000): SsSheet {
  const cs = cols[kind];
  const columns = cs.map(c => ({ id: c.smartsheet_column_id, title: c.smartsheet_title }));
  const idOf = new Map(cs.map(c => [normTitle(c.smartsheet_title), c.smartsheet_column_id]));
  return {
    columns,
    rows: rows.map((r, i) => ({
      id: startId + i, modifiedAt: '2026-11-20T10:00:00Z',
      cells: Object.entries(r).map(([t, v]) => ({ columnId: idOf.get(normTitle(t))!, value: v })),
    })),
  };
}
const titleOf = (kind: 'sales_enquiry' | 'item_list', dbCol: string) => cols[kind].find(c => c.db_column === dbCol)!.smartsheet_title;

test('coerce: numbers, percent fractions, dates, empty strings', () => {
  assert.equal(coerce('65.0', 'numeric'), 65);
  assert.equal(coerce('0.18', 'numeric'), 0.18);
  assert.equal(coerce('1,250', 'numeric'), 1250);
  assert.equal(coerce('abc', 'numeric'), null);
  assert.equal(coerce('2026-11-23T00:00:00', 'date'), '2026-11-23');
  assert.equal(coerce('', 'date'), null);
  assert.equal(coerce(undefined, 'boolean'), false);
  assert.equal(coerce(true, 'boolean'), true);
  assert.equal(coerce('  x ', 'text'), '  x ');
});

test('column mapping matches titles regardless of whitespace/case', () => {
  assert.equal(normTitle('  Party   Name '), 'party name');
  assert.equal(cols.sales_enquiry.length, 63);
  assert.equal(cols.item_list.length, 49);
  // every db_column is unique per sheet
  for (const k of ['sales_enquiry', 'item_list'] as const) assert.equal(new Set(cols[k].map(c => c.db_column)).size, cols[k].length);
});

test('enquiry import: insert, idempotent re-run, legacy keeps original titles', async () => {
  const db = await freshDb();
  const sheet = fakeSheet('sales_enquiry', [
    { [titleOf('sales_enquiry', 'docket_no')]: 'ENQ-22199-25-26', [titleOf('sales_enquiry', 'interest_pct')]: '1.0' },
    { [titleOf('sales_enquiry', 'docket_no')]: 'ENQ-22200-25-26' },
  ]);
  const cfg = { key: 'sales_enquiry', kind: 'sales_enquiry' as const, sheetId: '5621905471000452' };
  const r1 = await syncSheet(db, cfg, sheet);
  assert.deepEqual([r1.inserted, r1.updated], [2, 0]);
  const r2 = await syncSheet(db, cfg, sheet);
  assert.deepEqual([r2.inserted, r2.updated], [0, 2]);
  const q = await db.query(`SELECT docket_no, interest_pct, legacy, row_version FROM enquiry ORDER BY docket_no`);
  assert.equal(q.rows.length, 2);
  assert.equal(Number(q.rows[0].interest_pct), 1);
  assert.equal(q.rows[0].legacy[titleOf('sales_enquiry', 'docket_no')], 'ENQ-22199-25-26');
  assert.equal(q.rows[0].row_version, 2);
});

test('item import: numeric/percent coercion and idempotent by (sheet,row id)', async () => {
  const db = await freshDb();
  const sheet = fakeSheet('item_list', [{
    [titleOf('item_list', 'docket_no')]: 'ENQ-22199-25-26',
    [titleOf('item_list', 'qty')]: '65.0',
    [titleOf('item_list', 'gst_pct')]: '0.18',
    [titleOf('item_list', 'propose_erp_item')]: 'AL CONDUCTOR 7/3.15@A123',
  }]);
  const cfg = { key: 'item_erp11', kind: 'item_list' as const, sheetId: '5887687107235716', itemList: 'ERP 11' };
  await syncSheet(db, cfg, sheet); await syncSheet(db, cfg, sheet);
  const q = await db.query(`SELECT qty, gst_pct, propose_erp_item, item_list FROM enquiry_item`);
  assert.equal(q.rows.length, 1);
  assert.equal(Number(q.rows[0].qty), 65);
  assert.equal(Number(q.rows[0].gst_pct), 0.18);
  assert.equal(q.rows[0].item_list, 'ERP 11');
});

test('parallel run: dashboard-owned rows are never overwritten by the Smartsheet import', async () => {
  const db = await freshDb();
  const dk = titleOf('sales_enquiry', 'docket_no'), pn = titleOf('sales_enquiry', 'party_name');
  const cfg = { key: 'sales_enquiry', kind: 'sales_enquiry' as const, sheetId: '5621905471000452' };
  await syncSheet(db, cfg, fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-1-25-26', [pn]: 'OLD PARTY' }]));
  await db.query(`UPDATE enquiry SET master='dashboard', party_name='NEW PARTY' WHERE docket_no='ENQ-1-25-26'`);
  const r = await syncSheet(db, cfg, fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-1-25-26', [pn]: 'OLD PARTY' }]));
  assert.equal(r.skipped, 1);
  const q = await db.query(`SELECT party_name FROM enquiry`);
  assert.equal(q.rows[0].party_name, 'NEW PARTY');
});

test('import never touches dashboard-native columns (allocated_to etc.)', async () => {
  const db = await freshDb();
  const dk = titleOf('sales_enquiry', 'docket_no');
  const cfg = { key: 'sales_enquiry', kind: 'sales_enquiry' as const, sheetId: '5621905471000452' };
  await syncSheet(db, cfg, fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-2-25-26' }]));
  await db.query(`UPDATE enquiry SET allocated_to='AKASH' WHERE docket_no='ENQ-2-25-26'`);
  await syncSheet(db, cfg, fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-2-25-26' }]));
  assert.equal((await db.query(`SELECT allocated_to FROM enquiry`)).rows[0].allocated_to, 'AKASH');
});

test('unmapped Smartsheet columns are reported, kept in legacy, and do not break the import', async () => {
  const db = await freshDb();
  const sheet = fakeSheet('sales_enquiry', [{ [titleOf('sales_enquiry', 'docket_no')]: 'ENQ-3-25-26' }]);
  sheet.columns.push({ id: 999, title: 'Brand New Column' });
  sheet.rows[0].cells.push({ columnId: 999, value: 'hello' });
  const r = await syncSheet(db, { key: 'sales_enquiry', kind: 'sales_enquiry', sheetId: '5621905471000452' }, sheet);
  assert.deepEqual(r.unmappedTitles, ['Brand New Column']);
  assert.equal((await db.query(`SELECT legacy FROM enquiry`)).rows[0].legacy['Brand New Column'], 'hello');
});

test('parity check: identical -> no diffs; changed value / missing row detected', async () => {
  const db = await freshDb();
  const dk = titleOf('sales_enquiry', 'docket_no'), pn = titleOf('sales_enquiry', 'party_name');
  const sheet = fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-10-25-26', [pn]: 'A' }, { [dk]: 'ENQ-11-25-26', [pn]: 'B' }]);
  await syncSheet(db, { key: 'sales_enquiry', kind: 'sales_enquiry', sheetId: '5621905471000452' }, sheet);
  let rep = await checkSheet(db, 'sales_enquiry', '5621905471000452', sheet);
  assert.equal(rep.diffs.length, 0); assert.equal(rep.missingInDb.length, 0);
  const changed = fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-10-25-26', [pn]: 'A2' }, { [dk]: 'ENQ-11-25-26', [pn]: 'B' }, { [dk]: 'ENQ-12-25-26', [pn]: 'C' }]);
  rep = await checkSheet(db, 'sales_enquiry', '5621905471000452', changed);
  assert.equal(rep.diffs.length, 1); assert.equal(rep.diffs[0].column, 'party_name');
  assert.deepEqual(rep.missingInDb, ['ENQ-12-25-26']);
});

test('compareRecords treats null/""/undefined as equal and numbers numerically', () => {
  const a = new Map([['k', { x: '', y: '65.0' }]]); const b = new Map([['k', { x: null, y: 65 }]]);
  assert.equal(compareRecords(a, b, ['x', 'y']).diffs.length, 0);
});

test('mirror payload: skips system columns and empties, converts types', () => {
  const rec: Record<string, unknown> = {};
  for (const c of cols.item_list) rec[c.db_column] = null;
  rec.qty = 65; rec.gst_pct = 0.18; rec.docket_no = 'ENQ-1-25-26'; rec.base_date = '2026-11-23';
  const p = buildRowPayload('item_list', rec, '12345');
  assert.equal(p.id, 12345);
  const qtyId = Number(cols.item_list.find(c => c.db_column === 'qty')!.smartsheet_column_id);
  assert.equal(p.cells.find(c => c.columnId === qtyId)!.value, 65);
  assert.ok(p.cells.length >= 3 && p.cells.length <= 6);
  assert.equal(buildRowPayload('item_list', rec).toBottom, true);
});

test('google sheet rows -> snapshot: header, duplicate headers, blank rows skipped, row numbers', async () => {
  const grid = [['Date', 'Rate', 'Rate', ''], ['2026-11-20', '100', '101', 'x'], ['', '', '', ''], ['2026-11-21', '102']];
  const rows = rowsToSnapshot(grid);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { row_no: 2, data: { Date: '2026-11-20', Rate: '100', Rate_2: '101', col_4: 'x' } });
  assert.equal(rows[1].row_no, 4);
  const db = await freshDb();
  await replaceTab(db, 'T', 'tab', rows); await replaceTab(db, 'T', 'tab', rows.slice(0, 1));
  assert.equal((await db.query(`SELECT count(*)::int n FROM sheet_snapshot`)).rows[0].n, 1);
});

test('seed + docket counter alignment', async () => {
  const db = await freshDb();
  await seed(db);
  assert.ok((await db.query('SELECT count(*)::int n FROM ref_party')).rows[0].n > 2000);
  assert.ok((await db.query('SELECT count(*)::int n FROM ref_erp_item')).rows[0].n > 3000);
  const dk = titleOf('sales_enquiry', 'docket_no');
  await syncSheet(db, { key: 'sales_enquiry', kind: 'sales_enquiry', sheetId: '5621905471000452' }, fakeSheet('sales_enquiry', [{ [dk]: 'ENQ-22199-25-26' }, { [dk]: 'ENQ-4306-20-21' }]));
  assert.equal(await alignDocketCounter(db), 22199);
  assert.equal((await db.query('SELECT next_docket_no() AS d')).rows[0].d, 'ENQ-22200-25-26');
});

import { extractDocket, rekeyDocket, DOCKET_COL_ID } from './mirror_to_smartsheet.ts';
test('parallel run: PENDING docket is replaced by the Smartsheet-issued docket everywhere', async () => {
  assert.equal(extractDocket({ cells: [{ columnId: DOCKET_COL_ID, displayValue: 'ENQ-22201-25-26' }] }), 'ENQ-22201-25-26');
  assert.equal(extractDocket({ cells: [] }), null);
  const db = await freshDb();
  const p = (await db.query('SELECT next_pending_docket_no() AS d')).rows[0].d;
  assert.equal(p, 'PENDING-1');
  await db.query(`INSERT INTO enquiry(docket_no, master) VALUES ($1,'dashboard')`, [p]);
  await db.query(`INSERT INTO enquiry_item(docket_no, master) VALUES ($1,'dashboard')`, [p]);
  await rekeyDocket(db, p, 'ENQ-22201-25-26');
  assert.equal((await db.query('SELECT docket_no FROM enquiry')).rows[0].docket_no, 'ENQ-22201-25-26');
  assert.equal((await db.query('SELECT docket_no FROM enquiry_item')).rows[0].docket_no, 'ENQ-22201-25-26');
});

test('mirror payload never carries Smartsheet formula columns', () => {
  const id = (k: 'sales_enquiry' | 'item_list', col: string) => Number(cols[k].find(c => c.db_column === col)!.smartsheet_column_id);
  const p = buildRowPayload('sales_enquiry', { party_name: 'ACME', account_holder: 'PUJA AGARWAL', difference_in_days: 3 });
  assert.deepEqual(p.cells.map(c => c.columnId), [id('sales_enquiry', 'party_name')]);
  const q = buildRowPayload('item_list', { docket_no: 'ENQ-1', std_length: '500', quotation_no: 'LQ1' });
  assert.deepEqual(q.cells.map(c => c.columnId), [id('item_list', 'docket_no')]);
});
