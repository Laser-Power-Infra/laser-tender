"use server";

import { refreshCostingData } from "@/lib/costing";
import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";
import { decryptStoredPath, isPlainUrl } from "@/services/costingFileFinder.mjs";
import { publishTenderParsingTask } from "@/lib/tenderQueue";
import { syncSmartsheetToDb } from "@/lib/smartsheet-sync";

export interface TenderActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  summary?: { matched: number; total: number };
  updatedCount?: number;
  scanSummary?: { scanned: number; matched: number; notFound: number; total: number; remaining: number };
  queueSummary?: { total: number; published: number; failed: number };
}

export async function getSmartsheetTenders(): Promise<TenderActionResponse> {
  try {
    const data = await DatabaseSmartsheetService.getAllSmartsheetTenders();
    return { success: true, data };
  } catch (err) {
    console.error("[SmartsheetAPI] Error:", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

export async function syncSmartsheetData(): Promise<TenderActionResponse> {
  try {
    const result: any = await syncSmartsheetToDb();
    // syncSmartsheetToDb returns {inserted, updated, skipped} or undefined on skip
    if (result && typeof result.inserted === "number") {
      return { success: true, data: result, summary: { matched: result.updated + result.inserted, total: result.inserted + result.updated + result.skipped } as any };
    }
    return { success: true, data: result };
  } catch (err) {
    console.error("[SyncSmartsheet] Error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to sync Smartsheet data." };
  }
}

export async function refreshCosting(): Promise<TenderActionResponse> {
  try {
    const result = await refreshCostingData();
    return {
      success: true,
      data: result.data,
      summary: { matched: result.matchedCount, total: result.totalCount },
    };
  } catch (err) {
    console.error("[CostingRefresh] Error:", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "Failed to refresh costing data.",
    };
  }
}

export async function scanCostingFiles(): Promise<TenderActionResponse> {
  try {
    const result = (await DatabaseSmartsheetService.scanAndUpdateCostingFiles(
      Number(process.env.COSTING_SCAN_LIMIT || 100)
    )) as {
      success: boolean;
      error?: string;
      scanned: number;
      matched: number;
      notFound: number;
      total: number;
      remaining: number;
    };
    if (!result.success) {
      return { success: false, data: [], error: result.error || "Failed to scan costing files." };
    }
    const data = await DatabaseSmartsheetService.getAllSmartsheetTenders();
    return {
      success: true,
      data,
      scanSummary: {
        scanned: result.scanned,
        matched: result.matched,
        notFound: result.notFound,
        total: result.total,
        remaining: result.remaining,
      },
    };
  } catch (err) {
    console.error("[CostingFileScan] Error:", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "Failed to scan costing files.",
    };
  }
}

export async function updateTenderAllocatedTo(
  docketNumber: string,
  allocatedTo: string | null
): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderAllocatedTo(docketNumber, allocatedTo ?? null);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function updateTenderStatus(docketNumber: string, status: string | null): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderStatus(docketNumber, status ?? null);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function updateTenderReverseAuction(docketNumber: string, value: string): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderReverseAuction(docketNumber, value);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function batchUpdateAllocatedTo(
  docketNumbers: string[],
  allocatedTo: string | null
): Promise<TenderActionResponse> {
  try {
    if (!Array.isArray(docketNumbers) || docketNumbers.length === 0) {
      return { success: false, error: "docketNumbers must be a non-empty array" };
    }
    const result = await DatabaseSmartsheetService.batchUpdateSmartsheetTenderAllocatedTo(
      docketNumbers,
      allocatedTo ?? null
    );
    if (!result.success) return { success: false, error: result.error || "Update failed" };
    return { success: true, updatedCount: result.updatedCount };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function updateTenderContactNo(
  docketNumber: string,
  contactNo: string | null
): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderContactNo(docketNumber, contactNo ?? null);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function updateTenderEmailId(
  docketNumber: string,
  emailId: string | null
): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderEmailId(docketNumber, emailId ?? null);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function updateTenderEmailSubjectLine(
  docketNumber: string,
  emailSubjectLine: string | null
): Promise<TenderActionResponse> {
  try {
    const result = await DatabaseSmartsheetService.updateSmartsheetTenderEmailSubjectLine(docketNumber, emailSubjectLine ?? null);
    if (!result.success) return { success: false, error: result.error || "Record not found" };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

export async function pushCostingToQueue(): Promise<TenderActionResponse> {
  try {
    const tenders = await DatabaseSmartsheetService.getAllSmartsheetTenders();

    let published = 0;
    let failed = 0;
    const total = tenders.filter((t) => {
      const url = (t.attachmentUrl || "").trim();
      return url && url !== "-";
    }).length;

    for (const tender of tenders) {
      const stored = (tender.attachmentUrl || "").trim();
      if (!stored || stored === "-") continue;

      let fileLink: string | null = null;
      let fileType: "network" | "external" = "network";
      if (isPlainUrl(stored)) {
        // Drive / AppSheet plain URL — used as-is.
        fileLink = stored;
        fileType = "external";
      } else {
        const decrypted = decryptStoredPath(stored);
        if (decrypted) {
          // Network path — decrypted relative path ("network|...").
          fileLink = decrypted;
          fileType = "network";
        }
      }

      if (!fileLink) continue;

      const payload = {
        type: "COSTING_ATTACHMENT_PARSING" as const,
        referenceNo: tender.docketNumber || "",
        file_link: fileLink,
        decrypted_fileId: fileLink,
        file_type: fileType,
        sender: "laser_cost" as const,
        timestamp: Date.now(),
      };

      // Testing only — just log the payload; publish is commented out.
      console.log("[QueuePush]", JSON.stringify(payload));

      const sent = await publishTenderParsingTask(payload);
      if (sent) published++; else failed++;
    }

    return {
      success: true,
      data: tenders,
      queueSummary: { total, published, failed },
    };
  } catch (err) {
    console.error("[QueuePush] Error:", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "Failed to push costing to queue.",
    };
  }
}
