# BUILD BRIEF — Laser Enquiry Platform (replace Smartsheet + Power BI)

**Audience:** the Claude (and engineer) who will extend the existing in-house dashboard at `http://192.168.1.190:4173/`.
**Owner / business decision-maker:** Puja (GM – R&D and Operations). **Deployment:** Asmita (office server). Claude cannot deploy to the office LAN.
**Written:** 24 Nov 2026. Read `README.md` first, then this file, then `COSTING_RULES.md` and `OPEN_QUESTIONS.md`.

## 1. Goal
One system that replaces:
1. Smartsheet **Sales Enquiry 3** (63 columns, ~5,900 rows) — the enquiry/docket register.
2. Smartsheet **SALES ENQUIRY ITEM LIST ERP 11** (49 columns, ~750 rows; ERP 10 and ERP 9 are full but still needed for history/duplicate checks).
3. The Power BI report **ENQUIRY TO QUOTATION (N)** — its data comes from **Google Sheets**, not ERP. DAX measures live inside Power BI and must be re-implemented.
4. The costing module must implement **the CLAUDE COSTINGS rules** (`COSTING_RULES.md`), *not* Power BI's logic.
5. **PV (price variation) costing** — `costing/pv.ts`, reverse-engineered from the live Circulars sheet.

Both Smartsheet and the dashboard run **in parallel for some time**; Smartsheet is switched off only after the parity check is clean.

## 2. What exists today (facts, not assumptions)
- The dashboard is a Next.js app (`/_next/static`, POST server actions) that **reads Smartsheet live** (5,899 records). It has: Allocate Tender, Lost/Still Scope, Export Excel, Refresh Data, a Sales Contract tab; sidebar counters Total / Tenders / Purchases / Unclassified / With quotation; assignees PRITIKANA, TASHMITA, AKASH, RITWICK, ANISH KUKREJA, ANIRUDH BANNERJEE.
  So it is a **view layer over Smartsheet**: retiring Smartsheet means the dashboard must own a database. **Ask Asmita where the dashboard code is and how it connects to Smartsheet today** (not visible from outside) and where Allocate / Lost-Still-Scope data is stored.
- Smartsheet sheet ids are in `sync/sheets.config.json`. Sales Enquiry 3's **Docket column is AUTO_NUMBER** (prefix `ENQ-`, suffix `-25-26`, counter continuous across years: ENQ-0073-19-20 … ENQ-22199-25-26; the suffix is a *static string*, still `-25-26` in Nov 2026).
- Sales Enquiry 3 has one Smartsheet automation: when *Utility (Marketing Team)* changes → e-mail to `laserentry.six@gmail.com` and `executive.laserpower@gmail.com` with attachments + comments. **Re-implement this** (item 8 below).
- Item-list quirks: ERP code format `NAME@CODE`; QTY is text; percent columns are fractions (GST % = `0.18`).

## 3. Decisions already taken by Puja (24 Nov 2026)
- **During the parallel run the dashboard entry app creates the row in Smartsheet and shows the matching Smartsheet docket**; until then, data in the dashboard arrives by sync *from* Smartsheet. Implemented as: dashboard-created rows get `PENDING-<n>` (`next_pending_docket_no()`), `sync/mirror_to_smartsheet.ts` pushes them, reads back the Smartsheet-issued `ENQ-…` docket from the add-row response and re-keys everywhere (`rekeyDocket`). Switch to `next_docket_no()` at cut-over (OPEN_QUESTIONS Q4).
- Costing is **draft-only**: never send quotations, never fill *Quotation No.*, never change quoted prices. Touhid reviews through column L ("Remarks from touhid"); the approval checkbox is not relied on.
- Shut down **both** Smartsheet and Power BI eventually (Power BI scope — only this report or all reports — is OPEN_QUESTIONS Q6).

## 4. Target architecture
- **PostgreSQL 14+** (the dashboard's own DB). `db/schema.sql` is complete and validated in PGlite (26 tables/views): `enquiry`, `enquiry_item` (generated from the real Smartsheet columns, mapping in `db/columns.json`), reference lists, Google-Sheets landing table `sheet_snapshot`, typed rate tables, costing tables, attachments, RBAC, audit, sync state, views.
- **Lossless import:** every Smartsheet row is also stored in a `legacy jsonb` column keyed by the *original column title*. Unknown/new columns are reported, never dropped.
- **Row ownership during parallel run:** `master` column = `'smartsheet' | 'dashboard'`. The import never overwrites `master='dashboard'` rows and never touches dashboard-native columns (`allocated_to`, `lost_still_scope`, …).
- **Google Sheets → `sheet_snapshot`** (service account, read-only), typed views/tables on top for costing and PV. Whole-tab replace per sync.
- **Sync scripts (`sync/`)**, all idempotent: `seed.ts`, `smartsheet_sync.ts`, `mirror_to_smartsheet.ts`, `gsheets_sync.ts`, `attachments_sync.ts`, `parity_check.ts`.
- **Costing engine (`costing/`)**: pure TypeScript, no DB access — `rules.ts` (rules), `engine.ts` (per-item costing), `pv.ts` (PV), `parity.ts` (compare to Touhid's sheets).

## 5. Build order (do in this order; each step has an exit check)
1. **Stand up Postgres, apply `db/schema.sql`, run `npm run db:seed`.** Exit: ref tables filled (2,512 parties, 633 utilities, 3,028 ERP items).
2. **One-time import** `npm run sync:smartsheet -- --sheet all` (ERP 9/10/11 + Sales Enquiry 3), then `db:seed` again to align `docket_counter`. Exit: row counts equal Smartsheet; `UNMAPPED COLUMNS` list empty (or reviewed).
3. **Switch the dashboard's read layer from Smartsheet to Postgres** (keep Refresh Data = run incremental sync). Exit: all existing screens and counters show the same numbers (`v_dashboard_counters`, `v_pending_dockets`).
4. **Google Sheets sync**: create a service account, share every sheet in `sync/sheets.config.json` with it (Viewer). Run `npm run sync:gsheets`. Then build typed views over `sheet_snapshot` (`rm_rate`, `freight_rate`, `drum_master`, `drums_per_truck`, `non_chain_bom`, PV index/factor tables) after *inspecting each tab's real layout* — layouts differ and several are wide (dates as rows, RMs as columns).
5. **Entry + edit screens in the dashboard** with RBAC (`app_role`, `field_permission`; column-owner hints in `db/columns.json` → `owner_hint`). New rows created with `PENDING-n`, mirrored to Smartsheet (script on a 1–5 min timer), docket replaced by the Smartsheet one.
6. **Costing module** using `costing/`. Wire inputs from the item-list columns (freight, truck type, GST %, FIRM %, MFG %, PROF %, Intt %, insp %, TTR %, Base Date, ACTUAL NON CHAIN BOM ID, Special VA %, DVG approval) and the typed rate tables. Write results to `costing_run` / `item_costing` / `rm_detail`; export Excel in **Touhid's format** (template ENQ-21846-25-26; one workbook `ENQ-<docket>_Costing_Claude.xlsx` per docket); review through `costing_review`.
7. **PV module** (`costing/pv.ts`): quote-stage base-date costing, contract-stage PV value, offer-now-or-later advice, feeding a "PV PROV open contracts" screen that replaces the sheet.
8. **Re-implement automations:** Utility-change e-mail (see §2), pending-docket lists, WhatsApp/e-mail reminders (Puja's rules: WhatsApp only 9:00–19:00 Mon–Sat, not on holidays; never message her self-chat).
9. **Rebuild Power BI pages** from synced data (`POWERBI_PAGE_MAP.md`).
10. **Attachments:** `npm run sync:attachments` copies every Smartsheet row attachment to server storage (must complete **before** Smartsheet is switched off). Also export comments/discussions (not yet scripted).
11. **Parity period (≥ 2 weeks):** run `npm run parity` daily; exit code 1 = differences. Then Smartsheet → read-only → archive (export a full backup first). Then Power BI.

## 6. Hard rules
- **Never guess consumption/thickness/dimensions.** Source order: docket spec → same utility's other docket → approved GTP → GTP sent to the utility → IS standard with clause cited. Every RM calculation cites source + formula (`rm_detail.consumption_source`, `formula`).
- **Never create duplicate item lines** (same-docket duplicate → add qty to the earlier line and mark the copy; whole docket twice → keep one set, mark the copy "DUPLICATE ITEM").
- **Never use FREIGHT ABNORMAL** in costing; list abnormal differences separately.
- **PV base date comes from the docket** — never assume the IEEMA default.
- Keep the old drum-costing data; never delete history.
- Do not hard-delete anything; use `deleted_at`.

## 7. Verified vs unverified (be honest in your own report)
| Area | Status |
|---|---|
| Schema, column mapping, import/upsert, parity compare, docket re-keying, picklist seed, snapshot replace | Tested (31 tests, PGlite + fixtures built from the real column titles). **Not run against the live Smartsheet / Google APIs** (no credentials in the build environment). |
| Rules in `rules.ts` (source order, FIRM/PV rate, interest ladder, drum making charge, freight ladder, ≤1 % BOM match) | Unit-tested against the written rules. Interpretations marked `TO VERIFY` in code and in `COSTING_RULES.md`. |
| `engine.ts → applyMarkups` | **PLACEHOLDER.** The exact order of MFG / inspection / TTR / profit / interest in Puja's *Costing_21 AUTO CALCULATION SHEET* was not visible. Replace only this function after running `costing/parity.ts` on real Touhid sheets. |
| `pv.ts` linear PV formula, ceiling, date-rule table, offer advice | Reproduces the live sheet row RC25Y-00088 (PV 11,015/km, % change in conductor 10.53 %). CACMAI/conductor formulas **not** verified. |
| Deployment, LAN access, Smartsheet/Google credentials | Must be done by Asmita / Puja. |

## 8. Acceptance tests you should add as you go
- Row counts and field-by-field parity per sheet (`npm run parity`).
- For 10–20 recent dockets: engine output vs Touhid's sheet within 0.5 % (`costing/parity.ts`) — fix `applyMarkups` until green.
- For 10 live PV contracts: `pvValue` vs the "PV VALUE" column of *PV PROV open contracts*.
- Docket re-key: create → mirror → real docket appears → items/attachments follow.
