"use server";

import { pool } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { draftCosting, readCostingRuns, type CostingRunView, type DraftResult } from "@/lib/costingRun";

const message = (err: unknown) => (err instanceof Error ? err.message : "An unexpected server error occurred.");

export async function runDraftCosting(docketNo: string): Promise<{ success: boolean; result?: DraftResult; error?: string }> {
  try {
    const user = await requireUser();
    const client = await pool.connect();          // one connection: the run is written in a single transaction
    try {
      // en-CA = YYYY-MM-DD in the server's local time zone
      return { success: true, result: await draftCosting(client, docketNo.trim(), user.email, new Date().toLocaleDateString("en-CA")) };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[DraftCosting] Error:", err);
    return { success: false, error: message(err) };
  }
}

export async function getCostingRuns(docketNo: string): Promise<{ success: boolean; data: CostingRunView[]; error?: string }> {
  try {
    return { success: true, data: await readCostingRuns(pool, "docket_no", docketNo.trim()) };
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return { success: true, data: [] };   // costing tables not deployed yet
    console.error("[CostingRuns] Error:", err);
    return { success: false, data: [], error: message(err) };
  }
}
