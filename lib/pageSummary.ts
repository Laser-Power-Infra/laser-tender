// Hover summaries of the navigation (guideline 9.7): drafts live in lib/pages.ts, Puja's edits in the table page_summary.
// `db` must be ONE connection for savePageSummary (the write shares a transaction with its audit_log row).
import { type Db, inTransaction } from '../sync/lib.ts';
import { DEFAULT_SUMMARIES, MAX_SUMMARY_WORDS } from './pages.ts';

/** Saved texts by key (page href or group key). Empty while the table is not deployed, so the drafts show. */
export async function readPageSummaries(db: Db): Promise<Record<string, string>> {
  try {
    return Object.fromEntries((await db.query('SELECT href, text FROM page_summary')).rows.map(r => [r.href, r.text]));
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return {};
    throw e;
  }
}

export async function savePageSummary(db: Db, key: string, text: string, actor: string): Promise<{ key: string; text: string }> {
  if (!Object.hasOwn(DEFAULT_SUMMARIES, key)) throw new Error('Unknown page');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('A page cannot be left without a summary');
  const words = clean.split(' ').length;
  if (words > MAX_SUMMARY_WORDS) throw new Error(`Keep the summary to ${MAX_SUMMARY_WORDS} words or fewer (this one has ${words})`);
  return inTransaction(db, async () => {
    const old = (await db.query('SELECT text FROM page_summary WHERE href = $1 FOR UPDATE', [key])).rows[0]?.text ?? null;
    await db.query(`INSERT INTO page_summary (href, text, edited_by) VALUES ($1, $2, $3)
      ON CONFLICT (href) DO UPDATE SET text = $2, edited_by = $3, edited_at = now()`, [key, clean, actor]);
    await db.query('INSERT INTO audit_log (actor, action, table_name, pk, changes) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actor, old === null ? 'INSERT' : 'UPDATE', 'page_summary', key, JSON.stringify({ text: { old, new: clean } })]);
    return { key, text: clean };
  });
}
