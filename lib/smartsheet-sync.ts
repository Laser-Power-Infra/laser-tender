import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";
import { pool } from "@/lib/prisma";
import { runSmartsheetSync } from "@/sync/smartsheet_sync";
import { istToday, reconcileMailEnquiries } from "@/lib/mailIngest";

export interface SmartsheetRecord {
  enquiryDate: string | null;
  partyName: string | null;
  docketNumber: string | null;
  utility: string | null;
  quotationNumber: string | null;
  quotationDate: string | null;
  accountHolder: string | null;
  tenderPurchase: string | null;
  emailId: string | null;
  emailSubjectLine: string | null;
  contactNo: string | null;
}

async function fetchSmartsheetData(): Promise<{
  records: SmartsheetRecord[];
  totalRows: number;
}> {
  const token = process.env.SMARTSHEET_API_TOKEN;
  const sheetId = process.env.SMARTSHEET_SHEET_ID;
  if (!token || !sheetId) return { records: [], totalRows: 0 };

  const url = `https://api.smartsheet.com/2.0/sheets/${sheetId.trim()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Smartsheet API error (${response.status})`);

  const sheetData = await response.json();
  const columns: { title?: string; id?: number }[] = sheetData.columns || [];
  const rows: { cells?: { columnId?: number; value?: unknown; displayValue?: unknown }[] }[] =
    sheetData.rows || [];

  const columnIndex = new Map<string, number>();
  for (const col of columns) {
    if (col.title) columnIndex.set(col.title.trim(), col.id!);
  }

  const COLUMN_MAP: Record<string, string> = {
    enquiryDate: "Enquiry Date(MM-DD-YY)  (Debosmita Nath)",
    partyName: "Party Name  (Debosmita Nath)",
    docketNumber: "Docket No  (Debosmita Nath)",
    utility: "Utility (Marketing Team)",
    quotationNumber: "Quotation No. (Dipankar)",
    quotationDate: "Quotation DateFORMAT(MM-DD-YY) (Dipankar)",
    accountHolder: "Account Holder",
    tenderPurchase: "Tender/ Purchase/Bugetary/ Laser Tender (Marketing",
    emailId: "Enquiry from Email id  (Debosmita Nath)",
    emailSubjectLine: "Email Subject Line  (Debosmita Nath)",
    contactNo: "Enquiry From Contact No.",
  };

  const getCellValue = (cells: { columnId?: number; value?: unknown; displayValue?: unknown }[], columnId: number | undefined): string | null => {
    if (columnId === undefined) return null;
    const cell = cells.find((c) => c.columnId === columnId);
    if (!cell) return null;
    if (cell.displayValue !== undefined && cell.displayValue !== null) return String(cell.displayValue).trim() || null;
    if (cell.value !== undefined && cell.value !== null) return String(cell.value).trim() || null;
    return null;
  };

  // Normalized lookup for resilience to spaces/casing
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const columnIndexNorm = new Map<string, number>();
  for (const [k, v] of columnIndex.entries()) columnIndexNorm.set(norm(k), v);

  const records: SmartsheetRecord[] = rows.map((row) => {
    const cells = row.cells || [];
    const get = (field: string): string | null => getCellValue(cells, columnIndexNorm.get(norm(COLUMN_MAP[field])));
    return {
      enquiryDate: get("enquiryDate"),
      partyName: get("partyName"),
      docketNumber: get("docketNumber"),
      utility: get("utility"),
      quotationNumber: get("quotationNumber"),
      quotationDate: get("quotationDate"),
      accountHolder: get("accountHolder"),
      tenderPurchase: get("tenderPurchase"),
      emailId: get("emailId"),
      emailSubjectLine: get("emailSubjectLine"),
      contactNo: get("contactNo"),
    };
  });

  return { records, totalRows: rows.length };
}

// Also fills the enquiry / enquiry_item tables. Never throws: the legacy sync result must not depend on it.
async function syncEnquiryTables(full: boolean): Promise<void> {
  try {
    // One dedicated connection: the sync wraps each sheet in BEGIN/COMMIT, which on the shared pool
    // would land on different connections and leave one stuck inside an open transaction.
    const client = await pool.connect();
    try {
      await runSmartsheetSync(client, process.env.SMARTSHEET_API_TOKEN!.trim(), 'all', { full });
      // an enquiry the dashboard created from mail may now have been entered in Smartsheet by the team: retire the duplicate
      const late = await reconcileMailEnquiries(client, istToday());
      if (late.retired.length || late.flagged.length) console.log("[MailIngest] late duplicates:", JSON.stringify(late));
    } finally {
      client.release();
    }
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") {
      console.warn("[SmartsheetSync] Enquiry tables not found (migration not deployed yet) — skipped enquiry sync");
    } else {
      console.error("[SmartsheetSync] Enquiry sync failed:", err instanceof Error ? err.message : err);
    }
  }
}

// Kept on globalThis because Next can bundle this file separately for server actions
// and for API routes (the scheduled daily job); a module-level variable would not be
// shared, so a button click during a scheduled run would start a second sync.
const globalForSync = globalThis as unknown as {
  smartsheetSyncPromise?: Promise<unknown> | null;
};

/** `full`: re-read every row of the enquiry and item sheets instead of only the rows Smartsheet reports as modified (the daily job does this). */
export async function syncSmartsheetToDb(opts: { full?: boolean } = {}): Promise<unknown> {
  if (globalForSync.smartsheetSyncPromise) return globalForSync.smartsheetSyncPromise;
  if (!process.env.SMARTSHEET_API_TOKEN || !process.env.SMARTSHEET_SHEET_ID) {
    console.warn("[SmartsheetSync] SMARTSHEET_API_TOKEN or SMARTSHEET_SHEET_ID not set, skipping sync");
    return;
  }
  const run = (async () => {
    try {
      console.log("[SmartsheetSync] Fetching latest data from Smartsheet API...");
      const { records, totalRows } = await fetchSmartsheetData();

      console.log(`[SmartsheetSync] API returned ${totalRows} total rows`);
      const withDocket = records.filter((r) => r.docketNumber && r.docketNumber.trim() !== "");
      console.log(
        `[SmartsheetSync] ${withDocket.length} have docket numbers (sample: ${withDocket
          .slice(0, 3)
          .map((r) => r.docketNumber)
          .join(", ")})`
      );
      if (withDocket.length === 0) {
        console.warn("[SmartsheetSync] No records with docket number found, nothing to sync");
        return;
      }
      const result = await DatabaseSmartsheetService.bulkUpsertSmartsheetTenders(records);
      console.log(`[SmartsheetSync] ✓ ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`);
      return result;
    } catch (err) {
      console.error("[SmartsheetSync] Sync failed:", err instanceof Error ? err.message : err);
    } finally {
      await syncEnquiryTables(!!opts.full);
      globalForSync.smartsheetSyncPromise = null;
    }
  })();
  globalForSync.smartsheetSyncPromise = run;
  return run;
}
