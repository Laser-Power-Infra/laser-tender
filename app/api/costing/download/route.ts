import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readCostingFile, COST_PREFIX_STR } from "@/services/costingFileFinder.mjs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const docket = (searchParams.get("docket") || "").trim();

  if (!docket) {
    return NextResponse.json({ error: "Missing docket parameter" }, { status: 400 });
  }

  let record;
  try {
    record = await prisma.smartsheetTender.findUnique({
      where: { docketNumber: docket },
      select: { attachmentUrl: true },
    });
  } catch (err) {
    console.error("[CostingDownload] DB lookup failed:", err);
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }

  const attachmentUrl = (record?.attachmentUrl || "").trim();
  if (!attachmentUrl.startsWith(COST_PREFIX_STR)) {
    return NextResponse.json({ error: "No costing file available for this docket" }, { status: 404 });
  }

  const file = readCostingFile(attachmentUrl);
  if (!file) {
    return NextResponse.json({ error: "Costing file could not be read from the network path" }, { status: 500 });
  }

  const encodedFileName = encodeURIComponent(file.fileName);
  return new NextResponse(file.buffer, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
      "Cache-Control": "no-store",
      "Content-Length": String(file.buffer.byteLength),
    },
  });
}