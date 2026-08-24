import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";

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
    emailId: "Enquiry fro Email Id (debosmita nath)",
    emailSubjectLine: "email subject line (debosmita nath)",
  };

  const getCellValue = (cells: { columnId?: number; value?: unknown; displayValue?: unknown }[], columnId: number | undefined): string | null => {
    if (columnId === undefined) return null;
    const cell = cells.find((c) => c.columnId === columnId);
    if (!cell) return null;
    if (cell.displayValue !== undefined && cell.displayValue !== null) return String(cell.displayValue).trim() || null;
    if (cell.value !== undefined && cell.value !== null) return String(cell.value).trim() || null;
    return null;
  };

  const records: SmartsheetRecord[] = rows.map((row) => {
    const cells = row.cells || [];
    const get = (field: string): string | null => getCellValue(cells, columnIndex.get(COLUMN_MAP[field]));
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
    };
  });

  return { records, totalRows: rows.length };
}

let syncPromise: Promise<unknown> | null = null;

export async function syncSmartsheetToDb(): Promise<unknown> {
  if (syncPromise) return syncPromise;
  if (!process.env.SMARTSHEET_API_TOKEN || !process.env.SMARTSHEET_SHEET_ID) {
    console.warn("[SmartsheetSync] SMARTSHEET_API_TOKEN or SMARTSHEET_SHEET_ID not set, skipping sync");
    return;
  }
  syncPromise = (async () => {
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
      syncPromise = null;
    }
  })();
  return syncPromise;
}
