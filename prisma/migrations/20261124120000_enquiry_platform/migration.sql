-- Enquiry platform: enquiry + enquiry_item (generated from db/columns.json), reference data, Google Sheets landing,
-- rate tables, costing, attachments, users, audit, sync state, views, docket numbering.
CREATE TABLE enquiry (
  column1 text,  -- Smartsheet: "Column1" [TEXT_NUMBER]
  docket_no text PRIMARY KEY,  -- Smartsheet: "Docket No  (Debosmita Nath)" [TEXT_NUMBER] owner-hint: Debosmita Nath
  enquiry_status text,  -- Smartsheet: "Enquiry Status (Acc Holder)" [PICKLIST] owner-hint: Acc Holder
  created_by text,  -- Smartsheet: "Created By" [CONTACT_LIST]
  entry_datetime timestamptz,  -- Smartsheet: "ENTRY Date(MM-DD-YY) (Debosmita Nath)" [DATETIME] owner-hint: Debosmita Nath
  enquiry_date date,  -- Smartsheet: "Enquiry Date(MM-DD-YY)  (Debosmita Nath)" [DATE] owner-hint: Debosmita Nath
  difference_in_days integer,  -- Smartsheet: "Difference in Days" [TEXT_NUMBER]
  party_name text,  -- Smartsheet: "Party Name  (Debosmita Nath)" [PICKLIST] owner-hint: Debosmita Nath
  enquiry_from_email text,  -- Smartsheet: "Enquiry from Email id  (Debosmita Nath)" [CONTACT_LIST] owner-hint: Debosmita Nath
  email_subject text,  -- Smartsheet: "Email Subject Line  (Debosmita Nath)" [TEXT_NUMBER] owner-hint: Debosmita Nath
  reference_no text,  -- Smartsheet: "Reference No  (Debosmita Nath)" [TEXT_NUMBER] owner-hint: Debosmita Nath
  account_holder text,  -- Smartsheet: "Account Holder" [TEXT_NUMBER]
  enquiries_since_2018 text,  -- Smartsheet: "No. Of Enquiries received since 2018" [TEXT_NUMBER]
  orders_since_2018 text,  -- Smartsheet: "No. Of Orders received since 2018" [TEXT_NUMBER]
  matching_docket_no text,  -- Smartsheet: "Matching Docket No.(Marketing team)" [PICKLIST] owner-hint: Marketing team
  party_business_activity_type text,  -- Smartsheet: "Party Business Activity Type  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  enquiry_type text,  -- Smartsheet: "Enquery Type (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  enquiry_category text,  -- Smartsheet: "Tender/ Purchase/Bugetary/ Laser Tender (Marketing" [PICKLIST]
  accept_regret_transfer text,  -- Smartsheet: "Accept/ Regret / Transfer (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  reason_regret_transfer text,  -- Smartsheet: "Reason for Regret / Transfer (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  due_date date,  -- Smartsheet: "Due Date (Marketing Team)" [DATE] owner-hint: Marketing Team
  project_name text,  -- Smartsheet: "Project Name (Marketing Team)" [TEXT_NUMBER] owner-hint: Marketing Team
  utility text,  -- Smartsheet: "Utility (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  enquiry_tender_no text,  -- Smartsheet: "Enquiry / Tender No. (Marketing Team)" [TEXT_NUMBER] owner-hint: Marketing Team
  att_specifications text,  -- Smartsheet: "Attachment of Specifications (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  att_gtp_format text,  -- Smartsheet: "Attachment of GTP Format  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  att_title_block text,  -- Smartsheet: "Attachment of Title Block  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  gtp_requirement text,  -- Smartsheet: "GTP  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  csd_requirement text,  -- Smartsheet: "CSD  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  dd_requirement text,  -- Smartsheet: "DD  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  sample_required text,  -- Smartsheet: "Sample Required" [PICKLIST]
  type_test_requirement text,  -- Smartsheet: "Type Test  (Marketing Team)" [PICKLIST] owner-hint: Marketing Team
  interest_pct numeric,  -- Smartsheet: "Interest % (Marketing Team)" [TEXT_NUMBER] owner-hint: Marketing Team
  inspection_commission text,  -- Smartsheet: "Inspection & Commission (Marketing Team)" [TEXT_NUMBER] owner-hint: Marketing Team
  erp_inquiry_voucher_no text,  -- Smartsheet: "ERP Inquiry Voucher No. (Animesh)" [TEXT_NUMBER] owner-hint: Animesh
  erp_inquiry_voucher_date date,  -- Smartsheet: "ERP Inquiry Voucher Date (Animesh)" [DATE] owner-hint: Animesh
  qtn_submitted_for_verification text,  -- Smartsheet: "Qtn. sub for ver to D Roy (DATA ENTRY)" [TEXT_NUMBER] owner-hint: DATA ENTRY
  qtn_verified_by_d_roy text,  -- Smartsheet: "Qtn. ver by D Roy" [PICKLIST]
  order_expectation text,  -- Smartsheet: "ORDER EXPECTATION (AC HOLDER)" [PICKLIST] owner-hint: AC HOLDER
  last_updated_comment text,  -- Smartsheet: "LAST UPDATED COMMENT BY ACC HOLDER" [TEXT_NUMBER]
  final_csd_attachment text,  -- Smartsheet: "FINAL CSD Attachment (1) (Shilpa)" [PICKLIST] owner-hint: Shilpa
  csd_attachment_process text,  -- Smartsheet: "CSD ATTACHMENT PROCESS (Shilpa)" [PICKLIST] owner-hint: Shilpa
  final_dd_attachment text,  -- Smartsheet: "FINAL DD Attachment (1) (Shilpa)" [PICKLIST] owner-hint: Shilpa
  dd_attachment_process text,  -- Smartsheet: "DD ATTACHMENT PROCESS (Shilpa)" [PICKLIST] owner-hint: Shilpa
  final_bom_attachment text,  -- Smartsheet: "FINAL BOM Attachment (Shilpa)" [PICKLIST] owner-hint: Shilpa
  bom_attachment_process text,  -- Smartsheet: "BOM ATTACHMENT PROCESS (Shilpa)" [PICKLIST] owner-hint: Shilpa
  quotation_no text,  -- Smartsheet: "Quotation No. (Dipankar)" [PICKLIST] owner-hint: Dipankar
  quotation_date date,  -- Smartsheet: "Quotation DateFORMAT(MM-DD-YY) (Dipankar)" [DATE] owner-hint: Dipankar
  modified_by text,  -- Smartsheet: "Modified By" [CONTACT_LIST]
  acc_holder_contact_list text,  -- Smartsheet: "CONTACT LIST OF AC HOLDER" [CONTACT_LIST]
  modified_at timestamptz,  -- Smartsheet: "Modified Date" [DATETIME]
  duplicate_no text,  -- Smartsheet: "Duplicate no" [TEXT_NUMBER]
  marketing_team_job_count text,  -- Smartsheet: "MARKETING TEAM JOB COUNT" [TEXT_NUMBER]
  total_jobs text,  -- Smartsheet: "TOTAL JOBS" [TEXT_NUMBER]
  tender_docket_no_mkt text,  -- Smartsheet: "TENDER DOCKET NO (MKT)-IF TENDER ENQ" [TEXT_NUMBER] owner-hint: MKT
  corrigendum_issued_date date,  -- Smartsheet: "CORRIGENDOM ISSUED DATE(MKT)" [DATE] owner-hint: MKT
  corrigendum_attached text,  -- Smartsheet: "CORRIGENDOM ATTACHED(MKT)" [PICKLIST] owner-hint: MKT
  corrigendum_reviewed_by_acc_holder text,  -- Smartsheet: "CORRIGENDOM REVIEWED BY ACC HOLDER (MKT)" [PICKLIST] owner-hint: MKT
  enquiry_contact_person text,  -- Smartsheet: "Enquiry From Contact Person" [TEXT_NUMBER]
  terms_conditions text,  -- Smartsheet: "TERMS & CONDITION (ALL)" [TEXT_NUMBER] owner-hint: ALL
  terms_conditions_1 text,  -- Smartsheet: "TERMS & CONDITION (ALL)(1)" [TEXT_NUMBER] owner-hint: 1
  enquiry_contact_no text,  -- Smartsheet: "Enquiry From Contact No." [TEXT_NUMBER]
  forwarded_to_uic boolean,  -- Smartsheet: "Enquiry Forwarded To UIC" [CHECKBOX]
  -- dashboard-native fields seen in the live dashboard UI (storage location in the current app is UNVERIFIED - see docs/OPEN_QUESTIONS.md)
  allocated_to text,
  lost_still_scope text CHECK (lost_still_scope IN ('LOST','STILL_SCOPE')),
  contract_no text,
  reverse_auction boolean,
  cva_value numeric,
  price_basis text,
  status_note text,
  rm_rate_al numeric,
  rm_rate_cu numeric,
  -- migration / audit
  master text NOT NULL DEFAULT 'smartsheet' CHECK (master IN ('smartsheet','dashboard')),   -- who owns the row during the parallel run,
  mirrored_at timestamptz,   -- last time this dashboard-owned row was pushed to Smartsheet (mirror_to_smartsheet.ts),
  smartsheet_row_id bigint,
  source_sheet_id bigint,
  legacy jsonb NOT NULL DEFAULT '{}'::jsonb,   -- every original cell keyed by Smartsheet title; lossless,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted_at timestamptz
);

CREATE TABLE enquiry_item (
  id bigserial PRIMARY KEY,  -- surrogate key
  docket_no text NOT NULL,  -- Smartsheet: "DOCKET NO." (no FK on purpose during migration: legacy orphans exist)
  primary_column text,  -- Smartsheet: "Primary Column" [TEXT_NUMBER]
  party_item_name text,  -- Smartsheet: "PARTY ITEM NAME" [TEXT_NUMBER]
  utility text,  -- Smartsheet: "Utility" [PICKLIST]
  state text,  -- Smartsheet: "STATE" [PICKLIST]
  country text,  -- Smartsheet: "Country" [PICKLIST]
  instruction_of_account_holder text,  -- Smartsheet: "INSTRUCTION OF ACCOUNT HOLDER" [PICKLIST]
  remark_by_account_holder text,  -- Smartsheet: "REMARK BY ACCOUNT HOLDER" [TEXT_NUMBER]
  ah_update_ts_attached text,  -- Smartsheet: "ACCOUNT HOLDER UPDATE (TS ATTACHED)" [PICKLIST] owner-hint: TS ATTACHED
  ah_update_gtp_attached text,  -- Smartsheet: "ACCOUNT HOLDER UPDATE (GTP ATTACHED)" [PICKLIST] owner-hint: GTP ATTACHED
  propose_old_quotation_no text,  -- Smartsheet: "PROPOSE OLD QUOTATION NO (BY ACC HOLDER)" [TEXT_NUMBER] owner-hint: BY ACC HOLDER
  conductor text,  -- Smartsheet: "Conductor." [TEXT_NUMBER]
  armouring text,  -- Smartsheet: "Armouring." [TEXT_NUMBER]
  voltage_grade text,  -- Smartsheet: "Voltage Grade." [TEXT_NUMBER]
  item_schedule text,  -- Smartsheet: "Item Schedule" [TEXT_NUMBER]
  std_length text,  -- Smartsheet: "STD LENGTH" [TEXT_NUMBER]
  party_length text,  -- Smartsheet: "PARTY LENGTH (IF STANDER LENGTH NOT MATCH WITH PAR" [TEXT_NUMBER]
  spec_master_available text,  -- Smartsheet: "Spec master Available" [TEXT_NUMBER]
  propose_erp_item text,  -- Smartsheet: "PROPOSE ERP ITEM NAME @ CODE" [PICKLIST]
  remarks_of_proposer text,  -- Smartsheet: "REMARKS OF PROPOSER" [PICKLIST]
  all_technical_job_completed text,  -- Smartsheet: "All Technical job completed (Sunil Sharma)" [TEXT_NUMBER] owner-hint: Sunil Sharma
  comment_of_md_no_erp_code text,  -- Smartsheet: "Comment of MD Sir (NO ERP CODE)" [PICKLIST] owner-hint: NO ERP CODE
  duplicate_item text,  -- Smartsheet: "DUPLICATE ITEM" [TEXT_NUMBER]
  duplicate_item_2 text,  -- Smartsheet: "DUPLICATE ITEM 2" [TEXT_NUMBER]
  enquiry_status text,  -- Smartsheet: "ENQUIRY STATUS" [TEXT_NUMBER]
  special_rate_requirement text,  -- Smartsheet: "SPECIAL RATE REQUIREMENT (AC H)" [PICKLIST] owner-hint: AC H
  special_value_addition_pct numeric,  -- Smartsheet: "SPECIAL VALUE ADITION %" [TEXT_NUMBER]
  special_rate_approval_dvg text,  -- Smartsheet: "SPECIAL RATE APPROVAL(DVG)" [PICKLIST] owner-hint: DVG
  qty numeric,  -- Smartsheet: "QTY" [TEXT_NUMBER]
  unit text,  -- Smartsheet: "Unit" [PICKLIST]
  freight numeric,  -- Smartsheet: "freight" [TEXT_NUMBER]
  truck_type text,  -- Smartsheet: "TRUCK TYPE" [PICKLIST]
  gst_pct numeric,  -- Smartsheet: "GST %" [TEXT_NUMBER]
  firm_pct numeric,  -- Smartsheet: "FIRM %" [TEXT_NUMBER]
  mfg_pct numeric,  -- Smartsheet: "MFG%" [TEXT_NUMBER]
  prof_pct numeric,  -- Smartsheet: "PROF%" [TEXT_NUMBER]
  intt_pct numeric,  -- Smartsheet: "Intt %" [TEXT_NUMBER]
  insp_pct numeric,  -- Smartsheet: "insp%" [TEXT_NUMBER]
  ttr_charges_pct numeric,  -- Smartsheet: "TTR CHARGES%" [TEXT_NUMBER]
  remarks_extra_consumption text,  -- Smartsheet: "Remarks of Extra Consumption" [TEXT_NUMBER]
  freight_reviewed_by_logistic text,  -- Smartsheet: "FREIGHT REVIEWED BY LOGISTIC" [TEXT_NUMBER]
  destination_pin_code text,  -- Smartsheet: "Destination PIN Code (Logistic)" [TEXT_NUMBER] owner-hint: Logistic
  actual_lg_pct numeric,  -- Smartsheet: "ACTUAL LG %" [TEXT_NUMBER]
  actual_non_chain_bom_id text,  -- Smartsheet: "ACTUAL NON CHAIN BOM ID" [TEXT_NUMBER]
  quotation_no text,  -- Smartsheet: "Quotation No. (Dipankar)" [TEXT_NUMBER] owner-hint: Dipankar
  akshat_approval_bom_lg boolean,  -- Smartsheet: "AKSHAT G APPROVAL(BOM & LG %)" [CHECKBOX] owner-hint: BOM & LG %
  base_date date,  -- Smartsheet: "Base Date" [DATE]
  created_by text,  -- Smartsheet: "Created By" [CONTACT_LIST]
  created_at_src timestamptz,  -- Smartsheet: "Created" [DATETIME]
  master text NOT NULL DEFAULT 'smartsheet' CHECK (master IN ('smartsheet','dashboard')),
  mirrored_at timestamptz,
  item_list text NOT NULL DEFAULT 'ERP 11',      -- which Smartsheet item list it came from: ERP 9 / ERP 10 / ERP 11 / new,
  smartsheet_row_id bigint,
  source_sheet_id bigint,
  legacy jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted_at timestamptz
);

-- ============================================================================
-- Hand-written part: indexes, reference data, rates landing, costing, files,
-- RBAC, audit, sync bookkeeping, views, docket numbering.
-- Target: PostgreSQL 14+ (no extensions required).
-- ============================================================================

-- ---------- indexes on the two migrated tables ----------
CREATE UNIQUE INDEX enquiry_smartsheet_row_uq ON enquiry (source_sheet_id, smartsheet_row_id) WHERE smartsheet_row_id IS NOT NULL;
CREATE INDEX enquiry_enquiry_date_idx   ON enquiry (enquiry_date DESC);
CREATE INDEX enquiry_party_idx          ON enquiry (party_name);
CREATE INDEX enquiry_account_holder_idx ON enquiry (account_holder);
CREATE INDEX enquiry_allocated_idx      ON enquiry (allocated_to);
CREATE INDEX enquiry_quotation_no_idx   ON enquiry (quotation_no);
CREATE INDEX enquiry_updated_idx        ON enquiry (updated_at);

CREATE UNIQUE INDEX enquiry_item_smartsheet_row_uq ON enquiry_item (source_sheet_id, smartsheet_row_id) WHERE smartsheet_row_id IS NOT NULL;
CREATE INDEX enquiry_item_docket_idx   ON enquiry_item (docket_no);
CREATE INDEX enquiry_item_erp_idx      ON enquiry_item (propose_erp_item);
CREATE INDEX enquiry_item_utility_idx  ON enquiry_item (utility);
CREATE INDEX enquiry_item_updated_idx  ON enquiry_item (updated_at);

-- ---------- reference / dropdown data (seeded from seed/picklists.json) ----------
CREATE TABLE ref_party    (name text PRIMARY KEY, active boolean NOT NULL DEFAULT true);
CREATE TABLE ref_utility  (name text PRIMARY KEY, active boolean NOT NULL DEFAULT true);
CREATE TABLE ref_erp_item (code text PRIMARY KEY, name text NOT NULL, label text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
-- every small dropdown (status lists, YES/NO, truck types, remarks-of-proposer ...), keyed "<sheet>.<Smartsheet column title>"
CREATE TABLE ref_picklist (list_key text NOT NULL, sort_order integer NOT NULL, value text NOT NULL, PRIMARY KEY (list_key, sort_order));

-- ---------- Google Sheets landing zone ----------
-- Every tab we sync from Google Sheets lands here untyped (one row per sheet row).
-- Typed views are created AFTER inspecting each tab's real layout (see docs/BUILD_BRIEF.md step 4).
CREATE TABLE sheet_snapshot (
  sheet_key  text        NOT NULL,   -- logical name, e.g. 'CIRCULARS', 'CLAUDE_COSTINGS', 'MASTER_BOM_ACTUAL'
  tab_name   text        NOT NULL,   -- e.g. 'DAILY RM RATES', 'DRUM MASTER', 'FREIGHT RATES'
  row_no     integer     NOT NULL,   -- 1-based row number in the tab
  data       jsonb       NOT NULL,   -- {"<header>": "<value>", ...}; header row = row 1 unless sheets.config.json says otherwise
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_key, tab_name, row_no)
);
CREATE INDEX sheet_snapshot_gin ON sheet_snapshot USING gin (data);

-- Typed rate tables that the costing engine reads. Fill them from sheet_snapshot with SQL views or a post-sync step.
-- (Layouts differ per tab - build after inspecting; shapes below are what the engine expects.)
CREATE TABLE rm_rate (               -- long format of DAILY RM RATES / DAILY MKT CP (the sheets are wide: dates as rows, RMs as columns)
  rate_date date NOT NULL, rm_name text NOT NULL, rate numeric NOT NULL, rate_unit text,
  source_tab text NOT NULL, PRIMARY KEY (rate_date, rm_name, source_tab)
);
CREATE TABLE freight_rate (          -- FREIGHT RATES / Power BI "FREIGHT HISTORY RECORD"
  id bigserial PRIMARY KEY, from_location text, to_location text, to_pin text, vehicle_type text,
  rate_per_trip numeric NOT NULL, rate_date date NOT NULL, abnormal boolean NOT NULL DEFAULT false, source_ref text
);
CREATE INDEX freight_rate_pin_idx ON freight_rate (to_pin, vehicle_type);
CREATE TABLE drum_master (           -- DRUM MASTER (col N = costed drum value, col D = fallback)
  drum_code text PRIMARY KEY, description text, flange_dia_inch numeric, length_m numeric,
  cost_col_n numeric, cost_col_d numeric, drum_bom_id text, source_ref text
);
CREATE TABLE drums_per_truck (       -- DRUMS PER TRUCK MASTER
  drum_code text NOT NULL, vehicle_type text NOT NULL, max_drums integer NOT NULL, PRIMARY KEY (drum_code, vehicle_type)
);
CREATE TABLE non_chain_bom (         -- MASTER BOM ACTUAL / NON CHAIN BOM tab
  bom_id text NOT NULL, erp_code text, rm_name text NOT NULL, consumption numeric NOT NULL, unit text,
  PRIMARY KEY (bom_id, rm_name)
);
CREATE INDEX non_chain_bom_erp_idx ON non_chain_bom (erp_code);

-- ---------- costing (mirrors CLAUDE COSTINGS sheet tabs) ----------
CREATE TYPE costing_status AS ENUM ('DRAFT','UNDER_REVIEW','CHANGES_REQUESTED','APPROVED','SUPERSEDED');
CREATE TABLE costing_run (            -- one per docket per revision   == SUMMARY + CLAUDE COSTING SHEETS index row
  id bigserial PRIMARY KEY,
  docket_no text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status costing_status NOT NULL DEFAULT 'DRAFT',
  rm_rate_policy text NOT NULL DEFAULT 'FIRM',      -- FIRM | PV  (PV => rm rates at enquiry base date)
  rm_base_date date,
  excel_file_id text, excel_file_name text,          -- ENQ-<docket>_Costing_Claude.xlsx
  touhid_remarks text,                               -- = column L "Remarks from touhid"
  created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (docket_no, revision)
);
CREATE TABLE item_costing (           -- == ITEM COSTING tab (IT### series)
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES costing_run(id) ON DELETE CASCADE,
  item_id bigint REFERENCES enquiry_item(id),
  it_code text,                       -- IT001 ...
  erp_item text, qty numeric, unit text,
  bom_id text, bom_match_note text,   -- ACTUAL NON CHAIN BOM ID or "no matching non-chain BOM"
  rm_cost numeric, drum_cost numeric, freight numeric, ex_works numeric, price_ex_gst numeric, gst numeric, price_incl_gst numeric,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,    -- the full engine input snapshot (reproducible)
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb  -- full engine output incl. every rate used + source
);
CREATE TABLE rm_detail (              -- == RM DETAIL tab: every RM calculation cites source + formula
  id bigserial PRIMARY KEY,
  item_costing_id bigint NOT NULL REFERENCES item_costing(id) ON DELETE CASCADE,
  rm_name text NOT NULL, consumption numeric NOT NULL, unit text, rate numeric, rate_date date, amount numeric,
  consumption_source text NOT NULL,   -- DOCKET_SPEC | SAME_UTILITY_SPEC | APPROVED_GTP | GTP_SENT_TO_UTILITY | IS_STANDARD
  source_ref text, formula text
);
CREATE TABLE costing_review (         -- Touhid / Puja comments, revisions
  id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES costing_run(id) ON DELETE CASCADE,
  author text NOT NULL, comment text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- attachments (docket specs, TS/GTP/BOQ, enquiry mail PDF, costing sheets ...) ----------
CREATE TABLE attachment (
  id bigserial PRIMARY KEY,
  docket_no text NOT NULL,
  item_id bigint REFERENCES enquiry_item(id),
  kind text,                          -- TS | GTP | BOQ | ENQUIRY_MAIL | CSD | DD | BOM | COSTING | OTHER
  filename text NOT NULL, storage_path text NOT NULL, sha256 text, bytes bigint,
  source text NOT NULL DEFAULT 'upload',  -- upload | smartsheet
  smartsheet_attachment_id bigint, uploaded_by text, uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_docket_idx ON attachment (docket_no);
CREATE UNIQUE INDEX attachment_ss_uq ON attachment (smartsheet_attachment_id) WHERE smartsheet_attachment_id IS NOT NULL;

-- ---------- users (NextAuth credentials login; anonymous visitors are read-only) ----------
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- ---------- audit + sync bookkeeping ----------
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text, action text NOT NULL,
  table_name text NOT NULL, pk text NOT NULL, changes jsonb NOT NULL   -- {"col":{"old":..,"new":..}}
);
CREATE INDEX audit_log_pk_idx ON audit_log (table_name, pk, at DESC);
CREATE TABLE sync_state (job text PRIMARY KEY, last_success_at timestamptz, last_modified_cursor timestamptz, detail jsonb);
CREATE TABLE sync_log (id bigserial PRIMARY KEY, job text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  ok boolean, rows_read integer, rows_written integer, message text);

-- ---------- docket numbering (replaces the Smartsheet AUTO_NUMBER column: prefix "ENQ-", suffix "-25-26") ----------
-- IMPORTANT (found while testing): the suffix is a STATIC string in Smartsheet. Dockets created on 23 Nov 2026 are still
-- "ENQ-22199-25-26", i.e. the suffix is NOT derived from the calendar/financial year. Older dockets show the counter is continuous
-- (ENQ-0073-19-20, ENQ-4306-20-21, ENQ-10003-22-23, ENQ-22199-25-26). So: keep one global counter and make prefix/suffix settings.
-- After the import, run:  SELECT setval('docket_counter', (SELECT max(split_part(docket_no,'-',2)::int) FROM enquiry WHERE docket_no ~ '^ENQ-[0-9]+-');
-- When the business decides to change the suffix (e.g. to -26-27) it is a one-row UPDATE of app_setting. See docs/OPEN_QUESTIONS.md Q4.
CREATE TABLE app_setting (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO app_setting VALUES ('docket_prefix','ENQ-'), ('docket_suffix','-25-26'), ('cutover_docket_no','');   -- cutover_docket_no: first docket number owned by the dashboard (see BUILD_BRIEF phase 2)
CREATE SEQUENCE docket_counter;
CREATE FUNCTION next_docket_no() RETURNS text LANGUAGE sql AS $$
  SELECT (SELECT value FROM app_setting WHERE key='docket_prefix') || nextval('docket_counter')::text
      || (SELECT value FROM app_setting WHERE key='docket_suffix') $$;

-- ---------- views the dashboard + the hourly costing task read ----------
-- Pending quotations == blank Quotation No.; priority: Laser Tender -> Purchase -> Budgetary/Tender; newest first.
CREATE VIEW v_pending_dockets AS
SELECT e.*,
  CASE e.enquiry_category WHEN 'Laser Tender' THEN 1 WHEN 'Purchase' THEN 2 WHEN 'Bugetary' THEN 3 WHEN 'Tender' THEN 3 ELSE 4 END AS priority_rank
FROM enquiry e
WHERE e.deleted_at IS NULL AND (e.quotation_no IS NULL OR btrim(e.quotation_no) = '')
ORDER BY priority_rank, e.enquiry_date DESC, e.docket_no DESC;

-- Pending item proposals == party item name filled, both PROPOSE ERP ITEM and REMARKS OF PROPOSER blank, not STOP.
CREATE VIEW v_pending_item_proposals AS
SELECT i.* FROM enquiry_item i
WHERE i.deleted_at IS NULL
  AND coalesce(btrim(i.party_item_name),'') <> ''
  AND coalesce(btrim(i.propose_erp_item),'') = ''
  AND coalesce(btrim(i.remarks_of_proposer),'') = ''
  AND coalesce(i.instruction_of_account_holder,'') <> 'STOP';

-- Duplicate guard: same docket + same party item name + same ERP item on more than one live line.
CREATE VIEW v_duplicate_item_candidates AS
SELECT docket_no, lower(btrim(party_item_name)) AS party_item_key, propose_erp_item, count(*) AS lines, array_agg(id ORDER BY id) AS item_ids
FROM enquiry_item WHERE deleted_at IS NULL AND coalesce(party_item_name,'') <> ''
GROUP BY 1,2,3 HAVING count(*) > 1;

-- Sidebar counters of the current dashboard (Total / Tenders / Purchases / Unclassified / With quotation)
CREATE VIEW v_dashboard_counters AS
SELECT count(*) AS total_records,
  count(*) FILTER (WHERE enquiry_category IN ('Tender','Laser Tender')) AS tenders,
  count(*) FILTER (WHERE enquiry_category = 'Purchase') AS purchases,
  count(*) FILTER (WHERE enquiry_category IS NULL OR enquiry_category NOT IN ('Tender','Laser Tender','Purchase')) AS unclassified,
  count(*) FILTER (WHERE coalesce(btrim(quotation_no),'') <> '') AS with_quotation
FROM enquiry WHERE deleted_at IS NULL;

-- Temporary docket for rows created in the dashboard while Smartsheet still issues the real number (parallel run).
CREATE SEQUENCE pending_docket_counter;
CREATE FUNCTION next_pending_docket_no() RETURNS text LANGUAGE sql AS $$ SELECT 'PENDING-' || nextval('pending_docket_counter')::text $$;
