"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { readPageSummaries, savePageSummary } from "@/lib/pageSummary";

/** Saved hover summaries for the navigation. Never fails the page: on any error the drafts in lib/pages.ts show. */
export async function getPageSummariesAction(): Promise<Record<string, string>> {
  try {
    return await readPageSummaries(pool);
  } catch (err) {
    console.error("[PageSummary] read failed:", err);
    return {};
  }
}

// Admins only (guideline 9.7: the summaries are Puja's to edit).
export async function savePageSummaryAction(key: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new Error("Only an admin can edit page summaries");
    const client = await pool.connect();
    try {
      await savePageSummary(client, key, text, user.email);
    } finally {
      client.release();
    }
    revalidatePath("/reports");
    return { success: true };
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return { success: false, error: "Not available yet: the page_summary table is not deployed in this database." };
    return { success: false, error: err instanceof Error ? err.message : "An unexpected server error occurred." };
  }
}
