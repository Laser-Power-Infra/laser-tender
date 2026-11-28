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
    ('TYPE_TEST', 'TYPE TESTS AVAILABLE', 1, '{"Sr No":"1","Laboratory":"CPRI"}'),
    ('CLAUDE_COSTINGS', 'CLAUDE COSTING SHEETS', 1, '{"ENQ Docket No":"ENQ-1","Drive file id":"abc"}'),
    ('CLAUDE_COSTINGS', 'CLAUDE COSTING SHEETS', 2, '{"ENQ Docket No":""}')`);
  await db.query(`INSERT INTO sync_log (job, started_at, finished_at, ok) VALUES ('gsheets:TYPE_TEST:TYPE TESTS AVAILABLE', now(), now(), true)`);

  const inNav = new Set(PAGES.map(reportKey));
  for (const [key, r] of Object.entries(REPORTS)) {
    assert.ok(inNav.has(key), `${key} is missing from lib/pages.ts`);
    const rows = await reportRows(db, key);              // throws on broken SQL
    await lastSync(db, key);
    if (r.sourceNeeded !== undefined) assert.match(r.sourceNeeded, /^Source needed: .+ — .+ — .+$/);
    else for (const row of rows) for (const c of r.cols) assert.ok(c in row, `${key}: column ${c}`);
  }
  for (const k of inNav) if (k && k !== 'status') assert.ok(REPORTS[k], `page ${k} has no report`);

  assert.equal(new Set(PAGES.flatMap(p => p.no ?? [])).size, 22);   // all 22 pages of ENQUIRY TO QUOTATION (N), each once
  assert.deepEqual(PAGES.flatMap(p => p.ce ?? []), [1, 2, 3, 4, 5]);  // and the 5 pages of CONT EX 2: 27 in all
  for (const p of PAGES.filter(p => p.ce)) assert.ok(REPORTS[reportKey(p)!].sourceNeeded);
  assert.equal((await reportRows(db, 'type-test'))[0].Laboratory, 'CPRI');
  assert.deepEqual((await reportRows(db, 'costing-sheets')).map(r => r['Claude costing sheet']), ['https://drive.google.com/file/d/abc/view']);
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
