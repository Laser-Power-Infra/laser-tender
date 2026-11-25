// Read-only report queries replacing the Power BI pages whose source is known (docs/enquiry-platform/POWERBI_PAGE_MAP.md).
import type { Db } from '../sync/lib.ts';

export const PAGE_SIZE = 100;

// Each query aliases its visible columns to the header text; `order` may use extra (hidden) columns.
export const REPORTS: Record<string, { label: string; cols: string[]; sql: string; order: string }> = {
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
};

/** One page of a report. `q` searches every column. Throws pg 42P01 while the tables are not deployed. */
export async function runReport(db: Db, key: string, q: string, page: number): Promise<{ rows: Record<string, string | null>[]; hasNext: boolean }> {
  const tab = REPORTS[key];
  // t::text = the whole row as text, so one search box covers every column; one extra row tells us whether a next page exists
  const r = await db.query(
    `SELECT * FROM (${tab.sql}) t WHERE ($1 = '' OR t::text ILIKE '%' || $1 || '%') ORDER BY ${tab.order} LIMIT $2 OFFSET $3`,
    [q, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
  return { rows: r.rows.slice(0, PAGE_SIZE), hasNext: r.rows.length > PAGE_SIZE };
}
