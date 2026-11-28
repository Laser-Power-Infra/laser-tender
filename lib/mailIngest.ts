// Enquiry mail ingest (guideline 27 Nov 2026, sections 3.1 to 3.3): read the Email Dashboard feed, keep each thread once,
// check whether its enquiry already exists, and only then read it with AI and create a PENDING enquiry with the fields filled.
// `db` must be ONE connection: createEnquiry / addItem wrap their writes in BEGIN/COMMIT.
import { type Db } from '../sync/lib.ts';
import { addItem, createEnquiry, type Values } from './enquiryWrite.ts';
import { buildIndex, matchThread, partyOf, type EnquiryIndex, type FeedThread, type KnownEnquiry, type Match } from './mailMatch.ts';
import { anthropicClient, readConfigFromEnv, readMail, type MailReading, type ReadResult } from './mailExtract.ts';

export const MAIL_ACTOR = 'mail-ingest';
const JOB = 'mail:enquiries';
const missingTable = (e: unknown) => (e as { code?: string })?.code === '42P01';

/** Today's date in India, YYYY-MM-DD. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** The AI reader with its settings and the utility list, or undefined when no key is set (mails are then stored and linked, and wait unread). */
export async function aiReader(db: Db, today: string): Promise<((t: FeedThread) => Promise<ReadResult>) | undefined> {
  if (!(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)) return undefined;
  const client = anthropicClient(), { cfg, escalate } = readConfigFromEnv();
  const utilities: string[] = (await db.query('SELECT name FROM ref_utility WHERE active')).rows.map(r => r.name);
  return t => readMail(client, t, { utilities }, today, cfg, escalate);
}

export interface FeedPage { threads: FeedThread[]; next_since: string | null; more: boolean }
export interface Feed { page(since: string | null, days: number): Promise<FeedPage> }

/** The live feed: Email Dashboard GET /api/db-emails/enquiries (settings EMAIL_DASHBOARD_URL, ENQUIRY_FEED_API_KEY). */
export function httpFeed(): Feed {
  const base = (process.env.EMAIL_DASHBOARD_URL || '').replace(/\/+$/, ''), key = process.env.ENQUIRY_FEED_API_KEY;
  if (!base || !key) throw new Error('EMAIL_DASHBOARD_URL / ENQUIRY_FEED_API_KEY are not set');
  return {
    async page(since, days) {
      const qs = since ? `since=${encodeURIComponent(since)}` : `days=${days}`;
      const res = await fetch(`${base}/api/db-emails/enquiries?${qs}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`Email Dashboard feed answered ${res.status}`);
      const j = await res.json();
      return { threads: j.threads ?? [], next_since: j.next_since ?? null, more: !!j.more };
    },
  };
}

export async function loadKnown(db: Db, where = ''): Promise<KnownEnquiry[]> {
  return (await db.query(`SELECT docket_no, email_subject, enquiry_from_email, party_name, enquiry_date::text AS enquiry_date FROM enquiry WHERE deleted_at IS NULL ${where}`)).rows;
}

export interface IngestDeps {
  feed: Feed;
  /** The AI reading; omit to skip reading (mails stay waiting). */
  read?: (t: FeedThread) => Promise<ReadResult>;
  today: string;                 // YYYY-MM-DD, IST
  maxAi?: number;                // most mails read per run
  dryRun?: boolean;              // no writes, no AI: only report what would happen
  firstRunDays?: number;
}
export interface IngestResult {
  dryRun: boolean; scanned: number; stored: number; linked: number; review: number; waiting: number;
  read: number; created: number; escalated: number; cost_usd: number; errors: string[]; dockets: string[];
}

const yes = (v: boolean | null, t: string, f = 'Not required') => (v === true ? t : v === false ? f : null);
const displayName = (from: string) => from.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();

/** The enquiry values a mail and its reading give, with where each one came from. Blank values are left out. */
export function enquiryValues(t: FeedThread, r: ReadResult, ix: EnquiryIndex, today: string): { values: Values; sources: Record<string, { source: string; confidence: string; note?: string }> } {
  const values: Values = {}, sources: Record<string, { source: string; confidence: string; note?: string }> = {};
  const set = (col: string, v: unknown, source: string, confidence: string, note?: string) => {
    if (v === null || v === undefined || v === '') return;
    values[col] = v; sources[col] = { source, confidence, ...(note ? { note } : {}) };
  };
  const g = r.reading as MailReading;
  // The feed dates a thread by its latest message; for a single mail that is the enquiry's own date.
  set('enquiry_date', t.msg_count === 1 && /^\d{4}-\d\d-\d\d/.test(t.date) ? t.date.slice(0, 10) : today, 'mail', t.msg_count === 1 ? 'high' : 'medium', t.msg_count === 1 ? undefined : 'date the thread was first seen');
  set('enquiry_from_email', t.first_from_email, 'mail', 'high');
  set('email_subject', t.subject, 'mail', 'high');
  const p = partyOf(t.first_from_email, ix);
  if (p.party) set('party_name', p.party, 'history', p.via === 'address' ? 'high' : 'medium', `from past enquiries of this sender's ${p.via}`);
  else sources.party_name = { source: 'history', confidence: 'low', note: p.candidates.length ? `several parties use this sender: ${p.candidates.join(' / ')}` : `sender not seen before${g.party_company ? `; signs as "${g.party_company}"` : ''}` };
  set('enquiry_contact_person', g.contact_person || displayName(t.first_from), g.contact_person ? 'ai' : 'mail', 'medium');
  set('enquiry_contact_no', g.contact_no?.value, 'ai', 'medium', g.contact_no?.quote);
  set('enquiry_tender_no', g.party_enquiry_no?.value, 'ai', 'medium', g.party_enquiry_no?.quote);
  set('due_date', g.due_date?.value, 'ai', 'medium', g.due_date?.quote);
  set('project_name', g.project_name, 'ai', 'low');
  if (r.utility) set('utility', r.utility, 'ai', 'medium', g.utility?.quote);
  else if (g.utility) sources.utility = { source: 'ai', confidence: 'low', note: `mail says "${g.utility.value}", not found in the utility list` };
  set('enquiry_category', g.category, 'ai', g.category_confidence);
  set('gtp_requirement', yes(g.gtp_required, 'Required as per Client'), 'ai', 'low');
  set('csd_requirement', yes(g.csd_required, 'Required'), 'ai', 'low');
  set('dd_requirement', yes(g.drum_drawing_required, 'Required'), 'ai', 'low');
  set('type_test_requirement', yes(g.type_test_required, 'Required'), 'ai', 'low');
  set('sample_required', g.sample_required === true ? 'Yes' : null, 'ai', 'low');
  set('terms_conditions', g.terms, 'ai', 'low');
  return { values, sources };
}

/** What to do with a mail once it has been read. */
export function decide(r: ReadResult): { create: boolean; reason: string } {
  const g = r.reading;
  if (!g) return { create: false, reason: `AI could not read this mail${r.note ? ` (${r.note})` : ''}` };
  if (g.mail_type !== 'new_enquiry') return { create: false, reason: `AI: ${g.mail_type.replace(/_/g, ' ')} - ${g.summary}` };
  if (g.product !== 'cables_or_conductors') return { create: false, reason: `AI: ${g.product === 'other_product' ? 'not a Laser product' : 'material not stated'} - ${g.summary}` };
  if (g.type_confidence === 'low') return { create: false, reason: `AI not confident this is a new enquiry - ${g.summary}` };
  return { create: true, reason: g.summary };
}

const FEED_COLS = ['kind', 'matched_on', 'mail_date', 'feed_updated', 'first_from', 'first_from_email', 'latest_from', 'to_details', 'cc_details', 'subject', 'company', 'msg_count', 'attach_names', 'attach_links', 'body', 'ocr_text'];
const feedValues = (t: FeedThread) => [t.kind, (t.matched_on ?? []).join('+'), t.date || null, t.last_updated || null, t.first_from, t.first_from_email, t.latest_from, t.to_details, t.cc_details, t.subject, t.company, t.msg_count, t.attach_names, t.attach_links, t.body, t.ocr_text ?? ''];
const rowToThread = (m: any): FeedThread => ({
  thread_id: m.thread_id, kind: m.kind, matched_on: String(m.matched_on ?? '').split('+').filter(Boolean), date: m.mail_date ?? '', last_updated: m.feed_updated ?? '', first_from: m.first_from ?? '',
  first_from_email: m.first_from_email ?? '', latest_from: m.latest_from ?? '', message_froms: [m.first_from ?? ''], to_details: m.to_details ?? '', cc_details: m.cc_details ?? '', subject: m.subject ?? '',
  company: m.company ?? '', msg_count: m.msg_count ?? 1, attach_names: m.attach_names ?? '', attach_links: m.attach_links ?? '', body: m.body ?? '', ocr_text: m.ocr_text ?? '',
});
const mailSelect = (a = '') => `${a}thread_id, ${a}kind, ${a}matched_on, to_char(${a}mail_date, 'YYYY-MM-DD HH24:MI:SS') AS mail_date, to_char(${a}feed_updated, 'YYYY-MM-DD HH24:MI:SS') AS feed_updated,
  ${a}first_from, ${a}first_from_email, ${a}latest_from, ${a}to_details, ${a}cc_details, ${a}subject, ${a}company, ${a}msg_count, ${a}attach_names, ${a}attach_links, ${a}body, ${a}ocr_text`;
const MAIL_SELECT = mailSelect();

/** Create the PENDING enquiry for one read mail and mark the mail. Safe to repeat: an enquiry already made for this mail is adopted, not made twice. */
async function createFromMail(db: Db, t: FeedThread, r: ReadResult, ix: EnquiryIndex, today: string, reason: string): Promise<string> {
  const { values, sources } = enquiryValues(t, r, ix, today);
  // a crash between creating the enquiry and marking the mail must not create it again on the next run
  const orphan = (await db.query(`SELECT docket_no FROM enquiry WHERE master = 'dashboard' AND created_by = $1 AND deleted_at IS NULL AND email_subject = $2 AND enquiry_from_email = $3
      AND NOT EXISTS (SELECT 1 FROM enquiry_mail m WHERE m.docket_no = enquiry.docket_no) ORDER BY created_at DESC LIMIT 1`, [MAIL_ACTOR, t.subject, t.first_from_email])).rows[0];
  const docketNo: string = orphan?.docket_no ?? (await createEnquiry(db, values, MAIL_ACTOR)).docketNo;
  await db.query(`WITH e AS (UPDATE enquiry SET field_source = $2::jsonb WHERE docket_no = $1)
    UPDATE enquiry_mail SET status = 'created', docket_no = $1, reason = $3, updated_at = now() WHERE thread_id = $4`, [docketNo, JSON.stringify(sources), reason, t.thread_id]);
  if (!orphan) for (const it of r.reading!.items) {
    // the existing rule refuses a second line with the same item name in one docket: such a line is skipped, the rest go in
    try { await addItem(db, docketNo, { party_item_name: it.name, ...(it.qty != null ? { qty: it.qty } : {}), ...(it.unit ? { unit: it.unit } : {}) }, MAIL_ACTOR); }
    catch (e) { if (!/Duplicate item line/.test((e as Error).message)) throw e; }
  }
  return docketNo;
}

const saveReading = (db: Db, threadId: string, r: ReadResult) => db.query(
  `UPDATE enquiry_mail SET extracted = $2::jsonb, extract_model = $3, input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, cost_usd = cost_usd + $6, extracted_at = now(), updated_at = now() WHERE thread_id = $1`,
  [threadId, JSON.stringify({ reading: r.reading, utility: r.utility, dropped: r.dropped, truncated: r.truncated, escalated: r.escalated, note: r.note ?? null }), r.model, r.input_tokens, r.output_tokens, r.cost_usd]);

/** Read waiting mails (oldest first, at most `max`) and create or park each one. */
async function readWaiting(db: Db, deps: IngestDeps, ix: EnquiryIndex, out: IngestResult, only?: string) {
  if (!deps.read) return;
  const waiting = (await db.query(`SELECT ${MAIL_SELECT} FROM enquiry_mail WHERE ${only ? 'thread_id = $2' : `status = 'new'`} ORDER BY first_seen_at, thread_id LIMIT $1`, only ? [1, only] : [deps.maxAi ?? 25])).rows;
  let failures = 0;
  for (const m of waiting) {
    const t = rowToThread(m);
    try {
      const r = await deps.read(t);
      out.read++; out.cost_usd += r.cost_usd; if (r.escalated) out.escalated++;
      await saveReading(db, t.thread_id, r);
      const d = decide(r);
      if (d.create) { out.dockets.push(await createFromMail(db, t, r, ix, deps.today, d.reason)); out.created++; }
      else { await db.query(`UPDATE enquiry_mail SET status = 'review', reason = $2, updated_at = now() WHERE thread_id = $1`, [t.thread_id, d.reason]); out.review++; }
      failures = 0;
    } catch (e) {
      // the mail stays waiting and is tried again on the next run
      out.errors.push(`${t.subject.slice(0, 60)}: ${(e as Error).message.slice(0, 160)}`);
      if (++failures >= 3) { out.errors.push('stopped reading after 3 failures in a row'); break; }
    }
  }
}

export async function ingestMail(db: Db, deps: IngestDeps): Promise<IngestResult> {
  const out: IngestResult = { dryRun: !!deps.dryRun, scanned: 0, stored: 0, linked: 0, review: 0, waiting: 0, read: 0, created: 0, escalated: 0, cost_usd: 0, errors: [], dockets: [] };
  const ix = buildIndex(await loadKnown(db), deps.today);

  let known = new Set<string>(), since: string | null = null;
  try {
    known = new Set((await db.query('SELECT thread_id FROM enquiry_mail')).rows.map(r => r.thread_id));
    since = (await db.query('SELECT detail FROM sync_state WHERE job = $1', [JOB])).rows[0]?.detail?.next_since ?? null;
  } catch (e) {
    if (!missingTable(e)) throw e;
    if (!deps.dryRun) throw new Error('The enquiry_mail table is not deployed in this database yet.');
  }

  // 1. take everything new from the feed; decide each new thread without AI
  for (let pages = 0; pages < 50; pages++) {
    const page = await deps.feed.page(since, deps.firstRunDays ?? 1);
    for (const t of page.threads) {
      out.scanned++;
      if (known.has(t.thread_id)) {
        // a thread we hold: refresh what the feed owns, keep our decision
        if (!deps.dryRun) await db.query(`UPDATE enquiry_mail SET ${FEED_COLS.filter(c => c !== 'kind' && c !== 'first_from' && c !== 'first_from_email').map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE thread_id = $1`,
          [t.thread_id, ...FEED_COLS.map((c, i) => [c, feedValues(t)[i]] as const).filter(([c]) => c !== 'kind' && c !== 'first_from' && c !== 'first_from_email').map(([, v]) => v)]);
        continue;
      }
      known.add(t.thread_id);
      const m: Match = matchThread(t, ix);
      out.stored++;
      if (m.status === 'linked') out.linked++; else if (m.status === 'review') out.review++; else out.waiting++;
      if (deps.dryRun) continue;
      await db.query(`INSERT INTO enquiry_mail (thread_id, ${FEED_COLS.join(', ')}, status, docket_no, reason, candidates)
        VALUES ($1, ${FEED_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${FEED_COLS.length + 2}, $${FEED_COLS.length + 3}, $${FEED_COLS.length + 4}, $${FEED_COLS.length + 5}::jsonb) ON CONFLICT (thread_id) DO NOTHING`,
        [t.thread_id, ...feedValues(t), m.status, m.status === 'linked' ? m.docket_no : null, m.status === 'new' ? null : m.reason, JSON.stringify(m.status === 'review' ? m.candidates : [])]);
    }
    since = page.next_since ?? since;
    if (!deps.dryRun && since) await db.query(`INSERT INTO sync_state (job, last_success_at, detail) VALUES ($1, now(), $2::jsonb)
      ON CONFLICT (job) DO UPDATE SET last_success_at = now(), detail = $2::jsonb`, [JOB, JSON.stringify({ next_since: since })]);
    if (!page.more) break;
  }
  if (deps.dryRun) return out;

  // 2. read the mails that have no enquiry yet, and create or park them
  await readWaiting(db, deps, ix, out);
  out.waiting = Number((await db.query(`SELECT count(*)::int AS n FROM enquiry_mail WHERE status = 'new'`)).rows[0].n);
  return out;
}

/** "Read again" / "Create enquiry" for one mail a person picked on the Enquiry mails page. `force` creates even when the AI advised review. */
export async function processOne(db: Db, threadId: string, deps: Pick<IngestDeps, 'read' | 'today'>, force: boolean): Promise<{ docketNo: string | null; reason: string }> {
  if (!deps.read) throw new Error('AI reading is not configured');
  const m = (await db.query(`SELECT ${MAIL_SELECT}, status, docket_no FROM enquiry_mail WHERE thread_id = $1`, [threadId])).rows[0];
  if (!m) throw new Error('Mail not found');
  if (m.docket_no) throw new Error(`This mail already belongs to ${m.docket_no}`);
  const t = rowToThread(m), ix = buildIndex(await loadKnown(db), deps.today);
  const r = await deps.read(t);
  await saveReading(db, threadId, r);
  const d = decide(r);
  if (!r.reading || (!d.create && !force)) {
    await db.query(`UPDATE enquiry_mail SET status = 'review', reason = $2, updated_at = now() WHERE thread_id = $1`, [threadId, d.reason]);
    return { docketNo: null, reason: d.reason };
  }
  return { docketNo: await createFromMail(db, t, r, ix, deps.today, d.create ? d.reason : `created by a person; ${d.reason}`), reason: d.reason };
}

/**
 * Late duplicates: the team may enter in Smartsheet an enquiry the dashboard already created from mail. Run after every Smartsheet sync.
 * An untouched PENDING enquiry is retired and its mail linked to the Smartsheet docket; one a person has edited is only flagged.
 */
export async function reconcileMailEnquiries(db: Db, today: string): Promise<{ retired: string[]; flagged: string[] }> {
  const out = { retired: [] as string[], flagged: [] as string[] };
  let mails: any[];
  try {
    mails = (await db.query(`SELECT ${mailSelect('m.')}, m.docket_no, e.row_version
      FROM enquiry_mail m JOIN enquiry e ON e.docket_no = m.docket_no AND e.deleted_at IS NULL AND e.master = 'dashboard'
      WHERE m.status = 'created' AND m.docket_no LIKE 'PENDING-%'`)).rows;
  } catch (e) { if (missingTable(e)) return out; throw e; }
  if (!mails.length) return out;
  const ix = buildIndex(await loadKnown(db, `AND master = 'smartsheet'`), today);
  for (const m of mails) {
    const match = matchThread(rowToThread(m), ix);
    if (match.status !== 'linked') continue;
    if (Number(m.row_version) === 1) {
      await db.query('BEGIN');
      try {
        await db.query(`UPDATE enquiry_item SET deleted_at = now() WHERE docket_no = $1 AND deleted_at IS NULL`, [m.docket_no]);
        await db.query(`UPDATE enquiry SET deleted_at = now(), updated_by = $2 WHERE docket_no = $1`, [m.docket_no, MAIL_ACTOR]);
        await db.query(`UPDATE enquiry_mail SET status = 'linked', docket_no = $2, reason = $3, updated_at = now() WHERE thread_id = $1`,
          [m.thread_id, match.docket_no, `${m.docket_no} retired: the team entered this enquiry in Smartsheet as ${match.docket_no}`]);
        await db.query('INSERT INTO audit_log (actor, action, table_name, pk, changes) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [MAIL_ACTOR, 'UPDATE', 'enquiry', m.docket_no, JSON.stringify({ deleted_at: { old: null, new: 'retired: duplicate of ' + match.docket_no } })]);
        await db.query('COMMIT');
        out.retired.push(m.docket_no);
      } catch (e) { await db.query('ROLLBACK'); throw e; }
    } else {
      await db.query(`UPDATE enquiry_mail SET status = 'review', reason = $2, candidates = $3::jsonb, updated_at = now() WHERE thread_id = $1`,
        [m.thread_id, `also entered in Smartsheet as ${match.docket_no}; ${m.docket_no} has been edited here, so merge it by hand`, JSON.stringify([match.docket_no])]);
      out.flagged.push(m.docket_no);
    }
  }
  return out;
}
