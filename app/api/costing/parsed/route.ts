import { NextResponse } from "next/server";
import { mapRecord } from "@/lib/costingMapping.mjs";
import { extractNumericDocket } from "@/services/costingFileFinder.mjs";
import { prisma } from "@/lib/prisma";

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

export async function POST(request: Request) {
  const expected = getWorkerKey();
  const provided = extractAuthKey(request);

  if (!expected || !provided || provided !== expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: "Expected a single record object" },
      { status: 400 }
    );
  }

  try {
    const record = body as Record<string, unknown>;

    const docket = typeof record.docketNo === "string" ? record.docketNo.trim() : "";
    if (!docket) {
      return NextResponse.json(
        { success: false, error: "docketNo is required" },
        { status: 400 }
      );
    }

    const fields = mapRecord(record);
    const hasFields = Object.values(fields).some(
      (v) => v !== null && v !== undefined
    );
    if (!hasFields) {
      return NextResponse.json(
        { success: true, updated: 0, skipped: 1, notFound: [], message: "No costing fields to update" },
        { status: 200 }
      );
    }

console.log(`[CostingParsed] Updating docket ${docket} with fields:`, fields);

    // 1) Exact match on the full docket number.
    let result: { success: boolean; found: boolean; error?: string; docketNumber?: string };
    try {
      await prisma.smartsheetTender.update({
        where: { docketNumber: docket },
        data: { ...fields, lastSyncedAt: new Date() },
      });
      result = { success: true, found: true, docketNumber: docket };
    } catch (err: any) {
      // P2025 = record not found → try a case-insensitive (ILIKE) partial match.
      if (err?.code !== "P2025") {
        throw err;
      }

      // 2) ILIKE fallback: the worker often sends only the middle number
      //    (e.g. "18888-25-26" or "18884") instead of the full "ENQ-18888-25-26".
      const tokens = [docket];
      const numeric = extractNumericDocket(docket);
      if (numeric && numeric !== docket) tokens.push(numeric);

      let matched: { id: string; docketNumber: string | null } | null = null;
      for (const token of tokens) {
        const rec = await prisma.smartsheetTender.findFirst({
          where: { docketNumber: { contains: token, mode: "insensitive" } },
          orderBy: { createdAt: "desc" },
          select: { id: true, docketNumber: true },
        });
        if (rec) {
          matched = rec;
          break;
        }
      }

      if (!matched) {
        result = { success: false, found: false, error: "Record not found" };
      } else {
        await prisma.smartsheetTender.update({
          where: { id: matched.id },
          data: { ...fields, lastSyncedAt: new Date() },
        });
        console.log(
          `[CostingParsed] Docket "${docket}" matched via ILIKE to "${matched.docketNumber}"`
        );
        result = { success: true, found: true, docketNumber: matched.docketNumber ?? docket };
      }
    }
    if (result.success && result.found) {
      return NextResponse.json(
        { success: true, updated: 1, skipped: 0, notFound: [], docketNumber: docket },
        { status: 200 }
      );
    }
    if (!result.found) {
      return NextResponse.json(
        { success: false, updated: 0, skipped: 0, notFound: [docket], docketNumber: docket },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, updated: 0, skipped: 1, notFound: [], error: result.error },
      { status: 200 }
    );
  } catch (err) {
    console.error("[CostingParsed] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unexpected server error" },
      { status: 500 }
    );
  }
}
