import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../sync/lib.ts';
import { schemaSql } from '../sync/env.ts';
import { ingestMail, processOne, reconcileMailEnquiries, type Feed } from './mailIngest.ts';
import type { MailReading, ReadResult } from './mailExtract.ts';
import type { FeedThread } from './mailMatch.ts';

// One PGlite for the whole file, schema reset per test (several instances crash V8 here).
let pglite: PGlite | undefined;
async function freshDb() {
  pglite ??= new PGlite();
  await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' + schemaSql());
  return pglite as unknown as Db;
}
const TODAY = '2026-11-27';
const thread = (id: string, subject: string, from: string, over: Partial<FeedThread> = {}): FeedThread => ({
  thread_id: id, kind: 'incoming', matched_on: ['subject'], date: '2026-11-26 16:20:00', last_updated: '2026-11-27 09:00:00', first_from: `Buyer <${from}>`, first_from_email: from, latest_from: `Buyer <${from}>`,
  message_froms: [`Buyer <${from}>`], to_details: 'enquiry@laserpowerinfra.com', cc_details: '', subject, company: 'Laser', msg_count: 1, attach_names: 'BOQ.pdf', attach_links: 'https://drive/1', body: 'Please quote.', ocr_text: 'BOQ', ...over,
});
/** A feed that serves its pages in order and records the cursor it was asked for. */
const feedOf = (pages: FeedThread[][], asked: (string | null)[] = []): Feed => {
  let i = 0;
  return { async page(since) { asked.push(since); const n = i++; return { threads: pages[n] ?? [], next_since: `2026-11-27 09:0${n}:00|${n + 1}`, more: n < pages.length - 1 }; } };
};
const reading = (over: Partial<MailReading> = {}): MailReading => ({
  mail_type: 'new_enquiry', product: 'cables_or_conductors', type_confidence: 'high', summary: 'Beta asks for LT cable.', party_company: 'Beta Infra', category: 'Purchase', category_confidence: 'medium',
  party_enquiry_no: { value: 'BI/118', quote: 'Enq no BI/118' }, due_date: { value: '2026-12-05', quote: 'by 5 Dec' }, utility: null, project_name: 'Mahape GIS', contact_person: 'R. Buyer',
  contact_no: null, gtp_required: true, csd_required: null, drum_drawing_required: false, type_test_required: null, sample_required: null, terms: null,
  items: [{ name: '1.1kV 4C x 240 sqmm AL XLPE', qty: 3.5, unit: 'KM', quote: 'x' }, { name: '1.1kV 4C x 240 sqmm AL XLPE', qty: 1, unit: 'KM', quote: 'x' }], ...over,
});
const result = (r: MailReading | null, over: Partial<ReadResult> = {}): ReadResult =>
  ({ reading: r, utility: null, dropped: [], truncated: false, model: 'claude-haiku-5-5', escalated: false, input_tokens: 1000, output_tokens: 200, cost_usd: 0.0002, ...over });

async function seed(db: Db) {
  await db.query(`INSERT INTO enquiry (docket_no, enquiry_date, party_name, enquiry_from_email, email_subject) VALUES
    ('ENQ-1', '2026-11-20', 'ALPHA EPC', 'ravi@alpha-epc.com', 'RFQ for HT cable - Koradi TPS'),
    ('ENQ-2', '2026-11-21', 'BETA INFRA', 'old.buyer@beta-infra.in', 'Zebra conductor Navasari Padghe 765kV line')`);
}

test('ingest: links what exists, parks what is unclear, reads only the rest, creates each enquiry once', async () => {
  const db = await freshDb();
  await seed(db);
  const read: string[] = [];
  const deps = {
    today: TODAY, maxAi: 10,
    read: async (t: FeedThread) => {
      read.push(t.thread_id);
      return result(t.thread_id === 'other' ? reading({ product: 'other_product', summary: 'Asks for valves.' }) : reading());
    },
  };
  const asked: (string | null)[] = [];
  const first = await ingestMail(db, { ...deps, feed: feedOf([[
    thread('dup', 'Re: RFQ for HT cable - Koradi TPS', 'meena@alpha-epc.com'),                 // same subject, same company: exists
    thread('near', 'Zebra conductor Navasari Padghe - revised BOQ', 'new.buyer@beta-infra.in'), // looks like ENQ-2: a person decides
  ], [
    thread('fresh', 'RFQ for LT Cable for Mahape GIS', 'new.buyer@beta-infra.in'),
    thread('other', 'Rate enquiry for sluice valves', 'x@valveco.in'),
  ]], asked) });
  assert.deepEqual([first.scanned, first.stored, first.linked, first.read, first.created, first.waiting, first.errors], [4, 4, 1, 2, 1, 0, []]);
  assert.deepEqual(read, ['fresh', 'other']);                                                    // no AI call for the linked or the look-alike mail
  assert.deepEqual(asked, [null, '2026-11-27 09:00:00|1']);                                      // second page asked from the first page's cursor

  const mails = Object.fromEntries((await db.query('SELECT thread_id, status, docket_no, reason, candidates FROM enquiry_mail')).rows.map(r => [r.thread_id, r]));
  assert.deepEqual([mails.dup.status, mails.dup.docket_no], ['linked', 'ENQ-1']);
  assert.deepEqual([mails.near.status, mails.near.candidates], ['review', ['ENQ-2']]);
  assert.deepEqual([mails.other.status, mails.other.reason], ['review', 'AI: not a Laser product - Asks for valves.']);
  assert.equal(mails.fresh.status, 'created');
  assert.match(mails.fresh.docket_no, /^PENDING-\d+$/);

  const e = (await db.query(`SELECT master, created_by, party_name, enquiry_date::text AS d, enquiry_from_email, email_subject, enquiry_tender_no, due_date::text AS due, enquiry_category,
      gtp_requirement, dd_requirement, csd_requirement, project_name, enquiry_contact_person, field_source FROM enquiry WHERE docket_no = $1`, [mails.fresh.docket_no])).rows[0];
  assert.deepEqual([e.master, e.created_by, e.party_name, e.d, e.enquiry_from_email, e.enquiry_tender_no, e.due, e.enquiry_category, e.gtp_requirement, e.dd_requirement, e.csd_requirement, e.project_name, e.enquiry_contact_person],
    ['dashboard', 'mail-ingest', 'BETA INFRA', '2026-11-26', 'new.buyer@beta-infra.in', 'BI/118', '2026-12-05', 'Purchase', 'Required as per Client', 'Not required', null, 'Mahape GIS', 'R. Buyer']);
  assert.deepEqual(e.field_source.party_name, { source: 'history', confidence: 'medium', note: "from past enquiries of this sender's domain" });
  assert.deepEqual(e.field_source.enquiry_tender_no, { source: 'ai', confidence: 'medium', note: 'Enq no BI/118' });
  assert.deepEqual(e.field_source.enquiry_from_email, { source: 'mail', confidence: 'high' });
  // the repeated item line is refused by the existing duplicate rule; one line is kept
  assert.deepEqual((await db.query('SELECT party_item_name, qty::text AS qty, unit FROM enquiry_item WHERE docket_no = $1', [mails.fresh.docket_no])).rows, [{ party_item_name: '1.1kV 4C x 240 sqmm AL XLPE', qty: '3.5', unit: 'KM' }]);

  // the same threads again (a reply arrived): nothing new is created, nothing is read, the cursor is resumed
  const again: (string | null)[] = [];
  const second = await ingestMail(db, { ...deps, feed: feedOf([[thread('fresh', 'RFQ for LT Cable for Mahape GIS', 'new.buyer@beta-infra.in', { msg_count: 2 })]], again) });
  assert.deepEqual([second.stored, second.read, second.created, read.length, again], [0, 0, 0, 2, ['2026-11-27 09:01:00|2']]);
  assert.deepEqual((await db.query(`SELECT msg_count, status FROM enquiry_mail WHERE thread_id = 'fresh'`)).rows, [{ msg_count: 2, status: 'created' }]);
  assert.equal(Number((await db.query(`SELECT count(*) AS n FROM enquiry WHERE master = 'dashboard'`)).rows[0].n), 1);
});

test('ingest: the per-run cap leaves the rest waiting; a failed read is retried next run; dry run writes nothing', async () => {
  const db = await freshDb();
  await seed(db);
  const mails = [thread('a', 'Enquiry for ACSR Moose - Site A', 'a@one.in'), thread('b', 'Enquiry for AAAC covered conductor - Site B', 'b@two.in'), thread('c', 'Enquiry for control cable - Site C', 'c@three.in')];

  const dry = await ingestMail(db, { feed: feedOf([mails]), today: TODAY, dryRun: true, read: async () => { throw new Error('must not be called'); } });
  assert.deepEqual([dry.dryRun, dry.stored, dry.waiting, dry.read], [true, 3, 3, 0]);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM enquiry_mail')).rows[0].n), 0);

  let fail = true;
  const read = async (t: FeedThread) => { if (t.thread_id === 'a' && fail) throw new Error('API down'); return result(reading({ items: [] })); };
  const one = await ingestMail(db, { feed: feedOf([mails]), today: TODAY, maxAi: 2, read });
  assert.deepEqual([one.read, one.created, one.waiting, one.errors.length], [1, 1, 2, 1]);       // a failed, b created, c beyond the cap
  fail = false;
  const two = await ingestMail(db, { feed: feedOf([[]]), today: TODAY, maxAi: 2, read });
  assert.deepEqual([two.read, two.created, two.waiting], [2, 2, 0]);
  assert.ok(Math.abs(Number((await db.query('SELECT sum(cost_usd) AS c FROM enquiry_mail')).rows[0].c) - 0.0006) < 1e-9);
});

test('a mail the AI parked can be created by a person; an unreadable mail cannot', async () => {
  const db = await freshDb();
  await seed(db);
  const read = async () => result(reading({ type_confidence: 'low', items: [] }));
  await ingestMail(db, { feed: feedOf([[thread('q', 'Requirement of cables for Bellary project', 'q@four.in')]]), today: TODAY, read });
  assert.equal((await db.query(`SELECT status FROM enquiry_mail WHERE thread_id = 'q'`)).rows[0].status, 'review');
  const made = await processOne(db, 'q', { today: TODAY, read }, true);
  assert.match(made.docketNo!, /^PENDING-/);
  await assert.rejects(processOne(db, 'q', { today: TODAY, read }, true), /already belongs to PENDING-/);

  await ingestMail(db, { feed: feedOf([[thread('z', 'Requirement of cables for another project', 'z@five.in')]]), today: TODAY, read: async () => result(null, { note: 'model stopped with "refusal"' }) });
  assert.deepEqual(await processOne(db, 'z', { today: TODAY, read: async () => result(null) }, true), { docketNo: null, reason: 'AI could not read this mail' });
});

test('late duplicate: an untouched PENDING enquiry is retired when Smartsheet gets the same enquiry; an edited one is only flagged', async () => {
  const db = await freshDb();
  await seed(db);
  const read = async () => result(reading({ items: [{ name: 'ACSR Moose', qty: 10, unit: 'KM', quote: 'x' }] }));
  await ingestMail(db, { feed: feedOf([[thread('m1', 'Enquiry for ACSR Moose - Site A', 'a@one.in'), thread('m2', 'Enquiry for AAAC covered conductor - Site B', 'b@two.in')]]), today: TODAY, read });
  const pend = Object.fromEntries((await db.query('SELECT thread_id, docket_no FROM enquiry_mail')).rows.map(r => [r.thread_id, r.docket_no]));
  await db.query(`UPDATE enquiry SET row_version = 2 WHERE docket_no = $1`, [pend.m2]);            // a person edited the second one
  assert.deepEqual(await reconcileMailEnquiries(db, TODAY), { retired: [], flagged: [] });         // nothing in Smartsheet yet

  await db.query(`INSERT INTO enquiry (docket_no, enquiry_date, party_name, enquiry_from_email, email_subject) VALUES
    ('ENQ-50', '2026-11-27', 'ONE', 'a@one.in', 'Enquiry for ACSR Moose - Site A'), ('ENQ-51', '2026-11-27', 'TWO', 'b@two.in', 'Enquiry for AAAC covered conductor - Site B')`);
  assert.deepEqual(await reconcileMailEnquiries(db, TODAY), { retired: [pend.m1], flagged: [pend.m2] });

  const rows = Object.fromEntries((await db.query('SELECT thread_id, status, docket_no, candidates FROM enquiry_mail')).rows.map(r => [r.thread_id, r]));
  assert.deepEqual([rows.m1.status, rows.m1.docket_no], ['linked', 'ENQ-50']);
  assert.deepEqual([rows.m2.status, rows.m2.docket_no, rows.m2.candidates], ['review', pend.m2, ['ENQ-51']]);
  assert.deepEqual((await db.query(`SELECT docket_no, deleted_at IS NOT NULL AS gone FROM enquiry WHERE docket_no LIKE 'PENDING-%' ORDER BY docket_no`)).rows,
    [{ docket_no: pend.m1, gone: true }, { docket_no: pend.m2, gone: false }].sort((a, b) => a.docket_no.localeCompare(b.docket_no)));
  assert.equal(Number((await db.query(`SELECT count(*) AS n FROM enquiry_item WHERE docket_no = $1 AND deleted_at IS NULL`, [pend.m1])).rows[0].n), 0);
  assert.deepEqual(await reconcileMailEnquiries(db, TODAY), { retired: [], flagged: [] });         // running it again changes nothing
});
