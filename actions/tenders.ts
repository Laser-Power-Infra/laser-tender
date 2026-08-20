"use server";

import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";

export interface TenderActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  summary?: { matched: number; total: number };
  updatedCount?: number;
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
