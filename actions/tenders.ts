"use server";

import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";

export interface TenderActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  summary?: { matched: number; total: number };
  updatedCount?: number;
  scanSummary?: { scanned: number; matched: number; notFound: number; total: number; remaining: number };
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
      Number(process.env.COSTING_SCAN_LIMIT )
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
