import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../sync/lib.ts';
import { schemaSql } from '../sync/env.ts';
import { readEnquiryTenders, readEnquiryDetail, readNewEnquiries } from './enquiryRead.ts';

// One PGlite for the whole file, schema reset per test (several instances crash V8 here).
let pglite: PGlite | undefined;
async function freshDb() {
  pglite ??= new PGlite();
  await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' + schemaSql());
  return pglite as unknown as Db;
}

test('joined read: legacy shape, Smartsheet fields from enquiry, app-owned fields from SmartsheetTender', async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO enquiry (docket_no, enquiry_date, party_name, utility, quotation_no, quotation_date, account_holder,
                    enquiry_category, enquiry_from_email, email_subject, enquiry_contact_no) VALUES
    ('ENQ-1', '2026-11-23', 'ACME ', 'WBSEDCL', 'Q-1', '2026-11-24', 'RAHUL', 'Tender', 'sheet@x.com', 'sheet subject', '111'),
    ('ENQ-2', '2026-11-22', 'BETA', NULL, NULL, NULL, NULL, NULL, 'only@sheet.com', NULL, NULL),
    ('ENQ-3', NULL, 'GONE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);
  await db.query(`UPDATE enquiry SET deleted_at = now() WHERE docket_no = 'ENQ-3'`);
  await db.query(`INSERT INTO "SmartsheetTender" (id, "updatedAt", "docketNumber", "partyName", "enquiryDate", "allocatedTo", status,
                    "LostStillScope", "contractNo", "aluminiumPrice", "emailId", "contactNo") VALUES
    ('uuid-1', now(), 'ENQ-1', 'STALE NAME', '2020-01-01', 'PRITIKANA', 'in progress', 'Lost', 'C-9', 251.5, 'edited@x.com', ''),
    ('uuid-9', now(), 'ENQ-OLD', 'ONLY IN LEGACY', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);

  const rows = (await readEnquiryTenders(db))!;
  assert.deepEqual(rows.map(r => r.docketNumber), ['ENQ-2', 'ENQ-1']);   // no legacy row = newest; deleted and legacy-only are absent
  const r = rows[1];
  assert.equal(r.id, 'uuid-1');
  assert.equal(r.enquiryDate, '2026-11-23');
  assert.equal(r.quotationDate, '2026-11-24');
  assert.equal(r.partyName, 'ACME');
  assert.equal(r.tenderPurchase, 'Tender');
  assert.equal(r.quotationNumber, 'Q-1');
  assert.equal(r.allocatedTo, 'PRITIKANA');
  assert.equal(r.status, 'in progress');
  assert.equal(r.LostStillScope, 'Lost');
  assert.equal(r.contractNo, 'C-9');
  assert.equal(r.aluminiumPrice, 251.5);
  assert.equal(r.emailId, 'edited@x.com');            // user edit wins
  assert.equal(r.contactNo, '111');                   // blank edit falls back to the sheet
  assert.equal(r.emailSubjectLine, 'sheet subject');
  assert.equal(rows[0].id, 'ENQ-2');
  assert.equal(rows[0].emailId, 'only@sheet.com');
  assert.equal(rows[0].allocatedTo, null);
  assert.equal(rows[0].quotationDate, null);
});

test('fallback signals: empty enquiry -> no rows, missing table -> null', async () => {
  const db = await freshDb();
  assert.deepEqual(await readEnquiryTenders(db), []);
  await db.query('DROP TABLE enquiry CASCADE');
  assert.equal(await readEnquiryTenders(db), null);
  assert.deepEqual(await readEnquiryDetail(db, 'ENQ-1'), { enquiry: [], items: [] });
});

test('detail: labelled non-empty columns and the items of the docket', async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO enquiry (docket_no, enquiry_date, party_name, forwarded_to_uic) VALUES ('ENQ-1', '2026-11-23', 'ACME', false)`);
  await db.query(`INSERT INTO enquiry_item (docket_no, party_item_name, qty) VALUES ('ENQ-1', 'CABLE A', 65), ('ENQ-1', 'CABLE B', 2), ('ENQ-2', 'OTHER', 1)`);
  await db.query(`UPDATE enquiry_item SET deleted_at = now() WHERE party_item_name = 'CABLE B'`);

  const d = await readEnquiryDetail(db, 'ENQ-1');
  assert.deepEqual(d.enquiry, [
    { label: 'Docket No (Debosmita Nath)', value: 'ENQ-1' },
    { label: 'Enquiry Date(MM-DD-YY) (Debosmita Nath)', value: '2026-11-23' },
    { label: 'Party Name (Debosmita Nath)', value: 'ACME' },
  ]);
  assert.deepEqual(d.items, [[
    { label: 'DOCKET NO.', value: 'ENQ-1' },
    { label: 'PARTY ITEM NAME', value: 'CABLE A' },
    { label: 'QTY', value: '65' },
  ]]);
  assert.deepEqual(await readEnquiryDetail(db, 'NOPE'), { enquiry: [], items: [] });
});

test('readNewEnquiries: dashboard-made enquiries only, newest first, with mirror status', async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO enquiry (docket_no, party_name, master, created_at, mirrored_at, created_by) VALUES
    ('ENQ-1', 'FROM SHEET', 'smartsheet', '2026-11-20', NULL, NULL),
    ('ENQ-7', 'MIRRORED', 'dashboard', '2026-11-21', '2026-11-22 06:00+00', 'a@x.com'),
    ('PENDING-3', 'NEW', 'dashboard', '2026-11-25', NULL, 'b@x.com')`);
  const rows = await readNewEnquiries(db);
  assert.deepEqual(rows.map(r => [r[0], r[5], r[7]]), [
    ['PENDING-3', 'b@x.com', 'Not mirrored (temporary docket)'],
    ['ENQ-7', 'a@x.com', 'Mirrored 22-Nov-2026 11:30'],
  ]);
});
