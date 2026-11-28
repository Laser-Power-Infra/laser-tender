// Read-only report queries replacing the Power BI pages (docs/enquiry-platform/POWERBI_PAGE_MAP.md; guideline 27 Nov 2026, section 5).
// Navigation labels and groups are in lib/pages.ts; every key here has a page there (checked by lib/reports.test.ts).
import type { Db } from '../sync/lib.ts';

// `from` says what the data was synced from, for the "last synced" line: 'smartsheet' or a sheet_snapshot sheet_key.
export type Report =
  // `link`: the cells of column `col` open the URL that the query returns in its (hidden) column `href`, when it has one
  | { label: string; cols: string[]; sql: string; order: string; note?: string; from?: string; link?: { col: string; href: string }; sourceNeeded?: undefined }
  | { label: string; sourceNeeded: string };

const pick = (cols: string[]) => cols.map(c => `data->>'${c}' AS "${c}"`).join(', ');

/** A report straight from one ERP dump tab of the TENDER DUMP Google Sheet (sheet_snapshot), newest first by `dateCol`. */
function dump(label: string, tab: string, dateCol: string, cols: string[], limit?: number): Report {
  const d = `data->>'${dateCol}'`;
  return {
    label, cols, from: 'TENDER_DUMP',
    note: limit ? `newest ${limit.toLocaleString('en-IN')} lines only` : undefined,
    // the dates are text like 21-dec-2018; anything else sorts last instead of failing the page
    sql: `SELECT row_no, CASE WHEN ${d} ~* '^[0-9]{1,2}-[a-z]{3}-[0-9]{4}$' THEN to_date(${d}, 'DD-Mon-YYYY') END AS d,
        ${pick(cols)}
      FROM sheet_snapshot WHERE sheet_key = 'TENDER_DUMP' AND tab_name = '${tab}'`,
    order: `d DESC NULLS LAST, row_no${limit ? ` LIMIT ${limit}` : ''}`,
  };
}

/** A report straight from one synced Google Sheet tab (sheet_snapshot), in sheet order. */
function snap(label: string, sheet: string, tab: string, cols: string[], note?: string, order = 'row_no'): Report {
  return { label, cols, note, from: sheet, order,
    sql: `SELECT row_no, ${pick(cols)} FROM sheet_snapshot WHERE sheet_key = '${sheet}' AND tab_name = '${tab}'` };
}

/** A page that exists but has no data source yet (guideline principle 3): Power BI table, best-guess source, who must provide it. */
const needed = (label: string, table: string, guess: string, who = 'Puja to supply the source'): Report =>
  ({ label, sourceNeeded: `Source needed: ${table} — ${guess} — ${who}` });

const TYPE_TEST_COLS = ['Sr No', 'Laboratory', 'Test Certificate No', 'Cable/Conductor Size', 'Type', 'Voltage Grade', 'Issued', 'Expire', 'Cerificate Available', 'ERP Code',
  'Item Name', 'Item Level 3 Name', 'File No', 'Hard copy'];

// Headers of the ITEM COSTING tab of the Claude costing sheet, as they are in the sheet.
const ITEM_COSTING_COLS = ['Item ID', 'ENQ Docket', 'Party', 'Utility', 'Quotation No', 'Party item name', 'ERP item', 'ERP code', 'Qty (km)', 'Category', 'Design basis (Claude)',
  'Touhid key', 'RM cost/km (Claude)', 'RM cost/km (Touhid)', 'RM kg/km total (Claude)', 'RM kg/km total (Touhid)', 'Drum/km (Claude - input)', 'Drum/km (Touhid)', 'Extra cons %',
  'MFG % (Claude)', 'MFG % (Touhid)', 'PROF % (Claude)', 'PROF % (Touhid)', '1st EXW/km (Claude)', '1st EXW/km (Touhid)', 'Intt % (Claude)', 'Intt % (Touhid)', 'Insp % (Claude)',
  'Insp % (Touhid)', 'TTR % (Claude)', 'TTR % (Touhid)', 'EXW/km (Claude)', 'EXW/km (Touhid)', 'Diff EXW/km (Claude - Touhid)', 'Diff %', 'Freight/km (Claude - input)',
  'Freight/km (Touhid)', 'Price incl freight/km (Claude)', 'GST %', 'Price incl GST & freight/km (Claude)', 'Price incl GST & freight/km (Touhid)', 'Total value (Claude)',
  'Total value (Touhid, at enquiry qty)'];
/** On the page the sheet's "Touhid" side is called "As per spec master" (asked 28 Nov 2026). */
const specMasterLabel = (header: string) => header.replace(/Touhid/g, 'As per spec master');

// Each query aliases its visible columns to the header text; `order` may use extra (hidden) columns.
export const REPORTS: Record<string, Report> = {
  items: {
    label: 'Item wise breakup',
    cols: ['Docket', 'Party', 'Utility', 'Party item name', 'Proposed ERP item', 'Qty', 'Unit', 'Quotation no.'],
    sql: `SELECT i.id, i.docket_no AS "Docket", e.party_name AS "Party", coalesce(nullif(btrim(i.utility), ''), e.utility) AS "Utility",
        i.party_item_name AS "Party item name", i.propose_erp_item AS "Proposed ERP item", i.qty::text AS "Qty", i.unit AS "Unit",
        coalesce(nullif(btrim(i.quotation_no), ''), e.quotation_no) AS "Quotation no."
      FROM enquiry_item i LEFT JOIN enquiry e ON e.docket_no = i.docket_no AND e.deleted_at IS NULL
      WHERE i.deleted_at IS NULL`,
    order: 'id DESC', from: 'smartsheet',
  },
  'no-erp-code': {
    label: 'No ERP code',
    cols: ['Docket', 'Party', 'Party item name', 'Proposed ERP item', 'Remarks of proposer', 'Comment of MD Sir', 'Qty', 'Unit'],
    sql: `SELECT i.id, i.docket_no AS "Docket", e.party_name AS "Party", i.party_item_name AS "Party item name", i.propose_erp_item AS "Proposed ERP item",
        i.remarks_of_proposer AS "Remarks of proposer", i.comment_of_md_no_erp_code AS "Comment of MD Sir", i.qty::text AS "Qty", i.unit AS "Unit"
      FROM enquiry_item i LEFT JOIN enquiry e ON e.docket_no = i.docket_no AND e.deleted_at IS NULL
      WHERE i.deleted_at IS NULL AND (coalesce(btrim(i.propose_erp_item), '') = '' OR i.propose_erp_item ILIKE '%NO ERP CODE%')`,
    order: 'id DESC', from: 'smartsheet',
  },
  quotations: {
    label: 'Quotation history',
    cols: ['Quotation no.', 'Quotation date', 'Docket', 'Party', 'Utility', 'Account holder'],
    sql: `SELECT quotation_date, quotation_no AS "Quotation no.", to_char(quotation_date, 'DD-Mon-YYYY') AS "Quotation date", docket_no AS "Docket",
        party_name AS "Party", utility AS "Utility", account_holder AS "Account holder"
      FROM enquiry WHERE deleted_at IS NULL AND coalesce(btrim(quotation_no), '') <> ''`,
    order: `quotation_date DESC NULLS LAST, "Docket" DESC`, from: 'smartsheet',
  },
  rates: {
    label: "Today's rate chart",
    // latest row per raw material and source tab: the tabs (DAILY RM RATES / DAILY MKT CP) carry different prices
    cols: ['Raw material', 'Rate', 'Unit', 'Rate date', 'Source tab'],
    sql: `SELECT DISTINCT ON (rm_name, source_tab) rm_name AS "Raw material", rate::text AS "Rate", rate_unit AS "Unit",
        to_char(rate_date, 'DD-Mon-YYYY') AS "Rate date", source_tab AS "Source tab"
      FROM rm_rate ORDER BY rm_name, source_tab, rate_date DESC`,
    order: `"Raw material", "Source tab"`, from: 'CIRCULARS',
  },
  // form responses are appended, so the highest row is the newest
  'approved-gtp': snap('Pre-approved GTP', 'PRE_APPROVED_GTP', 'Pree approved GTP',
    ['ITEM CODE', 'Item Name', 'Utility', 'STATE', 'Country', 'Project schem', 'APPROVAL STATUS', 'STATUS', 'Attachment Type', 'Contract Number', 'GTP ATTACHMENT', 'Timestamp'],
    undefined, 'row_no DESC'),
  'erp-tenders': dump('ERP tenders', 'TENDER DUMP', 'VRDATE',
    ['VRNO', 'VRDATE', 'UTILITY NAME', 'CUSTOMER NAME', 'TENDER DESC', 'TENDER REFNO', 'TENDER TYPE NAME', 'DUE DATE', 'BID SUBMITTED DATE', 'MIN QTN AMT (LAKHS)', 'MAX QTN AMT (LAKHS)']),
  // shortcut: every row goes to the browser table, so the 92,000-line quotation dump is cut to the newest 20,000; move filtering to SQL if older lines are needed.
  'erp-quotations': dump('ERP quotation lines', 'QTN DUMP', 'QUOTATION_DATE',
    ['QUOTATION_NO', 'QUOTATION_DATE', 'SLNO', 'TENDER_VRNO', 'ENQUIRY_NO', 'CLIENT', 'ITEM_CODE', 'ITEM_NAME', 'UM', 'QUOTATION_QTY', 'RATE', 'QUOTATION_VALUE', 'CONTRACT_NO', 'CONTRACT_QTY'], 20000),
  'erp-contracts': dump('ERP contract lines', 'CONT DUMP', 'CONTRACT_DATE',
    ['CONTRACT_NO', 'CONTRACT_DATE', 'CUSTOMER_CODE', 'PARTY_ORDER_NO', 'ITEM_CODE', 'ITEM_NAME', 'UM', 'RATE', 'CONTRACT_QTY', 'INVOICE_QTY', 'BALANCE', 'CONT_VALUE', 'QUOTATION_NO', 'FREIGHT_BASIS', 'TENDER_VRNO']),

  // ── Pages added for the 27 Nov 2026 guideline: every Power BI page exists, with data or a "Source needed" notice ──
  // The ITEM COSTING tab of the Claude costing sheet, newest item first. The sheet's "Touhid" columns are shown as "As per spec master".
  'auto-quotation': {
    label: 'Auto quotation',
    cols: ITEM_COSTING_COLS.map(specMasterLabel),
    note: 'item costing from the Claude costing sheet',
    sql: `SELECT row_no, ${ITEM_COSTING_COLS.map(c => `data->>'${c}' AS "${specMasterLabel(c)}"`).join(', ')}
      FROM sheet_snapshot WHERE sheet_key = 'CLAUDE_COSTINGS' AND tab_name = 'ITEM COSTING'`,
    order: 'row_no DESC', from: 'CLAUDE_COSTINGS',
  },
  'cost-sheet': {
    label: 'Cost calculation sheet',
    cols: ['Docket', 'Revision', 'Item', 'ERP item', 'Qty', 'Unit', 'BOM ID', 'RM cost', 'Drum cost', 'Freight', 'Ex-works', 'Price ex GST', 'GST', 'Price incl GST'],
    note: 'draft; freight is not costed yet',
    sql: `SELECT i.id, r.docket_no AS "Docket", r.revision::text AS "Revision", i.it_code AS "Item", i.erp_item AS "ERP item", i.qty::text AS "Qty", i.unit AS "Unit",
        i.bom_id AS "BOM ID", i.rm_cost::text AS "RM cost", i.drum_cost::text AS "Drum cost", i.freight::text AS "Freight", i.ex_works::text AS "Ex-works",
        i.price_ex_gst::text AS "Price ex GST", i.gst::text AS "GST", i.price_incl_gst::text AS "Price incl GST"
      FROM item_costing i JOIN costing_run r ON r.id = i.run_id`,
    order: 'id DESC',
  },
  'cost-tender-budgetary': needed('Cost calculation tender & budgetary', 'the Power BI tables behind page 22 are not identified', 'not found'),
  'quotation-review': {
    label: 'Quotation export and review',
    cols: ['Docket', 'Revision', 'Run status', 'Author', 'Comment', 'Date'],
    sql: `SELECT c.id, r.docket_no AS "Docket", r.revision::text AS "Revision", r.status::text AS "Run status", c.author AS "Author", c.comment AS "Comment",
        to_char(c.created_at, 'DD-Mon-YYYY') AS "Date"
      FROM costing_review c JOIN costing_run r ON r.id = c.run_id`,
    order: 'id DESC',
  },
  'bom-master': {
    label: 'BOM master',
    cols: ['BOM ID', 'ERP code', 'Raw material', 'Consumption', 'Unit'],
    sql: `SELECT bom_id AS "BOM ID", erp_code AS "ERP code", rm_name AS "Raw material", consumption::text AS "Consumption", unit AS "Unit" FROM non_chain_bom`,
    order: `"BOM ID", "Raw material"`, from: 'MASTER_BOM_ACTUAL',
  },
  'csd-master': needed('CSD master', 'CSD UPLOAD GRID', 'not found'),
  'bom-quad': needed('BOM master quad', 'BOM QUAD CABLES', 'not found'),
  'dd-master': snap('DD master', 'DRUM_INDENT', 'DRUM TYPE/STOCK', ['CODE', 'DRUM NAME', 'DRUM REQ', 'STOCK', 'FINAL DRUM REQ'],
    'drum standards from DRUM INDENT only; source still needed for DRUM_DRAWING_ATTACHMENT (drum drawings)'),
  'drums-per-truck': snap('Drums per truck master', 'CLAUDE_COSTINGS', 'DRUMS PER TRUCK MASTER',
    ['TRUCK_TYPE', 'DRUM_TYPE', 'DRUM_SIZE', 'MAX_DRUMS_PER_TRUCK', 'TYPICAL_DRUMS_PER_TRUCK', 'REQS_SEEN', 'MAX_SEEN_IN_REQ', 'FO_NOS', 'DRUMS_IN_REQ', 'TRUCKS_PLACED',
      'WT_PER_DRUM_KG', 'LOAD_AT_MAX_T', 'TRUCK_CAP_T', 'RAW_MAX_INCL_OVERLOAD', 'CHECK']),
  'item-master': snap('Item master', 'ITEM_MASTER', 'laser Item master',
    ['Item Code', 'Item Name', 'Proposed Item Name', 'Item Level 1 Name', 'Item Level 2 Name', 'Item Level 3 Name', 'Item Nature Name', 'Main UM']),
  'spec-master': snap('Specification master', 'SPEC_MASTER', 'Specification Master',
    ['ITEM SCHEDULE', 'PROPOSE ERP ITEM NAME @ CODE', 'Utility', 'STATE', 'Country', 'Voltage Grade', 'Conductor', 'Insulation', 'Armouring', 'Inner Sheath', 'Outer Sheath',
      'PROPOSE DRUM TYPE', 'FIRST DOCKET NO', 'Source', 'Availibility']),
  // the Type Test Ledger workbook, tab TTR JIST, in its own column order; loaded by sync/type_test_ledger.ts
  // The certificate number opens the PDF from the office file server, as it does in the ledger (app/api/type-test/file).
  'type-test': {
    label: 'Type test', cols: TYPE_TEST_COLS, from: 'TYPE_TEST_LEDGER', order: 'row_no',
    note: 'from the Type Test Ledger file, loaded by hand',
    link: { col: 'Test Certificate No', href: 'certificate_href' },
    sql: `SELECT row_no, ${pick(TYPE_TEST_COLS)},
        CASE WHEN coalesce(data->>'Certificate file', '') <> '' THEN '/api/type-test/file?row=' || row_no END AS certificate_href
      FROM sheet_snapshot WHERE sheet_key = 'TYPE_TEST_LEDGER' AND tab_name = 'TTR JIST'`,
  },
  'costing-sheets': {
    label: 'Attachment of costing sheet',
    cols: ['Docket', 'Party', 'Utility', 'Quotation no.', 'Items costed', 'Claude costing sheet', 'Touhid costing sheet', 'Touhid approval', 'Review status'],
    note: "costing sheets only, draft; Touhid's sheet is the latest upload for the docket in the Cost sheet",
    // Touhid's link: the newest row for the same docket in the costing upload form (COST_UPLOAD); without one, the text from Claude's sheet
    sql: `SELECT c.row_no, c.data->>'ENQ Docket No' AS "Docket", c.data->>'Party' AS "Party", c.data->>'Utility' AS "Utility", c.data->>'Quotation No' AS "Quotation no.",
        c.data->>'Items costed' AS "Items costed",
        CASE WHEN coalesce(c.data->>'Drive file id', '') <> '' THEN 'https://drive.google.com/file/d/' || (c.data->>'Drive file id') || '/view' END AS "Claude costing sheet",
        coalesce(u.link, c.data->>'Touhid costing sheet (link)') AS "Touhid costing sheet", c.data->>'Touhid approval' AS "Touhid approval", c.data->>'Touhid remarks / review status' AS "Review status"
      FROM sheet_snapshot c
      LEFT JOIN (SELECT DISTINCT ON (upper(btrim(data->>'ENQ Docket No'))) upper(btrim(data->>'ENQ Docket No')) AS docket, btrim(data->>'Upload Costing Sheet') AS link
          FROM sheet_snapshot WHERE sheet_key = 'COST_UPLOAD' AND tab_name = 'Cost' AND btrim(coalesce(data->>'ENQ Docket No', '')) <> '' AND btrim(coalesce(data->>'Upload Costing Sheet', '')) <> ''
          ORDER BY 1, row_no DESC) u ON u.docket = upper(btrim(c.data->>'ENQ Docket No'))
      WHERE c.sheet_key = 'CLAUDE_COSTINGS' AND c.tab_name = 'CLAUDE COSTING SHEETS' AND coalesce(c.data->>'ENQ Docket No', '') <> ''`,
    order: 'row_no DESC', from: 'CLAUDE_COSTINGS',
  },
  'board-attachment': needed('Board attachment', 'BOARD APPROVAL ATTACHMENT', 'not found'),
  // Our copy of the tender executive dashboard's table (sync/supply_history_sync.ts), newest bill first. No rate or amount on the page:
  // supply records go out as quantities and dates, never prices. Like that dashboard, rows without a proper FY are left out.
  'supply-history': {
    label: 'Supply history',
    cols: ['FY', 'Sale bill no.', 'Sale bill date', 'Party', 'Utility', 'Docket', 'Item code', 'Item schedule', 'Item name', 'Invoice qty', 'LR no.', 'Truck no.',
      'Party ref no.', 'Party ref date', 'Contract no.', 'Quotation no.'],
    note: 'copied from the tender executive dashboard; rates and amounts are not shown',
    // The dates are text: mostly 28-May-26, some a UTC timestamp (2026-08-13T18:30:00.000Z is 14 Aug in India). Both are shown as
    // 14-Aug-2026; anything else is shown as written and sorts last instead of failing the page.
    sql: `SELECT d, fy AS "FY", "saleBillNumber" AS "Sale bill no.", coalesce(to_char(d, 'DD-Mon-YYYY'), "saleBillDate") AS "Sale bill date", "partyName" AS "Party",
        utility AS "Utility", "docketNo" AS "Docket", "itemCode" AS "Item code", "itemSchedule" AS "Item schedule", "itemName" AS "Item name",
        "invoiceQty"::text AS "Invoice qty", "lrNo" AS "LR no.", "truckNo" AS "Truck no.", "partyRefNo" AS "Party ref no.", "partyRefDate" AS "Party ref date",
        "contractVrNo" AS "Contract no.", "quotationNo" AS "Quotation no."
      FROM (SELECT *, CASE WHEN "saleBillDate" ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{2}$' THEN to_date("saleBillDate", 'DD-Mon-YY')
          WHEN "saleBillDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$' THEN ("saleBillDate"::timestamptz AT TIME ZONE 'Asia/Kolkata')::date END AS d
        FROM "SupplyHistory" WHERE fy ~ '^[0-9]{2}-[0-9]{2}$') s`,
    order: `d DESC NULLS LAST, "Sale bill no." DESC, "Item code"`, from: 'SUPPLY_HISTORY',
  },
  // Second Power BI report, "CONT EX 2" (Contract Execution Report, live ERP): guideline 9.9. Four of its five pages exist now (not the home page); each needs a
  // per-page spec read from the report in Puja's session and approved by her before it is built.
  ...Object.fromEntries(([['ce-lot-review', 'Lot review'], ['ce-pending-order', 'Pending order'], ['ce-tva', 'TVA'],
    ['ce-rm-req', 'RM req against balance MC']] as const).map(([key, label]) =>
    [key, needed(label, 'CONT EX 2 live ERP feed', 'not found in the connected sheets; the page layout is also still to be read from the report', 'Puja to name the source')])),
  // Our copy of the tender executive dashboard's performance_certificates (sync/supply_history_sync.ts), in serial order. The name opens
  // the file on the office file server. "Duplicate of" is the serial of the original; "Sale bills" counts the linked supply history.
  // The dates are stored as UTC timestamps of midnight in India, so they are read back in Indian time.
  performance: {
    label: 'Performance history',
    cols: ['Serial', 'Certificate', 'Party', 'Utility / client', 'Utility names', 'Item schedule', 'Use / not use', 'Issue date', 'Signing date', 'Party reference no.',
      'Duplicate of', 'Sale bills'],
    note: 'copied from the tender executive dashboard',
    link: { col: 'Certificate', href: 'certificate_href' },
    sql: `SELECT p.serial AS n, CASE WHEN p."certificateUrl" ~ '^https?://' THEN p."certificateUrl" END AS certificate_href, p.serial::text AS "Serial",
        p."certificateName" AS "Certificate", p."partyName" AS "Party", p."utilityOrClient" AS "Utility / client", p."utilityNames" AS "Utility names",
        p."itemSchedule" AS "Item schedule", p."useNotUse" AS "Use / not use",
        to_char(p."issueDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY') AS "Issue date",
        to_char(p."signingDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY') AS "Signing date",
        p."partyReferenceNo" AS "Party reference no.", o.serial::text AS "Duplicate of",
        (SELECT nullif(count(DISTINCT s."saleBillNumber"), 0)::text FROM "_CertSupplyHistory" l JOIN "SupplyHistory" s ON s.id = l."B" WHERE l."A" = p.id) AS "Sale bills"
      FROM performance_certificates p LEFT JOIN performance_certificates o ON o.id = p."duplicateOfId"`,
    order: 'n', from: 'SUPPLY_HISTORY',
  },
};

/** Every row of a report (search, column filters and paging happen in the browser table). Throws pg 42P01 while the tables are not deployed. */
export async function reportRows(db: Db, key: string): Promise<Record<string, string | null>[]> {
  const tab = REPORTS[key];
  if (tab.sourceNeeded !== undefined) return [];
  return (await db.query(`SELECT * FROM (${tab.sql}) t ORDER BY ${tab.order}`)).rows;
}

// The two sheets the app cannot read directly: it reads their "Copy - auto sync" copies, so the page is only as fresh as the copy.
const COPIES = new Set(['TENDER_DUMP', 'PRE_APPROVED_GTP']);

/** When a report's source was last synced into this database; null when it has no synced source (dashboard-made data) or never synced. */
export async function lastSync(db: Db, key: string): Promise<{ at: Date; copy: boolean } | null> {
  const tab = REPORTS[key];
  if (tab.sourceNeeded !== undefined || !tab.from) return null;
  const r = tab.from === 'smartsheet'
    ? await db.query(`SELECT max(last_success_at) AS at FROM sync_state WHERE job LIKE 'smartsheet:%'`)
    // any loader: gsheets:<key>:<tab> from the daily sync, xlsx:<key>:<tab> from a file load
    : await db.query(`SELECT max(finished_at) AS at FROM sync_log WHERE ok AND job LIKE $1`, [`%:${tab.from}:%`]);
  return r.rows[0]?.at ? { at: new Date(r.rows[0].at), copy: COPIES.has(tab.from) } : null;
}
