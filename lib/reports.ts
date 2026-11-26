// Read-only report queries replacing the Power BI pages whose source is known (docs/enquiry-platform/POWERBI_PAGE_MAP.md).
import type { Db } from '../sync/lib.ts';

/** A report straight from one ERP dump tab of the TENDER DUMP Google Sheet (sheet_snapshot), newest first by `dateCol`. */
function dump(label: string, tab: string, dateCol: string, cols: string[], limit?: number) {
  const d = `data->>'${dateCol}'`;
  return {
    label, cols,
    note: limit ? `newest ${limit.toLocaleString('en-IN')} lines only` : undefined,
    // the dates are text like 21-dec-2018; anything else sorts last instead of failing the page
    sql: `SELECT row_no, CASE WHEN ${d} ~* '^[0-9]{1,2}-[a-z]{3}-[0-9]{4}$' THEN to_date(${d}, 'DD-Mon-YYYY') END AS d,
        ${cols.map(c => `data->>'${c}' AS "${c}"`).join(', ')}
      FROM sheet_snapshot WHERE sheet_key = 'TENDER_DUMP' AND tab_name = '${tab}'`,
    order: `d DESC NULLS LAST, row_no${limit ? ` LIMIT ${limit}` : ''}`,
  };
}

// Each query aliases its visible columns to the header text; `order` may use extra (hidden) columns.
export const REPORTS: Record<string, { label: string; cols: string[]; sql: string; order: string; note?: string }> = {
  items: {
    label: 'Item wise breakup',
    cols: ['Docket', 'Party', 'Utility', 'Party item name', 'Proposed ERP item', 'Qty', 'Unit', 'Quotation no.'],
    sql: `SELECT i.id, i.docket_no AS "Docket", e.party_name AS "Party", coalesce(nullif(btrim(i.utility), ''), e.utility) AS "Utility",
        i.party_item_name AS "Party item name", i.propose_erp_item AS "Proposed ERP item", i.qty::text AS "Qty", i.unit AS "Unit",
        coalesce(nullif(btrim(i.quotation_no), ''), e.quotation_no) AS "Quotation no."
      FROM enquiry_item i LEFT JOIN enquiry e ON e.docket_no = i.docket_no AND e.deleted_at IS NULL
      WHERE i.deleted_at IS NULL`,
    order: 'id DESC',
  },
  'no-erp-code': {
    label: 'No ERP code',
    cols: ['Docket', 'Party', 'Party item name', 'Proposed ERP item', 'Remarks of proposer', 'Comment of MD Sir', 'Qty', 'Unit'],
    sql: `SELECT i.id, i.docket_no AS "Docket", e.party_name AS "Party", i.party_item_name AS "Party item name", i.propose_erp_item AS "Proposed ERP item",
        i.remarks_of_proposer AS "Remarks of proposer", i.comment_of_md_no_erp_code AS "Comment of MD Sir", i.qty::text AS "Qty", i.unit AS "Unit"
      FROM enquiry_item i LEFT JOIN enquiry e ON e.docket_no = i.docket_no AND e.deleted_at IS NULL
      WHERE i.deleted_at IS NULL AND (coalesce(btrim(i.propose_erp_item), '') = '' OR i.propose_erp_item ILIKE '%NO ERP CODE%')`,
    order: 'id DESC',
  },
  quotations: {
    label: 'Quotation history',
    cols: ['Quotation no.', 'Quotation date', 'Docket', 'Party', 'Utility', 'Account holder'],
    sql: `SELECT quotation_date, quotation_no AS "Quotation no.", to_char(quotation_date, 'DD-Mon-YYYY') AS "Quotation date", docket_no AS "Docket",
        party_name AS "Party", utility AS "Utility", account_holder AS "Account holder"
      FROM enquiry WHERE deleted_at IS NULL AND coalesce(btrim(quotation_no), '') <> ''`,
    order: `quotation_date DESC NULLS LAST, "Docket" DESC`,
  },
  rates: {
    label: "Today's rate chart",
    // latest row per raw material and source tab: the tabs (DAILY RM RATES / DAILY MKT CP) carry different prices
    cols: ['Raw material', 'Rate', 'Unit', 'Rate date', 'Source tab'],
    sql: `SELECT DISTINCT ON (rm_name, source_tab) rm_name AS "Raw material", rate::text AS "Rate", rate_unit AS "Unit",
        to_char(rate_date, 'DD-Mon-YYYY') AS "Rate date", source_tab AS "Source tab"
      FROM rm_rate ORDER BY rm_name, source_tab, rate_date DESC`,
    order: `"Raw material", "Source tab"`,
  },
  'approved-gtp': {
    label: 'Pre-approved GTP',
    cols: ['ITEM CODE', 'Item Name', 'Utility', 'STATE', 'Country', 'Project schem', 'APPROVAL STATUS', 'STATUS', 'Attachment Type', 'Contract Number', 'GTP ATTACHMENT', 'Timestamp'],
    // form responses are appended, so the highest row is the newest
    sql: `SELECT row_no, ${['ITEM CODE', 'Item Name', 'Utility', 'STATE', 'Country', 'Project schem', 'APPROVAL STATUS', 'STATUS', 'Attachment Type', 'Contract Number', 'GTP ATTACHMENT', 'Timestamp'].map(c => `data->>'${c}' AS "${c}"`).join(', ')}
      FROM sheet_snapshot WHERE sheet_key = 'PRE_APPROVED_GTP' AND tab_name = 'Pree approved GTP'`,
    order: 'row_no DESC',
  },
  'erp-tenders': dump('ERP tenders', 'TENDER DUMP', 'VRDATE',
    ['VRNO', 'VRDATE', 'UTILITY NAME', 'CUSTOMER NAME', 'TENDER DESC', 'TENDER REFNO', 'TENDER TYPE NAME', 'DUE DATE', 'BID SUBMITTED DATE', 'MIN QTN AMT (LAKHS)', 'MAX QTN AMT (LAKHS)']),
  // shortcut: every row goes to the browser table, so the 92,000-line quotation dump is cut to the newest 20,000; move filtering to SQL if older lines are needed.
  'erp-quotations': dump('ERP quotation lines', 'QTN DUMP', 'QUOTATION_DATE',
    ['QUOTATION_NO', 'QUOTATION_DATE', 'SLNO', 'TENDER_VRNO', 'ENQUIRY_NO', 'CLIENT', 'ITEM_CODE', 'ITEM_NAME', 'UM', 'QUOTATION_QTY', 'RATE', 'QUOTATION_VALUE', 'CONTRACT_NO', 'CONTRACT_QTY'], 20000),
  'erp-contracts': dump('ERP contract lines', 'CONT DUMP', 'CONTRACT_DATE',
    ['CONTRACT_NO', 'CONTRACT_DATE', 'CUSTOMER_CODE', 'PARTY_ORDER_NO', 'ITEM_CODE', 'ITEM_NAME', 'UM', 'RATE', 'CONTRACT_QTY', 'INVOICE_QTY', 'BALANCE', 'CONT_VALUE', 'QUOTATION_NO', 'FREIGHT_BASIS', 'TENDER_VRNO']),
};

/** Every row of a report (search, column filters and paging happen in the browser table). Throws pg 42P01 while the tables are not deployed. */
export async function reportRows(db: Db, key: string): Promise<Record<string, string | null>[]> {
  const tab = REPORTS[key];
  return (await db.query(`SELECT * FROM (${tab.sql}) t ORDER BY ${tab.order}`)).rows;
}
