import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { pool } from "@/lib/prisma";
import { certificatePath, typeTestRoot } from "@/lib/typeTestFiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

// Opens a type test certificate from the office file server, the way tender-executive-dashboard shows its network files:
// the folder is mounted on the server, and the file is streamed inline. Open like the Type test page itself (no sign-in),
// but the caller names a ledger row, never a path: the path comes from the ledger as loaded by sync/type_test_ledger.ts.
export async function GET(request: Request) {
  const row = new URL(request.url).searchParams.get("row") ?? "";
  if (!/^\d{1,9}$/.test(row)) return NextResponse.json({ error: "Invalid row" }, { status: 400 });

  let rel: string | undefined;
  try {
    rel = (await pool.query(
      `SELECT data->>'Certificate file' AS rel FROM sheet_snapshot WHERE sheet_key = 'TYPE_TEST_LEDGER' AND tab_name = 'TTR JIST' AND row_no = $1`, [Number(row)],
    )).rows[0]?.rel;
  } catch (err) {
    console.error("[TypeTestFile] DB lookup failed:", err);
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }
  const full = rel ? certificatePath(typeTestRoot(), rel) : null;
  if (!full) return NextResponse.json({ error: "No certificate file is linked to this row" }, { status: 404 });

  let size: number;
  try {
    const stats = await fs.promises.stat(full);
    if (!stats.isFile()) throw new Error("not a file");
    size = stats.size;
  } catch (err) {
    console.warn(`[TypeTestFile] Cannot read "${full}": ${err instanceof Error ? err.message : err}`);
    return NextResponse.json({ error: "The certificate file could not be read from the office server. It may have been moved or renamed, or the server folder is not connected." }, { status: 404 });
  }
  return new NextResponse(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream",
      // inline: a PDF opens in the browser tab
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
