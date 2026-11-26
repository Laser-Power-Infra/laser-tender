import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import picklists from '../seed/picklists.json';
import { Db, loadColumns } from '../sync/lib.ts';
import { schemaSql } from '../sync/env.ts';
import { seed } from '../sync/seed.ts';
import { REPORTS, reportRows } from './reports.ts';
import { addItem,createEnquiry, formFields, getForEdit, listItems, picklistOptions, updateEnquiry, updateItem } from './enquiryWrite.ts';

// One PGlite for the whole file, schema reset per test (see sync/sync.test.ts).
let pglite: PGlite | undefined;
async function freshDb() {
  pglite ??= new PGlite();
  await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' + schemaSql());
  return pglite as unknown as Db;
}
const ME = 'user@example.com';
const audits = async (db: Db) => (await db.query('SELECT actor, action, table_name, pk, changes FROM audit_log ORDER BY id')).rows;

test('formFields: no system columns, no docket number, every picklist key has a source', () => {
  const small = (picklists as any).small_picklists;
  for (const kind of ['sales_enquiry', 'item_list'] as const) {
    const names = new Set(formFields(kind).map(f => f.name));
    for (const c of loadColumns()[kind]) if (c.system_column || c.formula || c.db_column === 'docket_no') assert.ok(!names.has(c.db_column), c.db_column);
    for (const f of formFields(kind)) if (f.picklist && !['parties', 'utilities', 'erp_items', 'countries'].includes(f.picklist)) assert.ok(small[f.picklist], f.picklist);
  }
  const f = Object.fromEntries(formFields('sales_enquiry').map(x => [x.name, x]));
  assert.deepEqual([f.party_name.picklist, f.enquiry_date.type, f.interest_pct.type, f.forwarded_to_uic.type, f.reference_no.type], ['parties', 'date', 'number', 'checkbox', 'text']);
  assert.equal(f.due_date.group, 'Marketing team');
});

test('createEnquiry: PENDING docket, dashboard-owned, audit row', async () => {
  const db = await freshDb();
  const { docketNo } = await createEnquiry(db, { party_name: 'ACME LTD', enquiry_date: '2026-11-24', interest_pct: '1.5', email_subject: '' }, ME);
  assert.equal(docketNo, 'PENDING-1');
  const row = (await db.query('SELECT master, updated_by, created_by, entry_datetime, reference_no, interest_pct, row_version FROM enquiry WHERE docket_no = $1', [docketNo])).rows[0];
  assert.deepEqual([row.master, row.updated_by, row.created_by, row.reference_no, Number(row.interest_pct), row.row_version], ['dashboard', ME, ME, null, 1.5, 1]);
  assert.ok(row.entry_datetime);
  assert.deepEqual(await audits(db), [{ actor: ME, action: 'INSERT', table_name: 'enquiry', pk: 'PENDING-1',
    changes: { party_name: { old: null, new: 'ACME LTD' }, enquiry_date: { old: null, new: '2026-11-24' }, interest_pct: { old: null, new: 1.5 } } }]);
  assert.equal((await createEnquiry(db, { party_name: 'B' }, ME)).docketNo, 'PENDING-2');
  await assert.rejects(createEnquiry(db, { party_name: ' ' }, ME), /Nothing to save/);
});

test('updateEnquiry: audit holds only changed columns, row_version bumps, no-op writes nothing', async () => {
  const db = await freshDb();
  const { docketNo } = await createEnquiry(db, { party_name: 'ACME LTD', enquiry_date: '2026-11-24', interest_pct: '1.5' }, ME);
  const r = await updateEnquiry(db, docketNo, { party_name: 'ACME LTD', enquiry_date: '2026-11-24', interest_pct: '1.50', utility: 'WBSEDCL', forwarded_to_uic: true }, 'other@example.com');
  assert.deepEqual(r.changed, ['utility', 'forwarded_to_uic']);
  const row = (await getForEdit(db, 'sales_enquiry', docketNo))!;
  assert.deepEqual([row.row_version, row.utility, row.forwarded_to_uic, row.enquiry_date], ['2', 'WBSEDCL', 'true', '2026-11-24']);
  const a = await audits(db);
  assert.equal(a.length, 2);
  assert.deepEqual(a[1], { actor: 'other@example.com', action: 'UPDATE', table_name: 'enquiry', pk: docketNo,
    changes: { utility: { old: null, new: 'WBSEDCL' }, forwarded_to_uic: { old: false, new: true } } });
  const stamp = (await db.query('SELECT updated_by, modified_by FROM enquiry WHERE docket_no = $1', [docketNo])).rows[0];
  assert.deepEqual([stamp.updated_by, stamp.modified_by], ['other@example.com', 'other@example.com']);
  assert.deepEqual((await updateEnquiry(db, docketNo, { utility: 'WBSEDCL' }, ME)).changed, []);
  assert.equal((await getForEdit(db, 'sales_enquiry', docketNo))!.row_version, '2');
  assert.equal((await audits(db)).length, 2);
  // clearing a value
  assert.deepEqual((await updateEnquiry(db, docketNo, { utility: '' }, ME)).changed, ['utility']);
  assert.equal((await getForEdit(db, 'sales_enquiry', docketNo))!.utility, null);
});

test('Smartsheet-owned rows are read-only', async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO enquiry (docket_no, party_name) VALUES ('ENQ-1-25-26', 'OLD')`);
  await db.query(`INSERT INTO enquiry_item (docket_no, party_item_name) VALUES ('ENQ-1-25-26', 'CABLE')`);
  await assert.rejects(updateEnquiry(db, 'ENQ-1-25-26', { party_name: 'NEW' }, ME), /owned by Smartsheet/);
  await assert.rejects(updateItem(db, 1, { qty: '5' }, ME), /owned by Smartsheet/);
  await assert.rejects(updateEnquiry(db, 'ENQ-404', { party_name: 'NEW' }, ME), /not found/);
  assert.equal((await db.query('SELECT party_name FROM enquiry')).rows[0].party_name, 'OLD');
  assert.equal((await audits(db)).length, 0);
});

test('only editable columns.json columns can be written; bad values are refused', async () => {
  const db = await freshDb();
  const { docketNo } = await createEnquiry(db, { party_name: 'ACME LTD' }, ME);
  for (const bad of ['master', 'allocated_to', 'docket_no', 'created_by', 'modified_at', 'entry_datetime', 'party_name = party_name, master', '__proto__x']) {
    await assert.rejects(updateEnquiry(db, docketNo, { [bad]: 'x' }, ME), /cannot be edited/, bad);
    await assert.rejects(createEnquiry(db, { party_name: 'P', [bad]: 'x' }, ME), /cannot be edited/, bad);
  }
  await assert.rejects(addItem(db, docketNo, { party_item_name: 'X', created_at_src: '2026-01-01' }, ME), /cannot be edited/);
  await assert.rejects(updateEnquiry(db, docketNo, { interest_pct: 'abc' }, ME), /not a valid number/);
  await assert.rejects(updateEnquiry(db, docketNo, { due_date: '24/11/2026' }, ME), /not a valid date/);
  await assert.rejects(updateEnquiry(db, docketNo, [] as any, ME), /Invalid form data/);
  assert.equal((await audits(db)).length, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM enquiry')).rows[0].n, 1); // rejected creates left nothing behind
});

test('item lines: dashboard-owned "new" lines, duplicate rule names the existing line', async () => {
  const db = await freshDb();
  const { docketNo } = await createEnquiry(db, { party_name: 'ACME LTD' }, ME);
  const erp = 'AL CONDUCTOR 7/3.15@A123';
  const { id } = await addItem(db, docketNo, { party_item_name: '3.5C x 300 sqmm  XLPE', propose_erp_item: erp, qty: '65.0', unit: 'KMS', gst_pct: '0.18' }, ME);
  const row = (await db.query('SELECT docket_no, master, item_list, updated_by, created_by, qty FROM enquiry_item WHERE id = $1', [id])).rows[0];
  assert.deepEqual([row.docket_no, row.master, row.item_list, row.updated_by, row.created_by, Number(row.qty)], [docketNo, 'dashboard', 'new', ME, ME, 65]);
  assert.deepEqual((await audits(db))[1].changes.qty, { old: null, new: 65 });

  await assert.rejects(addItem(db, docketNo, { party_item_name: ' 3.5c X 300 SQMM xlpe ', propose_erp_item: erp, qty: '10' }, ME), new RegExp(`Duplicate item line: line #${id} `));
  const other = await addItem(db, docketNo, { party_item_name: '3.5C x 300 sqmm XLPE' }, ME);   // same name, no ERP item yet: a different line
  await assert.rejects(updateItem(db, other.id, { propose_erp_item: erp }, ME), new RegExp(`line #${id} `));
  assert.deepEqual((await updateItem(db, other.id, { qty: '10' }, ME)).changed, ['qty']);
  assert.deepEqual((await updateItem(db, id, { qty: '75', party_item_name: '3.5C x 300 sqmm  XLPE' }, ME)).changed, ['qty']);

  // a soft-deleted line does not block; another docket does not block; unknown docket is refused
  await db.query('UPDATE enquiry_item SET deleted_at = now() WHERE id = $1', [id]);
  await addItem(db, docketNo, { party_item_name: '3.5C x 300 sqmm XLPE', propose_erp_item: erp }, ME);
  const d2 = await createEnquiry(db, { party_name: 'B' }, ME);
  await addItem(db, d2.docketNo, { party_item_name: '3.5C x 300 sqmm XLPE', propose_erp_item: erp }, ME);
  await assert.rejects(addItem(db, 'ENQ-404', { party_item_name: 'X' }, ME), /not found/);
  assert.deepEqual((await listItems(db, docketNo)).map(i => i.id), [other.id, '3']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM v_duplicate_item_candidates')).rows[0].n, 0);
});

// lib/reports.ts is tested here to share the one PGlite instance (a second instance in the same process crashes V8 on this machine).
test('reports: the four queries run, search and paging work, deleted rows are hidden', async () => {
  const db = await freshDb();
  for (const key of Object.keys(REPORTS)) assert.deepEqual(await reportRows(db, key), [], key);
  await db.query(`INSERT INTO enquiry (docket_no, party_name, utility, account_holder, quotation_no, quotation_date) VALUES
    ('ENQ-1-25-26', 'ACME LTD', 'WBSEDCL', 'AKASH', 'LP/Q/1', '2026-11-01'), ('ENQ-2-25-26', 'BETA', 'CESC', 'ANISH', 'LP/Q/2', '2026-11-20'), ('ENQ-3-25-26', 'GAMMA', NULL, NULL, ' ', NULL)`);
  await db.query(`INSERT INTO enquiry_item (docket_no, party_item_name, propose_erp_item, remarks_of_proposer, qty, unit, deleted_at) VALUES
    ('ENQ-1-25-26', 'CABLE A', 'AL CONDUCTOR@A123', NULL, 65, 'KMS', NULL), ('ENQ-1-25-26', 'CABLE B', NULL, 'NO ERP CODE', 2, 'KMS', NULL),
    ('ENQ-2-25-26', 'CABLE C', 'NO ERP CODE', NULL, 1, 'MT', NULL), ('ENQ-2-25-26', 'GONE', NULL, NULL, 1, 'MT', now())`);
  await db.query(`INSERT INTO rm_rate (rate_date, rm_name, rate, rate_unit, source_tab) VALUES
    ('2026-11-23', 'ALUMINIUM', 250, 'kg', 'DAILY RM RATES'), ('2026-11-24', 'ALUMINIUM', 255.5, 'kg', 'DAILY RM RATES'), ('2026-11-24', 'COPPER', 900, 'kg', 'DAILY RM RATES')`);

  const items = { rows: await reportRows(db, 'items') };
  assert.deepEqual(items.rows.map(r => r['Party item name']), ['CABLE C', 'CABLE B', 'CABLE A']);
  assert.deepEqual([items.rows[2].Party, items.rows[2].Utility, items.rows[2]['Quotation no.'], Number(items.rows[2].Qty)], ['ACME LTD', 'WBSEDCL', 'LP/Q/1', 65]);
  assert.deepEqual((await reportRows(db, 'no-erp-code')).map(r => r['Party item name']), ['CABLE C', 'CABLE B']);
  assert.deepEqual((await reportRows(db, 'quotations')).map(r => [r['Quotation no.'], r['Quotation date']]), [['LP/Q/2', '20-Nov-2026'], ['LP/Q/1', '01-Nov-2026']]);
  assert.deepEqual((await reportRows(db, 'rates')).map(r => [r['Raw material'], Number(r.Rate), r['Rate date']]), [['ALUMINIUM', 255.5, '24-Nov-2026'], ['COPPER', 900, '24-Nov-2026']]);

  // ERP dump tabs: newest first, a date that is not DD-mon-YYYY sorts last instead of failing
  await db.query(`INSERT INTO sheet_snapshot (sheet_key, tab_name, row_no, data) VALUES
    ('TENDER_DUMP', 'CONT DUMP', 2, '{"CONTRACT_NO":"OLD","CONTRACT_DATE":"24-may-2018"}'), ('TENDER_DUMP', 'CONT DUMP', 3, '{"CONTRACT_NO":"BAD","CONTRACT_DATE":"n/a"}'),
    ('TENDER_DUMP', 'CONT DUMP', 4, '{"CONTRACT_NO":"NEW","CONTRACT_DATE":"02-May-2025"}'), ('OTHER', 'CONT DUMP', 2, '{"CONTRACT_NO":"X"}')`);
  assert.deepEqual((await reportRows(db, 'erp-contracts')).map(r => r.CONTRACT_NO), ['NEW', 'OLD', 'BAD']);

  await db.query('DROP TABLE rm_rate');
  await assert.rejects(reportRows(db, 'rates'), (e: any) => e.code === '42P01');
});

test('picklistOptions: big lists, countries and small lists by key', async () => {
  const db = await freshDb();
  await seed(db);
  const key = 'item_list.Unit';
  const o = await picklistOptions(db, ['parties', 'erp_items', 'countries', key, 'no.such list']);
  assert.equal(o.parties.length, 2512);
  assert.ok(o.erp_items[0].includes('@'));
  assert.ok(o.countries.includes('India'));
  assert.deepEqual(o[key], ['KMS', 'MT']);
  assert.equal(o.utilities, undefined);
  assert.equal(o['no.such list'], undefined);
});
