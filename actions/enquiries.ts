"use server";

import { pool } from "@/lib/prisma";
import { readEnquiryDetail, type EnquiryDetail } from "@/lib/enquiryRead";

export async function getEnquiryDetail(docketNumber: string): Promise<EnquiryDetail> {
  if (typeof docketNumber !== "string" || !docketNumber.trim()) return { enquiry: [], items: [] };
  try {
    return await readEnquiryDetail(pool, docketNumber);
  } catch (err) {
    console.error("[Enquiries] Detail read failed:", err instanceof Error ? err.message : err);
    return { enquiry: [], items: [] };
  }
}
