import { syncSmartsheetToDb } from "@/lib/smartsheet-sync";
import { pool } from "@/lib/prisma";
import { runGsheetsSync } from "@/sync/gsheets_sync";
import { runSupplyHistorySync } from "@/sync/supply_history_sync";
import {
  applyTenderAllocationPlan,
  createTenderAllocationPlan,
  TENDER_ALLOCATION_ASSIGNEES,
  type TenderAllocationAssignee,
} from "@/lib/tenderAllocation";

// What the "Refresh Data" and "Allocate tender" buttons do, as one job: refresh
// first, then allocate. Called by POST /api/scheduler/daily-refresh-allocate,
// which ofelia triggers on a schedule (see SETUP.md).

export interface DailyJobsResult {
  success: boolean;
  error?: string;
  refresh: {
    status: "ok" | "partial" | "failed";
    inserted?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
  };
  allocate: {
    status: "ok" | "skipped" | "failed";
    reason?: string;
    updated?: number;
    matched?: number;
  } & Partial<Record<TenderAllocationAssignee, number>>;
  sheets?: { status: "ok" | "partial" | "failed"; tabs?: number; failed?: string[]; reason?: string };
  supply?: { status: "ok" | "failed"; rows?: number; certificates?: number; reason?: string };
  durationMs: number;
}

// On globalThis so every bundled copy of this module shares the flag.
const globalForDailyJobs = globalThis as unknown as { dailyJobsRunning?: boolean };

export async function runDailyRefreshAndAllocate(
  options: { allocate?: boolean } = {},
): Promise<DailyJobsResult> {
  const allocate = options.allocate !== false;
  const startedAt = Date.now();

  if (globalForDailyJobs.dailyJobsRunning) {
    console.warn("[DailyJobs] A run is already in progress; not starting another");
    return {
      success: false,
      error: "already running",
      refresh: { status: "failed" },
      allocate: { status: "skipped", reason: "a run is already in progress" },
      durationMs: 0,
    };
  }

  globalForDailyJobs.dailyJobsRunning = true;
  try {
    console.log(`[DailyJobs] Run started (refresh${allocate ? " + allocate" : " only"})`);
    const result: DailyJobsResult = {
      success: false,
      refresh: { status: "failed" },
      allocate: { status: "skipped" },
      durationMs: 0,
    };

    let refreshed = false;
    try {
      const sync = (await syncSmartsheetToDb({ full: true })) as
        | { inserted?: number; updated?: number; skipped?: number; failed?: number }
        | undefined;
      if (sync && typeof sync.inserted === "number") {
        const failed = sync.failed ?? 0;
        const written = sync.inserted + (sync.updated ?? 0);
        const counts = `${sync.inserted} inserted, ${sync.updated} updated, ${sync.skipped} skipped, ${failed} failed`;
        result.refresh = {
          status: "ok",
          inserted: sync.inserted,
          updated: sync.updated,
          skipped: sync.skipped,
          failed,
        };
        if (failed > 0 && written === 0) {
          // Every row failed to save, so the table is stale: do not allocate on it.
          result.refresh.status = "failed";
          console.warn(`[DailyJobs] Refresh saved nothing (${counts})`);
        } else {
          refreshed = true;
          if (failed > 0) {
            result.refresh.status = "partial";
            console.warn(`[DailyJobs] Refresh done with failures: ${counts}`);
          } else {
            console.log(`[DailyJobs] Refresh done: ${counts}`);
          }
        }
      } else {
        // syncSmartsheetToDb logs its own reason and returns nothing when it cannot finish.
        console.warn("[DailyJobs] Refresh did not complete (see the [SmartsheetSync] lines above)");
      }
    } catch (err) {
      console.error("[DailyJobs] Refresh failed:", err instanceof Error ? err.message : err);
    }

    let allocationFailed = false;
    if (!allocate) {
      result.allocate = { status: "skipped", reason: "allocation not requested" };
      console.log("[DailyJobs] Allocation not requested");
    } else if (!refreshed) {
      result.allocate = { status: "skipped", reason: "refresh did not complete" };
      console.warn("[DailyJobs] Allocation skipped because the refresh did not complete");
    } else {
      try {
        const plan = await applyTenderAllocationPlan(await createTenderAllocationPlan());
        const perPerson = Object.fromEntries(TENDER_ALLOCATION_ASSIGNEES.map((assignee) => [
          assignee,
          Object.values(plan.byCategory).reduce((sum, bucket) => sum + bucket[assignee], 0),
        ])) as Record<TenderAllocationAssignee, number>;
        result.allocate = {
          status: "ok",
          updated: plan.totalUpdated,
          matched: plan.totalMatched,
          ...perPerson,
        };
        console.log(
          `[DailyJobs] Allocation done: ${plan.totalUpdated} of ${plan.totalMatched} unallocated tenders assigned ` +
            `(${TENDER_ALLOCATION_ASSIGNEES.map((assignee) => `${assignee} ${perPerson[assignee]}`).join(", ")})`,
        );
      } catch (err) {
        allocationFailed = true;
        const message = err instanceof Error ? err.message : String(err);
        result.allocate = { status: "failed", reason: message };
        console.error("[DailyJobs] Allocation failed:", message);
      }
    }

    // Google Sheets (rates, BOM, ERP dumps, GTP...) last: it takes minutes and must not hold up or fail the allocation.
    // Its outcome is reported in `sheets` and in the sync_log table, not in `success`.
    try {
      const client = await pool.connect();   // one connection: the sync uses BEGIN/COMMIT
      try {
        const s = await runGsheetsSync(client);
        result.sheets = { status: s.failed.length ? "partial" : "ok", tabs: s.tabs, failed: s.failed };
        console[s.failed.length ? "warn" : "log"](`[DailyJobs] Google Sheets: ${s.tabs} tabs synced${s.failed.length ? `, FAILED: ${s.failed.join(", ")}` : ""}`);
      } finally {
        client.release();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.sheets = { status: "failed", reason: message };
      console.error("[DailyJobs] Google Sheets sync failed:", message);
    }

    // Supply history and performance certificates from the tender executive database: like the sheets, reported on its own and never part of `success`.
    try {
      const client = await pool.connect();   // one connection: the copy uses BEGIN/COMMIT
      try {
        const n = await runSupplyHistorySync(client);
        result.supply = { status: "ok", rows: n.supply, certificates: n.certificates };
        console.log(`[DailyJobs] Supply history: ${n.supply} rows and ${n.certificates} performance certificates copied`);
      } finally {
        client.release();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.supply = { status: "failed", reason: message };
      console.error("[DailyJobs] Supply history sync failed:", message);
    }

    result.success = refreshed && !allocationFailed;
    if (!refreshed) result.error = "refresh did not complete";
    else if (allocationFailed) result.error = "allocation failed";
    result.durationMs = Date.now() - startedAt;
    console.log(`[DailyJobs] Run finished in ${(result.durationMs / 1000).toFixed(1)}s (success=${result.success})`);
    return result;
  } finally {
    globalForDailyJobs.dailyJobsRunning = false;
  }
}
