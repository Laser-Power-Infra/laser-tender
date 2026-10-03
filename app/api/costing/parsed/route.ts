import crypto from "crypto";
import { NextResponse } from "next/server";
import { mapAutomationV2Result } from "@/lib/costingMapping.mjs";
import { extractNumericDocket } from "@/services/costingFileFinder.mjs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Signature verification (automation-v2 webhook) ──────────────────────────
const getWebhookSecret = (): string => {
  return (process.env.AUTOMATION_V2_WEBHOOK_SECRET || "")
    .trim()
    .replace(/^"|"$/g, "");
};

/**
 * Verifies `sha256=HMAC_SHA256(secret, "{timestamp}.{rawBody}")`.
 * Returns true when the secret is not configured (verification disabled) so the
 * flow works before the operator adds AUTOMATION_V2_WEBHOOK_SECRET.
 */
function verifySignature(request: Request, rawBody: string): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn(
      "[CostingParsed] WARNING: AUTOMATION_V2_WEBHOOK_SECRET not set — webhook signature verification disabled."
    );
    return true;
  }
  const ts = request.headers.get("x-webhook-timestamp") || "";
  const sig = request.headers.get("x-webhook-signature") || "";
  if (!/^\d+$/.test(ts) || !sig) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${rawBody}`)
      .digest("hex");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Exact → ILIKE docket update (shared with the success path) ──────────────
async function updateByDocket(
  docket: string,
  fields: Record<string, unknown>
): Promise<{ found: boolean; matchedDocket?: string }> {
  // 1) Exact match on the full docket number.
  try {
    await prisma.smartsheetTender.update({
      where: { docketNumber: docket },
      data: { ...fields, lastSyncedAt: new Date() },
    });
    return { found: true, matchedDocket: docket };
  } catch (err: any) {
    // P2025 = record not found → try a case-insensitive (ILIKE) partial match.
    if (err?.code !== "P2025") throw err;
  }

  // 2) ILIKE fallback: only tokens that are exactly 5 digits are considered.
  const numeric = extractNumericDocket(docket);
  const tokens = Array.from(
    new Set(
      [docket, numeric].filter(
        (t): t is string => !!t && /^\d{5}$/.test(t)
      )
    )
  );
  for (const token of tokens) {
    const rec = await prisma.smartsheetTender.findFirst({
      where: { docketNumber: { contains: token, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, docketNumber: true },
    });
    if (rec) {
      await prisma.smartsheetTender.update({
        where: { id: rec.id },
        data: { ...fields, lastSyncedAt: new Date() },
      });
      return { found: true, matchedDocket: rec.docketNumber ?? docket };
    }
  }

  return { found: false };
}

export async function POST(request: Request) {
  // Read the RAW body so the HMAC signature can be verified over the exact bytes.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { success: false, error: "Unable to read request body" },
      { status: 400 }
    );
  }

  if (!verifySignature(request, rawBody)) {
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { success: false, error: "Expected a webhook envelope object" },
      { status: 400 }
    );
  }

  const body = payload as Record<string, any>;
  const event = typeof body.event === "string" ? body.event : "";
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const referenceNo = String(data.referenceNo || "").trim();

  try {
    // file.parsed_success → map result and save.
    if (event.endsWith("_success")) {
      if (!referenceNo) {
        return NextResponse.json(
          { ok: true, skipped: true, message: "No referenceNo" },
          { status: 200 }
        );
      }

      const fields = mapAutomationV2Result(data.result);
      const hasFields = Object.values(fields).some(
        (v) => v !== null && v !== undefined
      );
      if (!hasFields) {
        return NextResponse.json(
          { ok: true, updated: false, message: "No costing fields to update" },
          { status: 200 }
        );
      }

      console.log(
        `[CostingParsed] file.parsed_success docket ${referenceNo} with fields:`,
        fields
      );

      const result = await updateByDocket(referenceNo, fields);
      if (!result.found) {
        return NextResponse.json(
          { ok: true, updated: false, notFound: referenceNo },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          ok: true,
          updated: true,
          docketNumber: referenceNo,
          matchedDocket: result.matchedDocket,
        },
        { status: 200 }
      );
    }

    // file.parsed_failed → log the error, no DB write.
    if (event.endsWith("_failed")) {
      console.error(
        `[CostingParsed] file.parsed_failed referenceNo=${referenceNo || "-"} event=${event} error=${String(
          data.error ?? "unknown"
        )}`
      );
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Unknown / unrelated event.
    console.warn(`[CostingParsed] Ignoring unrecognized event ${event}`);
    return NextResponse.json(
      { ok: true, ignored: true, event },
      { status: 200 }
    );
  } catch (err) {
    console.error(
      `[CostingParsed] Error for event ${event} docket "${referenceNo}":`,
      err
    );
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unexpected server error",
        retryable: true,
      },
      { status: 500 }
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   OLD FLOW (rollback only) — worker POSTed { docketNo, ...fields } and the
   route mapped with mapRecord(). Kept commented out; the automation-v2
   webhook envelope above replaces it. Uncomment to restore.

import { mapRecord } from "@/lib/costingMapping.mjs";
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

// POST:
//   const expected = getWorkerKey();
//   const provided = extractAuthKey(request);
//   if (!expected || !provided || provided !== expected) { 401 }
//   const record = body as Record<string, unknown>;
//   const docket = typeof record.docketNo === "string" ? record.docketNo.trim() : "";
//   const fields = mapRecord(record);
//   ... exact update -> ILIKE fallback (see updateByDocket) ...
//   return { success, updated, notFound, docketNumber }
   ══════════════════════════════════════════════════════════════════════════ */