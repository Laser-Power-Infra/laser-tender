"use server";

import { pool } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { Db } from "@/sync/lib";
import { addItem, createEnquiry, picklistOptions, updateEnquiry, updateItem, type Values } from "@/lib/enquiryWrite";

export interface EnquiryWriteResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function fail(err: unknown): EnquiryWriteResponse<never> {
  if ((err as { code?: string })?.code === "42P01") return { success: false, error: "The enquiry tables are not deployed in this database yet." };
  const error = err instanceof Error ? err.message : "An unexpected server error occurred.";
  if (error !== "Sign in required") console.error("[EnquiryWrite] Error:", err);
  return { success: false, error };
}

// Signed-in users only. One client for the whole call: BEGIN/COMMIT on the pool itself could land on different connections.
async function write<T>(fn: (db: Db, actor: string) => Promise<T>): Promise<EnquiryWriteResponse<T>> {
  try {
    const user = await requireUser();
    const client = await pool.connect();
    try {
      return { success: true, data: await fn(client, user.email) };
    } finally {
      client.release();
    }
  } catch (err) {
    return fail(err);
  }
}

export async function createEnquiryAction(values: Values) {
  return write((db, actor) => createEnquiry(db, values, actor));
}

export async function updateEnquiryAction(docketNo: string, values: Values) {
  return write((db, actor) => updateEnquiry(db, docketNo, values, actor));
}

export async function addItemAction(docketNo: string, values: Values) {
  return write((db, actor) => addItem(db, docketNo, values, actor));
}

export async function updateItemAction(id: string, values: Values) {
  return write((db, actor) => updateItem(db, id, values, actor));
}

/** Public, read-only: dropdown values for the form (keys from formFields().picklist). */
export async function getPicklistOptions(keys: string[]): Promise<EnquiryWriteResponse<Record<string, string[]>>> {
  try {
    return { success: true, data: await picklistOptions(pool, Array.isArray(keys) ? keys.map(String) : []) };
  } catch (err) {
    return fail(err);
  }
}
