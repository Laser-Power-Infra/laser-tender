"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { runMailIngest, runProcessOne } from "@/lib/mailRun";

export interface MailActionResponse { success: boolean; message?: string; error?: string }

// Signed-in users only. Nothing here sends anything to anyone: it reads the feed and writes the dashboard's own tables.
async function act(fn: (actor: string) => Promise<string>): Promise<MailActionResponse> {
  try {
    const user = await requireUser();
    const message = await fn(user.email);
    revalidatePath("/enquiries/mails");
    return { success: true, message };
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return { success: false, error: "Not available yet: the enquiry_mail table is not deployed in this database." };
    const error = err instanceof Error ? err.message : "An unexpected server error occurred.";
    if (error !== "Sign in required") console.error("[EnquiryMail] Error:", err);
    return { success: false, error };
  }
}

export async function checkMailNowAction() {
  return act(async () => {
    const r = await runMailIngest();
    const parts = [`${r.stored} new mail${r.stored === 1 ? "" : "s"}`, `${r.linked} linked`, `${r.created} enquir${r.created === 1 ? "y" : "ies"} created`, `${r.review} to review`];
    if (r.waiting) parts.push(`${r.waiting} waiting${r.ai ? " for the next run" : " (no AI key set)"}`);
    if (r.retired.length) parts.push(`${r.retired.length} duplicate${r.retired.length === 1 ? "" : "s"} retired`);
    if (r.errors.length) parts.push(`${r.errors.length} error${r.errors.length === 1 ? "" : "s"}: ${r.errors[0]}`);
    return parts.join(", ");
  });
}

/** Read the mail (again) and create its enquiry, even where the AI advised review. */
export async function createFromMailAction(threadId: string) {
  return act(async (actor) => {
    const r = await runProcessOne(threadId, true);
    if (!r.docketNo) throw new Error(r.reason);
    await pool.query("UPDATE enquiry_mail SET decided_by = $2 WHERE thread_id = $1", [threadId, actor]);
    return `Created ${r.docketNo}`;
  });
}

export async function linkMailAction(threadId: string, docketNo: string) {
  return act(async (actor) => {
    const docket = String(docketNo ?? "").trim();
    if (!docket) throw new Error("Enter the docket number to link to");
    const found = (await pool.query("SELECT docket_no FROM enquiry WHERE btrim(docket_no) = $1 AND deleted_at IS NULL", [docket])).rows[0];
    if (!found) throw new Error(`Enquiry ${docket} was not found`);
    const r = await pool.query(`UPDATE enquiry_mail SET status = 'linked', docket_no = $2, reason = $3, decided_by = $4, updated_at = now()
      WHERE thread_id = $1 AND status IN ('new', 'review', 'ignored') RETURNING thread_id`, [threadId, found.docket_no, `linked by ${actor}`, actor]);
    if (!r.rows[0]) throw new Error("This mail is already linked or has an enquiry");
    return `Linked to ${found.docket_no}`;
  });
}

export async function ignoreMailAction(threadId: string) {
  return act(async (actor) => {
    const r = await pool.query(`UPDATE enquiry_mail SET status = 'ignored', reason = $2, decided_by = $3, updated_at = now()
      WHERE thread_id = $1 AND status IN ('new', 'review') RETURNING thread_id`, [threadId, `ignored by ${actor}`, actor]);
    if (!r.rows[0]) throw new Error("Only a mail that is waiting or in review can be ignored");
    return "Ignored";
  });
}
