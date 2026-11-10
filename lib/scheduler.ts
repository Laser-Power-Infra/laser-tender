import { syncSmartsheetToDb } from "@/lib/smartsheet-sync";
import { applyTenderAllocationPlan, createTenderAllocationPlan } from "@/lib/tenderAllocation";

// Daily automatic run of what the "Refresh Data" and "Allocate tender" buttons do.
// Started from instrumentation.ts when the server boots. Off unless
// AUTO_DAILY_RUN_TIME_IST is set (see SETUP.md).

const IST_OFFSET_MINUTES = 330; // India has no daylight saving, so this is fixed.
const DAY_MS = 24 * 60 * 60 * 1000;

const globalForScheduler = globalThis as unknown as {
  tenderScheduler?: { timer: NodeJS.Timeout | null; generation: number; running: boolean };
};

function cleanEnv(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

/** Parses "HH:MM" (24-hour, India time) into minutes after midnight, or null if invalid. */
export function parseDailyTime(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(cleanEnv(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** First moment strictly after `after` (epoch ms) that is `istMinutes` past midnight in India. */
export function nextRunAt(istMinutes: number, after: number): number {
  const utcMinutes = (istMinutes - IST_OFFSET_MINUTES + 1440) % 1440;
  const day = new Date(after);
  let candidate = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + utcMinutes * 60_000;
  if (candidate <= after) candidate += DAY_MS;
  return candidate;
}

function formatIst(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) + " IST";
}

async function runDailyJobs(allocateAfterRefresh: boolean): Promise<void> {
  const startedAt = Date.now();
  console.log("[Scheduler] Daily run started");

  let refreshed = false;
  try {
    const result = (await syncSmartsheetToDb()) as
      | { inserted?: number; updated?: number; skipped?: number; failed?: number }
      | undefined;
    if (result && typeof result.inserted === "number") {
      const failed = result.failed ?? 0;
      const written = result.inserted + (result.updated ?? 0);
      const counts =
        `${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${failed} failed`;
      if (failed > 0 && written === 0) {
        // Every row failed to save, so the table is stale: do not allocate on it.
        console.warn(`[Scheduler] Refresh saved nothing (${counts})`);
      } else {
        refreshed = true;
        if (failed > 0) console.warn(`[Scheduler] Refresh done with failures: ${counts}`);
        else console.log(`[Scheduler] Refresh done: ${counts}`);
      }
    } else {
      // syncSmartsheetToDb logs its own reason and returns nothing when it cannot finish.
      console.warn("[Scheduler] Refresh did not complete (see the [SmartsheetSync] lines above)");
    }
  } catch (err) {
    console.error("[Scheduler] Refresh failed:", err instanceof Error ? err.message : err);
  }

  if (!allocateAfterRefresh) {
    console.log("[Scheduler] Allocation is switched off (AUTO_ALLOCATE_AFTER_REFRESH)");
  } else if (!refreshed) {
    console.warn("[Scheduler] Allocation skipped because the refresh did not complete");
  } else {
    try {
      const plan = await applyTenderAllocationPlan(await createTenderAllocationPlan());
      const perPerson = Object.values(plan.byCategory).reduce(
        (sum, bucket) => ({ PRITIKANA: sum.PRITIKANA + bucket.PRITIKANA, RITWICK: sum.RITWICK + bucket.RITWICK }),
        { PRITIKANA: 0, RITWICK: 0 },
      );
      console.log(
        `[Scheduler] Allocation done: ${plan.totalUpdated} of ${plan.totalMatched} unallocated tenders assigned ` +
          `(PRITIKANA ${perPerson.PRITIKANA}, RITWICK ${perPerson.RITWICK})`,
      );
    } catch (err) {
      console.error("[Scheduler] Allocation failed:", err instanceof Error ? err.message : err);
    }
  }

  console.log(`[Scheduler] Daily run finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

export function startScheduler(): void {
  const state = (globalForScheduler.tenderScheduler ??= { timer: null, generation: 0, running: false });

  // A dev hot reload can call this again: drop the old timer so only one clock is ticking.
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  const generation = ++state.generation;

  const rawTime = cleanEnv(process.env.AUTO_DAILY_RUN_TIME_IST);
  if (!rawTime) {
    console.log("[Scheduler] Off (AUTO_DAILY_RUN_TIME_IST is not set)");
    return;
  }
  const istMinutes = parseDailyTime(rawTime);
  if (istMinutes === null) {
    console.warn("[Scheduler] Off: AUTO_DAILY_RUN_TIME_IST must look like 07:00 (24-hour, India time)");
    return;
  }
  const allocateAfterRefresh = !["false", "0", "no", "off"].includes(
    cleanEnv(process.env.AUTO_ALLOCATE_AFTER_REFRESH).toLowerCase(),
  );

  const schedule = (after: number) => {
    const target = nextRunAt(istMinutes, after);
    console.log(
      `[Scheduler] Next daily run: ${formatIst(target)} ` +
        `(refresh${allocateAfterRefresh ? " + allocate" : " only"})`,
    );
    state.timer = setTimeout(async () => {
      if (state.generation !== generation) return;
      state.timer = null;
      if (state.running) {
        console.warn("[Scheduler] Previous run is still going; skipping this one");
      } else {
        state.running = true;
        try {
          await runDailyJobs(allocateAfterRefresh);
        } catch (err) {
          console.error("[Scheduler] Run failed:", err instanceof Error ? err.message : err);
        } finally {
          state.running = false;
        }
      }
      // Timers can fire a few ms early; never re-book the slot that just ran.
      if (state.generation === generation) schedule(Math.max(Date.now(), target + 60_000));
    }, Math.max(0, target - Date.now()));
    state.timer.unref?.();
  };

  schedule(Date.now());
}
