// One enquiry-mail run for the app: used by the scheduler route and the "Check mail now" button.
import { pool } from "@/lib/prisma";
import { aiReader, httpFeed, ingestMail, istToday, processOne, reconcileMailEnquiries, type IngestResult } from "@/lib/mailIngest";
import type { Db } from "@/sync/lib";

// On globalThis for the same reason as the Smartsheet sync: Next may bundle this file twice (actions and API routes).
const g = globalThis as unknown as { mailRun?: Promise<MailRunResult> | null };
export type MailRunResult = IngestResult & { retired: string[]; flagged: string[]; ai: boolean };

/** One dedicated connection for the run: creating an enquiry uses BEGIN/COMMIT, which must stay on one connection. */
async function withClient<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

/** Read the feed, link, read with AI, create; then retire late duplicates. A run already in progress is joined, not doubled. */
export function runMailIngest(): Promise<MailRunResult> {
  g.mailRun ??= withClient(async (db) => {
    const today = istToday(), read = await aiReader(db, today);
    const res = await ingestMail(db, { feed: httpFeed(), today, read, maxAi: Number(process.env.MAIL_AI_MAX_PER_RUN) || 25 });
    return { ...res, ...(await reconcileMailEnquiries(db, today)), ai: !!read };
  }).finally(() => { g.mailRun = null; });
  return g.mailRun;
}

/** A person asked for one mail to be read (again) and, with `force`, created whatever the AI advises. */
export const runProcessOne = (threadId: string, force: boolean) =>
  withClient(async (db) => { const today = istToday(); return processOne(db, threadId, { today, read: await aiReader(db, today) }, force); });
