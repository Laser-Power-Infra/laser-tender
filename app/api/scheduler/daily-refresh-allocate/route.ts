import { NextResponse } from "next/server";
import { runDailyRefreshAndAllocate } from "@/lib/dailyJobs";

// Triggered by ofelia (infrastructure repo: ofelia/config.ini, job
// "laser-tender-daily-refresh-allocate"). Same key as /api/costing/refresh.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getWorkerKey = (): string | null => {
  const key = (process.env.WORKER_API_KEY || "").trim().replace(/^"|"$/g, "");
  return key || null;
};

const extractAuthKey = (req: Request): string | null => {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const xApiKey = req.headers.get("x-api-key")?.trim();
  return xApiKey || null;
};

const isAuthorized = (req: Request): boolean => {
  const expected = getWorkerKey();
  const provided = extractAuthKey(req);
  return !!expected && !!provided && provided === expected;
};

const unauthorized = () =>
  NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

// Credential probe: checks the key, does NOT run the job.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return NextResponse.json({ auth: "ok" });
}

// Runs refresh, then allocate. Body {"allocate": false} runs the refresh only.
// Job failures come back as HTTP 200 with "success": false in the body, which is
// what the ofelia script checks.
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  let allocate = true;
  try {
    const body = await request.json();
    if (body && body.allocate === false) allocate = false;
  } catch {
    // Empty or non-JSON body: use the default.
  }

  try {
    return NextResponse.json(await runDailyRefreshAndAllocate({ allocate }));
  } catch (err) {
    console.error("[DailyJobs] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
