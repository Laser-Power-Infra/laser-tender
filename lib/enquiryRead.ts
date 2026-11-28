// Reads for the dashboard from the enquiry-platform tables. Smartsheet-sourced fields come from `enquiry`,
// app-owned fields stay in "SmartsheetTender" (joined by docket).
import { type Db, type SheetKind, loadColumns } from "../sync/lib";

const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

// Same normalisation the legacy sync applies before storing: trimmed, empty -> null.
const txt = (col: string) => `NULLIF(btrim(${col}), '')`;
// The legacy sync stores Smartsheet dates as 'YYYY-MM-DD' strings.
const day = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
// Fields users edit in the app: their SmartsheetTender value wins when present.
const edited = (tCol: string, eCol: string) => `COALESCE(NULLIF(btrim(t."${tCol}"), ''), ${txt(eCol)})`;

const APP_OWNED = [
  "createdAt", "updatedAt", "allocatedTo", "status", "reverseAuctionApplicable", "cvaValue", "attachmentUrl",
  "proposedErpItemName", "proposedQty", "priceBasis", "aluminiumPrice", "aluminiumAlloyPrice", "copperTapePrice",
  "extrudedSemiconductivePrice", "htXlpePrice", "pvcTypeSt2Price", "galvanisedSteelFlatStripPrice", "fillerPrice",
  "contractNo", "LostStillScope", "costingScanAttemptedAt", "lastSyncedAt",
];

const TENDERS_SQL = `
  SELECT COALESCE(t.id, btrim(e.docket_no)) AS id,
         btrim(e.docket_no)            AS "docketNumber",
         ${day("e.enquiry_date")}      AS "enquiryDate",
         ${txt("e.party_name")}        AS "partyName",
         ${txt("e.utility")}           AS "utility",
         ${txt("e.quotation_no")}      AS "quotationNumber",
         ${day("e.quotation_date")}    AS "quotationDate",
         ${txt("e.account_holder")}    AS "accountHolder",
         ${txt("e.enquiry_category")}  AS "tenderPurchase",
         ${edited("emailId", "e.enquiry_from_email")}     AS "emailId",
         ${edited("emailSubjectLine", "e.email_subject")} AS "emailSubjectLine",
         ${edited("contactNo", "e.enquiry_contact_no")}   AS "contactNo",
         ${APP_OWNED.map((c) => `t."${c}"`).join(", ")}
    FROM enquiry e
    LEFT JOIN "SmartsheetTender" t ON t."docketNumber" = btrim(e.docket_no)
   WHERE e.deleted_at IS NULL
   ORDER BY t."createdAt" DESC NULLS FIRST, e.docket_no DESC`;

/** Dashboard rows in the legacy SmartsheetTender shape. null = the enquiry table is not deployed yet. */
export async function readEnquiryTenders(db: Db): Promise<any[] | null> {
  try {
    return (await db.query(TENDERS_SQL)).rows;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export interface LabelValue { label: string; value: string }
export interface EnquiryDetail { enquiry: LabelValue[]; items: LabelValue[][] }

// Row arrives as jsonb, so dates are already 'YYYY-MM-DD' strings. Unticked checkboxes count as empty.
function labelled(kind: SheetKind, row: Record<string, unknown>): LabelValue[] {
  return loadColumns()[kind].flatMap((c) => {
    const v = row[c.db_column];
    if (v === null || v === undefined || v === false || String(v).trim() === "") return [];
    return [{ label: c.smartsheet_title.replace(/\s+/g, " ").trim(), value: v === true ? "Yes" : String(v) }];
  });
}

/** Every non-empty Smartsheet column of one docket plus its items. Empty when the tables are not deployed yet. */
export async function readEnquiryDetail(db: Db, docketNumber: string): Promise<EnquiryDetail> {
  try {
    const docket = docketNumber.trim();
    const e = await db.query(`SELECT to_jsonb(e) AS j FROM enquiry e WHERE btrim(e.docket_no) = $1 AND e.deleted_at IS NULL`, [docket]);
    const i = await db.query(`SELECT to_jsonb(i) AS j FROM enquiry_item i WHERE btrim(i.docket_no) = $1 AND i.deleted_at IS NULL ORDER BY i.id`, [docket]);
    return {
      enquiry: e.rows[0] ? labelled("sales_enquiry", e.rows[0].j) : [],
      items: i.rows.map((r) => labelled("item_list", r.j)),
    };
  } catch (e) {
    if (isMissingTable(e)) return { enquiry: [], items: [] };
    throw e;
  }
}

export const NEW_ENQUIRY_COLS = ["Docket", "Party", "Enquiry date", "Subject", "Status", "Created by", "Created", "Smartsheet"];

/** Enquiries created in the dashboard, newest first (guideline 27 Nov 2026, section 3.2). One row = one value per NEW_ENQUIRY_COLS. */
export async function readNewEnquiries(db: Db): Promise<string[][]> {
  try {
    // shortcut: newest 500 only, the list is for recent and pending work; page it in SQL if older ones are needed here.
    const r = await db.query(`SELECT docket_no, party_name, to_char(enquiry_date, 'DD-Mon-YYYY') AS d, email_subject, enquiry_status, created_by,
        to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') AS c,
        CASE WHEN docket_no LIKE 'PENDING-%' THEN 'Not mirrored (temporary docket)' WHEN mirrored_at IS NULL THEN 'Not mirrored'
             ELSE 'Mirrored ' || to_char(mirrored_at AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') END AS s
      FROM enquiry WHERE master = 'dashboard' AND deleted_at IS NULL ORDER BY created_at DESC, docket_no DESC LIMIT 500`);
    return r.rows.map((x) => [x.docket_no, x.party_name, x.d, x.email_subject, x.enquiry_status, x.created_by, x.c, x.s].map((v) => v ?? ""));
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}
