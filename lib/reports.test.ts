import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../sync/lib.ts';
import { schemaSql } from '../sync/env.ts';
import { REPORTS, reportRows, lastSync } from './reports.ts';
import { DEFAULT_SUMMARIES, GROUPS, MAX_SUMMARY_WORDS, PAGES, groupKey, reportKey } from './pages.ts';
import { readPageSummaries, savePageSummary } from './pageSummary.ts';

test('every report runs against the schema, returns its columns, and has a page in the navigation', async () => {
  const pglite = new PGlite();
  await pglite.exec(schemaSql());
  const db = pglite as unknown as Db;
  await db.query(`INSERT INTO sheet_snapshot (sheet_key, tab_name, row_no, data) VALUES
    ('TYPE_TEST_LEDGER', 'TTR JIST', 2, '{"Sr No":"1","Laboratory":"CPRI","Certificate file":"Updated TTR/a.pdf"}'),
    ('TYPE_TEST_LEDGER', 'TTR JIST', 3, '{"Sr No":"2"}'),
    ('CLAUDE_COSTINGS', 'CLAUDE COSTING SHEETS', 1, '{"ENQ Docket No":"ENQ-1","Drive file id":"abc"}'),
    ('CLAUDE_COSTINGS', 'CLAUDE COSTING SHEETS', 2, '{"ENQ Docket No":""}'),
    ('CLAUDE_COSTINGS', 'CLAUDE COSTING SHEETS', 3, '{"ENQ Docket No":"ENQ-2","Touhid costing sheet (link)":"NOT DONE BY TOUHID"}'),
    ('CLAUDE_COSTINGS', 'ITEM COSTING', 2, '{"Item ID":"IT001","RM cost/km (Touhid)":"4,867","Diff EXW/km (Claude - Touhid)":"10"}'),
    ('COST_UPLOAD', 'Cost', 2, '{"ENQ Docket No":"ENQ-1","Upload Costing Sheet":"https://drive.google.com/open?id=old"}'),
    ('COST_UPLOAD', 'Cost', 3, '{"ENQ Docket No":" enq-1 ","Upload Costing Sheet":"https://drive.google.com/open?id=new"}')`);
  await db.query(`INSERT INTO "SupplyHistory" (id, "updatedAt", fy, "saleBillNumber", "saleBillDate", rate, "invoiceAmt") VALUES
    ('a', now(), '26-27', 'OLD', '27-May-26', 10, 100), ('b', now(), '26-27', 'NEW', '2026-05-27T18:30:00.000Z', 10, 100), ('c', now(), 'bad', 'X', '28-May-26', 1, 1)`);
  await db.query(`INSERT INTO sync_log (job, started_at, finished_at, ok) VALUES ('xlsx:TYPE_TEST_LEDGER:TTR JIST', now(), now(), true)`);

  const inNav = new Set(PAGES.map(reportKey));
  for (const [key, r] of Object.entries(REPORTS)) {
    assert.ok(inNav.has(key), `${key} is missing from lib/pages.ts`);
    const rows = await reportRows(db, key);              // throws on broken SQL
    await lastSync(db, key);
    if (r.sourceNeeded !== undefined) assert.match(r.sourceNeeded, /^Source needed: .+ — .+ — .+$/);
    else for (const row of rows) for (const c of r.cols) assert.ok(c in row, `${key}: column ${c}`);
  }
  for (const k of inNav) if (k && k !== 'status') assert.ok(REPORTS[k], `page ${k} has no report`);

  assert.equal(new Set(PAGES.flatMap(p => p.no ?? [])).size, 19);   // the 22 pages of ENQUIRY TO QUOTATION (N), each once, less the removed 5 (GTP master), 17 and 21
  assert.deepEqual(PAGES.flatMap(p => p.ce ?? []), [2, 3, 4, 5]);  // and the pages of CONT EX 2, less its home page (1)
  for (const p of PAGES.filter(p => p.ce)) assert.ok(REPORTS[reportKey(p)!].sourceNeeded);
  assert.equal((await reportRows(db, 'type-test'))[0].Laboratory, 'CPRI');
  assert.deepEqual((await reportRows(db, 'type-test')).map(r => r.certificate_href), ['/api/type-test/file?row=2', null]);   // only rows with a linked file
  // Supply history: newest bill first whichever way the date is written, rows without a proper FY left out, no rate or amount
  const supply = await reportRows(db, 'supply-history');
  assert.deepEqual(supply.map(r => [r['Sale bill no.'], r['Sale bill date']]), [['NEW', '28-May-2026'], ['OLD', '27-May-2026']]);
  assert.ok(!Object.keys(supply[0]).some(k => /rate|amt|amount/i.test(k)));
  // Performance history: one row per certificate in serial order; the name opens the file; dates in Indian time; duplicates name their original
  await db.query(`INSERT INTO performance_certificates (id, "updatedAt", serial, "certificateName", "certificateUrl", "issueDate", "duplicateOfId") VALUES
    ('orig', now(), 1, 'Cert.pdf', 'http://192.168.1.190:8500/performance-certificate/x.pdf', '2021-10-20 18:30:00', NULL), ('dup', now(), 2, 'Copy.pdf', NULL, NULL, 'orig')`);
  await db.query(`INSERT INTO "_CertSupplyHistory" ("A", "B") VALUES ('orig', 'a'), ('orig', 'b')`);
  assert.deepEqual((await reportRows(db, 'performance')).map(r => [r.Serial, r.Certificate, r['Issue date'], r['Duplicate of'], r['Sale bills'], r.certificate_href]),
    [['1', 'Cert.pdf', '21-Oct-2021', null, '2', 'http://192.168.1.190:8500/performance-certificate/x.pdf'], ['2', 'Copy.pdf', null, '1', null, null]]);
  // Auto quotation: the sheet's Touhid columns are shown as "As per spec master", nowhere as Touhid
  const [autoQ] = await reportRows(db, 'auto-quotation');
  assert.deepEqual([autoQ['Item ID'], autoQ['RM cost/km (As per spec master)'], autoQ['Diff EXW/km (Claude - As per spec master)']], ['IT001', '4,867', '10']);
  assert.ok(Object.keys(autoQ).length > 40 && !Object.keys(autoQ).some(c => /touhid/i.test(c)));
  const costing = await reportRows(db, 'costing-sheets');   // newest first: ENQ-2, ENQ-1
  assert.deepEqual(costing.map(r => r['Claude costing sheet']), [null, 'https://drive.google.com/file/d/abc/view']);
  // Touhid's sheet: the docket's latest upload in the Cost sheet, else the text from Claude's sheet
  assert.deepEqual(costing.map(r => r['Touhid costing sheet']), ['NOT DONE BY TOUHID', 'https://drive.google.com/open?id=new']);
  assert.ok((await lastSync(db, 'type-test'))?.at instanceof Date);
  assert.equal(await lastSync(db, 'auto-quotation'), null);
});

test('hover summaries: every page and group has one, short, and says so when its source is missing', () => {
  assert.equal(Object.keys(DEFAULT_SUMMARIES).length, PAGES.length + GROUPS.length);   // no two pages share a link
  for (const [key, text] of Object.entries(DEFAULT_SUMMARIES)) {
    assert.ok(text.trim(), `${key} has no summary`);
    assert.ok(text.trim().split(/\s+/).length <= MAX_SUMMARY_WORDS, `${key}: summary too long`);
  }
  for (const p of PAGES) {
    const r = reportKey(p) ? REPORTS[reportKey(p)!] : undefined;
    if (r?.sourceNeeded) assert.match(p.summary, /Source needed\.$/, p.label);
  }
});

test('page summaries: drafts until the table exists, then saved text wins; edits are validated and audited', async () => {
  const pglite = new PGlite();
  const db = pglite as unknown as Db;
  assert.deepEqual(await readPageSummaries(db), {});                 // table not deployed: no error, drafts show
  await pglite.exec(schemaSql());
  assert.deepEqual(await readPageSummaries(db), {});

  await savePageSummary(db, '/pv', '  Price variation,\n per docket.  ', 'puja@example.com');
  await savePageSummary(db, '/pv', 'Price variation per docket.', 'puja@example.com');
  await savePageSummary(db, groupKey('Masters'), 'Reference records.', 'puja@example.com');
  assert.deepEqual(await readPageSummaries(db), { '/pv': 'Price variation per docket.', 'group:Masters': 'Reference records.' });
  const log = (await db.query(`SELECT action, changes FROM audit_log WHERE table_name = 'page_summary' AND pk = '/pv' ORDER BY id`)).rows;
  assert.deepEqual(log.map(r => [r.action, r.changes.text.old, r.changes.text.new]),
    [['INSERT', null, 'Price variation, per docket.'], ['UPDATE', 'Price variation, per docket.', 'Price variation per docket.']]);

  await assert.rejects(savePageSummary(db, '/not-a-page', 'x', 'a'), /Unknown page/);
  await assert.rejects(savePageSummary(db, '/pv', '   ', 'a'), /cannot be left without a summary/);
  await assert.rejects(savePageSummary(db, '/pv', 'word '.repeat(41), 'a'), /40 words or fewer \(this one has 41\)/);
});
