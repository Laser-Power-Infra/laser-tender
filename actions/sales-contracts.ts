"use server";

import { prisma } from "@/lib/prisma";
import { syncSalesContracts } from "@/services/salesContractSyncService";

interface SyncResult {
  inserted: number;
  skipped: number;
  total: number;
}

export interface SalesContractActionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  result?: SyncResult | null;
}

export async function getSalesContracts(): Promise<SalesContractActionResponse> {
  try {
    if (!prisma) {
      return { success: false, data: [], error: "Database not available" };
    }
    const data = await prisma.salesContract.findMany({
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data };
  } catch (err) {
    console.error("[SalesContractAPI] Error:", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

export async function syncSalesContractsAction(): Promise<SalesContractActionResponse> {
  try {
    const result = await syncSalesContracts();
    return { success: true, result };
  } catch (err) {
    console.error("[SalesContractSync] Error:", err);
    return {
      success: false,
      result: null,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}
