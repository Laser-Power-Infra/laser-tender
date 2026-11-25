# OPEN QUESTIONS (resolve before / during the build)

| # | Question | Who | Why it matters / default if unanswered |
|---|---|---|---|
| Q1 | Where is the dashboard code (repo/folder on the office server) and how does it connect to Smartsheet today (API token, which sheets)? | Asmita | Needed to swap the read layer to Postgres. |
| Q2 | Where are Allocate Tender, Lost/Still Scope, Contract No., Reverse Auction, CVA value, Price Basis, Status note, RM rate Al/Cu stored today? (Smartsheet columns or the app's own store?) | Asmita | Schema has dashboard-native columns for them (`allocated_to`, `lost_still_scope`, …) — storage in the current app is UNVERIFIED. |
| Q3 | ERP 10 has two sheet ids (7785205806092164 / 2033506099089284). Which is the item list? Is the other a different sheet? | Puja / Smartsheet admin | Import both if both are item lists (`item_erp10b`). |
| Q4 | **Docket numbering.** AUTO_NUMBER can't be written via the API. Decision for now: Smartsheet issues the docket (dashboard rows are `PENDING-n` → re-keyed after mirroring). At cut-over: convert the Smartsheet column to text (recommended) or stop mirroring. Also decide whether the suffix `-25-26` changes (one-row update of `app_setting`). | Puja | See `next_docket_no()`, `cutover_docket_no`. |
| Q5 | Which Google Sheet/tab feeds each Power BI page? (Power BI → dataset → Settings, or Edit Power Query.) List is in `sheets.config.json → googleSheetsDiscovery`; page map in `POWERBI_PAGE_MAP.md`. | Vikas / Power BI owner | Needed to rebuild pages from the right sources. |
| Q6 | Shut down **all** Power BI or only "ENQUIRY TO QUOTATION (N)"? Other reports (LASER STORE, CONT EX 2, FREIGHT HISTORY, ALUMINIUM ROD, BOM Approval (P), FREIGHT HISTORY RECORD) feed costing, PV and GMD execution tracking. | Puja | Default: this report only; replace the others one by one. |
| Q7 | Other Smartsheet sheets in use (e.g. "LC & BG Requirement" feeding the Tender Executive Dashboard)? | Puja | Same import/sync pattern applies. |
| Q8 | **Costing_21 formula order** (AUTO CALCULATION SHEET): what is MFG %, inspection %, TTR %, profit %, interest % applied to, in what order, and how GST/freight enter? | Puja / Touhid | `applyMarkups` is a placeholder until this is answered and `costing/parity.ts` is green. |
| Q9 | Reference No. rule — observed: first 3 letters of party + DDMMYYYY + HHMM, or last 4 digits of the GeM bid no. for GeM enquiries. Confirm. (Never "NA".) | Puja | Needed for the entry form default. |
| Q10 | Freight per unit: how is the full-truck cost converted to per-km / per-metre price? Pin-code fallback depth? | Puja | `freightTotal` gives total per docket; per-unit conversion TO VERIFY. |
| Q11 | Drum cost per unit conversion (drum cost ÷ cable length per drum) and the drum-reuse match rule (type + length). | Puja / Touhid | Engine takes `drumCostPerUnit` as an input. |
| Q12 | CACMAI / conductor PV formulas; list of "main metals" for provisional rates; holidays in working-day rules; ceiling on negative PV. | Puja | `pv.ts` §H. |
| Q13 | Smartsheet comments/discussions: export needed? (attachments sync is scripted; comments are not.) | Puja | Must be done before switch-off if people rely on them. |
| Q14 | Per-column edit rights (RBAC): confirm role mapping from the owner hints — Debosmita Nath = data entry; Marketing Team; Animesh = ERP voucher; D Roy = quotation verifier; Dipankar = Quotation No./date; Shilpa = CSD/DD/BOM attachments; Akshat G = BOM & LG % approval; DVG = special-rate approval; Logistic = freight review. | Puja | Stored in `db/columns.json → owner_hint`, `field_permission`. |
| Q15 | Security: Smartsheet token, Google service-account key, DB password — where do they live? Backups of Postgres? | Asmita | Production hygiene. |

## Answered from data (24 Nov 2026, CLAUDE COSTINGS sheet)

- **Q8 markup order (partly):** Touhid's 265 costed items (tab TOUHID ITEMS) give cost = RM + drum per km; 1st EXW = cost x (1 + MFG %) on 265 of 265; EXW = 1st EXW x (1 + Intt % + Insp %) on the 3 items that carry them; price = EXW x 1.18 on 260 of 265. `costing/engine.ts applyMarkups` now follows this. Still open: where PROF %, TTR %, special VA % and FIRM % go (no costing uses them) and how freight enters.
- **Q11 drum cost per unit:** old costings (tab DRUM LINES) show drum cost/km = cost per drum x 1000 / standard length in m. The draft costing uses this with CIRCULARS tabs STD DRUM MAP (item -> drum, standard length) and STD DRUM COST. Still open: the rule when the party length differs from the standard length.
- **Q10 freight per unit:** still open. Touhid's sheets carry no freight on any item, so there is nothing to derive it from.
