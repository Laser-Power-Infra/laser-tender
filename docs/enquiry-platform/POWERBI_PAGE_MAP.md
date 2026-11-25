# Power BI "ENQUIRY TO QUOTATION (N)" → new platform

Data source of the whole report = **Google Sheets** (Puja, 24 Nov 2026). DAX measures live inside the .pbix and must be re-implemented — open the report in Power BI Desktop → Transform data (Power Query) to see which sheet/tab each table reads, then fill the "Source" column. Nothing below is verified except the page names.

| Power BI page | Replace with | Data | Source (fill in) |
|---|---|---|---|
| HOME | Dashboard home / counters | `v_dashboard_counters`, `enquiry` | |
| ITEM WISE BREAKUP | Item-wise view | `enquiry_item` ⨝ `enquiry` | |
| Quotation History | Quotation history screen | `enquiry` (quotation no./date), `item_costing` | |
| BOM / GTP / CSD / DD MASTER, Bom Master Quad | Master data screens | Google Sheets → `sheet_snapshot` → typed tables; `non_chain_bom` | MASTER BOM ACTUAL etc. |
| Supply History, Supply History for Sale Bill | Supply history | Google Sheets / ERP export | |
| Type Test | Type-test register | Google Sheets | |
| Auto Quotation | Costing module → quotation draft | `costing/` | |
| Cost Calculation Sheet | Costing module (CLAUDE COSTINGS rules, **not** Power BI logic) | `costing/`, rate tables | |
| Today's Rate Chart | RM rates screen | `rm_rate` (DAILY RM RATES / DAILY MKT CP) | Circulars |
| No Erp Code | Items with "NO ERP CODE" | `enquiry_item.propose_erp_item` | |
| Pree Aproved GTP | Approved-GTP register | Google Sheets / attachments | |
| Attachment of Costing Sheet | Costing attachments | `attachment`, `costing_run.excel_file_*` | |
| QUOTATION EXPORT AND REVIEW | Export + Touhid review (column L) | `costing_review` | |
| BOARD ATTACHMENT | Attachments board | `attachment` | |

Other Power BI reports that other work depends on (decide in OPEN_QUESTIONS Q6): LASER STORE, CONT EX 2 (live contracts, RC vs contract vs MC — used by PV), FREIGHT HISTORY (RECORD), ALUMINIUM ROD, BOM Approval (P) (feeds DAILY MKT CP daily at 10 am), GMD execution tracking.
