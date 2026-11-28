import { NextResponse } from "next/server";
import { runMailIngest } from "@/lib/mailRun";

// Triggered by ofelia every few minutes (infrastructure repo), with the same key as the daily job (WORKER_API_KEY).
// Reads new enquiry mails from the Email Dashboard, links them to existing enquiries or creates PENDING ones.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: Request): boolean {
  const expected = (process.env.WORKER_API_KEY || "").trim().replace(/^"|"$/g, "");
  const auth = req.headers.get("authorization") || "";
  const provided = (auth.startsWith("Bearer ") ? auth.slice(7) : req.headers.get("x-api-key") || "").trim();
  return !!expected && !!provided && provided === expected;
}
const unauthorized = () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

// Credential probe: checks the key, does NOT run the job.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return NextResponse.json({ auth: "ok" });
}

// A failed run comes back as HTTP 200 with "success": false, which is what the ofelia script checks.
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const res = await runMailIngest();
    return NextResponse.json({ success: res.errors.length === 0, ...res });
  } catch (err) {
    console.error("[MailIngest] Error:", err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
}
