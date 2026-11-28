import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { readCostingRuns, DRAFT_BANNER } from "@/lib/costingRun";

export const dynamic = "force-dynamic";

const n = (v: string | null) => (v == null ? "" : Number(v));

// Plain workbook of one draft run (SUMMARY / ITEM COSTING / RM DETAIL). NOT Touhid's template.
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  // costing sheets are restricted documents: signed-in users only
  if (!(await getSessionUser())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { runId } = await params;
  if (!/^\d+$/.test(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

  let run;
  try {
    [run] = await readCostingRuns(pool, "id", runId);
  } catch (err) {
    console.error("[CostingRunXlsx] DB lookup failed:", err);
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }
  if (!run) return NextResponse.json({ error: "Costing run not found" }, { status: 404 });

  const summary = [
    [DRAFT_BANNER],
    ["Note", "Plain export of the draft run. This is NOT Touhid's costing template (ENQ-21846-25-26 format) and has no live formulas."],
    ["Docket", run.docket_no], ["Revision", run.revision], ["Status", run.status],
    ["RM rate policy", run.rm_rate_policy], ["RM base date", run.rm_base_date ?? ""],
    ["Created by", run.created_by ?? ""], ["Created at", run.created_at],
    [],
    ["Item", "Warning"],
    ...run.items.flatMap(it => it.warnings.map(w => [it.it_code, w])),
  ];
  const items = [
    ["Item", "ERP item", "Qty", "Unit", "BOM ID", "BOM note", "RM cost", "Drum cost", "Freight", "Ex-works", "Price ex GST", "GST", "Price incl GST", "Warnings"],
    ...run.items.map(it => [it.it_code, it.erp_item ?? "", n(it.qty), it.unit ?? "", it.bom_id ?? "", it.bom_match_note ?? "",
      n(it.rm_cost), n(it.drum_cost), n(it.freight), n(it.ex_works), n(it.price_ex_gst), n(it.gst), n(it.price_incl_gst), it.warnings.join(" | ")]),
  ];
  const rm = [
    ["Item", "RM", "Consumption", "Unit", "Rate", "Rate date", "Amount", "Consumption source", "Source ref", "Formula"],
    ...run.items.flatMap(it => it.rm.map(r => [it.it_code, r.rm_name, n(r.consumption), r.unit ?? "", n(r.rate), r.rate_date ?? "", n(r.amount),
      r.consumption_source, r.source_ref ?? "", r.formula ?? ""])),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "SUMMARY");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(items), "ITEM COSTING");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rm), "RM DETAIL");
  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fileName = `${run.docket_no}_Costing_DRAFT_rev${run.revision}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
