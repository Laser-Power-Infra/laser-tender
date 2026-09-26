import { NextResponse } from "next/server";
import { refreshCostingData } from "@/lib/costing";

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

  try {
    const result = await refreshCostingData();
    return NextResponse.json({
      success: true,
      matched: result.matchedCount,
      total: result.totalCount,
    });
  } catch (err) {
    console.error("[CostingRefresh] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}