# COSTING RULES (source: "LASER Costing — All Instructions", updated 16 Nov 2026) + PV

Code: `costing/rules.ts`, `costing/engine.ts`, `costing/pv.ts`. Tests: `costing/*.test.ts`. `TO VERIFY` = my interpretation, needs Puja/Touhid confirmation via `costing/parity.ts`.

## 1. Which enquiries
- Pending = **blank Quotation No.** in Sales Enquiry 3 (`v_pending_dockets`). Newest first; finish one docket's full flow before the next. Priority: Laser Tender → Purchase → Budgetary/Tender. Laser Tender: check whether Laser participated; quotation no. comes from Chandan Paul.
- Revised BOQ on an existing docket is not a new docket. Unsent offers (blank Quotation No.) are re-costed at current rates; already-sent offers stay unchanged; items lost to another vendor stay as quoted.
- **Draft only** — never send, never fill Quotation No., never change quoted prices.

## 2. Consumption (`resolveConsumption`)
Order: **docket spec → same utility's other docket → approved GTP → GTP sent to utility → IS standard** (practical production tolerances, not minimums; cite clause). If none exists → return `null`, flag the item, ask Soumitra Dey / Soumyashree Samanta. Never guess.
BOM ID: match to NON CHAIN BOM within **≤ 1 %** (`matchNonChainBom`: same RM set, every RM within 1 % — TO VERIFY); otherwise write "no matching non-chain BOM". Add an extra ACTUAL COSTING SHEET from matching non-chain BOMs. HTLS and quad cables: cost with proposed RM items, note "not in RM cost sheet".

## 3. RM rates (`rmRateFor`)
FIRM → today's DAILY RM RATES; PRICE VARIATION → rate on the enquiry base date; not stated → firm. Already-sent firm quotation → quotation date as base date. Rates are carried forward (latest on/before the target date). DAILY MKT CP (for non-chain BOM costing): carry each RM's rate forward, never overwrite existing cells, new RMs → new column at right, no rate → carry last, never rated → blank.

## 4. Drums (`drumFromMaster`, `drumFromBom`)
Drum cost = drum BOM × last purchase rate of each RM + making **₹150/drum up to 54" flange, ₹200 above**. Use DRUM MASTER col N; blank N → col D and list it for Puja. Reuse a drum cost only when drum type + length match (convert mm → inch first). No drum BOM → ≈ **3 × flange price**. Per-unit conversion of drum cost (÷ length per drum) — TO VERIFY.

## 5. Freight (`freightPerTrip`, `freightTotal`)
Never FREIGHT ABNORMAL. ≤ 6 months old → as is; older → **+5 %**. Several rates for the same vehicle → **lowest**. No history → nearest location by pin-code prefix (longest shared prefix, minimum 3 digits — TO VERIFY). Always a **full truck**: trips = ceil(drums ÷ max drums per truck); max from DRUMS PER TRUCK MASTER / REQ MULTIPLE FO. No delivery location → **ex-works, no freight**.

## 6. Interest (`interestPct`)
**1 % per 30 days** of credit (including LC usance). Terms stated → use; else the party's last quote; else value **< ₹50 lakh → advance (0 days)**, **> ₹50 lakh → 60-day LC** (exactly ₹50 lakh — TO VERIFY).

## 7. Percentages and price build-up (`engine.ts`)
Inputs per item: MFG %, profit %, inspection %, TTR %, GST %, interest %, special value-addition % (only with DVG approval), freight. **`applyMarkups` is a PLACEHOLDER** (MFG/insp/TTR on RM+drum, profit on the subtotal, interest on subtotal+profit, GST on ex-works+freight). Replace after parity testing against Costing_21 and Touhid's sheets. Output per item: RM detail (source + formula per RM), rm_cost, drum_cost, freight, ex_works, price_ex_gst, gst, price_incl_gst, warnings.
Check **freight, RM rates, drum cost and interest for every enquiry before Touhid's review.**

## 8. Outputs per docket
(a) SUMMARY, (b) ITEM COSTING (43 columns, IT### series), (c) RM DETAIL, (d) PENDING COSTINGS (A–W), (e) CLAUDE COSTING SHEETS index row (file id, hyperlink, "NOT DONE BY TOUHID", "PENDING – Claude costing <date> to be reviewed by Touhid"), (f) Excel `ENQ-<docket>_Costing_Claude.xlsx` with live formulas in Touhid's format. In the new DB these are `costing_run`, `item_costing`, `rm_detail`, `costing_review`. Touhid's remarks = column L.

## 9. Revisions
Quotation in mail → quotation no. → docket no. → Touhid's sheet → recalc at current DAILY RM RATES → either hold the quoted price (adjust VA %) or revise at the VA % Puja names → leave for her review. RM price fall: firm offers only, last 2 months, account holder Puja/Touhid; ask Pritikana for status first. Revised offers go on the same quotation thread from the Laser account, Pritikana in CC, **Touhid not copied**; costing sent separately to Touhid "for records". Break-even / price-point tests are internal only.

---

# PV (price variation) — `costing/pv.ts`

## A. Quote stage (before order)
Price the enquiry with RM rates **on the enquiry's PV base date** (`rmPolicy: 'PV'`). Base date is read from the docket — never assume the IEEMA default (one month before tender opening). Print the PV clause summary (`pvClauseSummary`): IEEMA/CACMAI, base date, terms, index rule, ceiling. Missing base date/terms/days code → FLAG and ask.

## B. Contract stage — the formula (verified on RC25Y-00088)
```
PV per unit = Σ_k  factor_k × ( index_k(applicable date) − index_k(base date) )
% PV        = PV (after ceiling) / base price (without freight/GST)
ceiling     = 20 % of base price by default ("PV BASED ON CEILING LIMIT UPTO 20%"); column "CEILING LIMIT" overrides
% change in conductor = (Al index applicable − Al index base) / Al index base
```
Factors come from **PV ITEM FACTORS** (per ERP item: AlF, CuF, XLF, SMIF, FeF/FeW, CCF; WA/WF/WSc/WI/WO/WAL for conductors) and **PV FACTOR MASTER** (IEEMA tables, MT/km, key `FAMILY|FACTOR|CORES|ARMOUR|VOLTAGE|SIZE`). Factor → index mapping (`FACTOR_INDEX_MAP`): AlF→Al, CuF/SMIF→Cu, XLF→XLPE (LV/HV), FeF→steel flat, FeW→steel wire, CCF→PVC/PE, zinc→zinc.
Check on the live sheet: 0.425 × (279 579 − 252 941) + 0.388 × (156 825 − 159 825) + 0.078 × (158 844 − 147 843) = **₹11 015/km** = sheet "PV VALUE".

## C. Which date drives the index
1. **Event date** from the contract's *PV Terms* (`eventKindForTerms`): offer date, dispatch date, physical delivery at store, DI date, inspection nomination, MC date; "NA/blank" = not applicable. "…1ST DAY OF PREVIOUS MONTH" variants move the offer date to the 1st of the previous month (`termsMoveToFirstOfPrevMonth`).
2. **Index date rule** from the *PV Days* code (`indexSpecFor(code, E)`, E = event date):
   | Code | Rule |
   |---|---|
   | PMA-IE (IEEMA) | monthly index of the month of (E − 30 days) |
   | PMA-CA (CACMAI) | average of CACMAI daily rates of the previous calendar month |
   | PMD-IE / PMD-CA | value on the same date of the previous month = EDATE(E, −1) |
   | 1WDPM-IE / 1WDPM-CA | value on the 1st working day of the previous month |
   | LWDPM-CA | value on the last working day of the previous month |
   | 15DP-CA, 30DP-CA, "15/30 days prior IEEMA-conductor" | value on E − 15 / E − 30 |
3. ERP calendar codes PV1…PVG (`ERP_PV_DAYS`) are signed day offsets from dispatch / inspection entry / inspection offer date.
Check: delivery-schedule end 19-Nov-2025 with PMA-IE → applicable date 01-Oct-2025 (matches the sheet).

## D. Provisional indices
When the circular for the applicable month is not out: use the provisional price (PV INDEX MONTHLY `TYPE = PROVISIONAL`) **only for main metals** (`MAIN_METALS`, default Al and Cu — TO VERIFY the list); other RMs take the last circular value (`lookupIndex`).

## E. Offer now or wait (`offerAdvice`, `bestOfferMonth`)
Compares PV/unit if offered this month vs next month (provisional): gain per unit and per lot (× qty). Recommendation texts follow the sheet: `ALREADY OFFERED <date> (PV/unit …)`, `SCHEDULE OVER – schedule-date index applies; offer ASAP (LD risk)`, `WAIT: +x/unit next month (provisional)`, `OFFER NOW (…)`. `bestOfferMonth` = best month between contract date and schedule end.

## F. PV approval timing (business rule)
PV billed within the invoice → client approval needed **before** invoicing. PV billed separately → approval possible after the invoice. PV is worked out at four stages: before order (quote), after order, at dispatch, after dispatch.

## G. Data rules for PV sheets
- PV factors only from the circular folders `S:\MD Work\ALU price history\ieema circular` and `…\cacmai circular`; keep factors for sizes without an item code and fill the code when an item is added.
- Items with no kV in name/voltage = 1.1 kV.
- Validate each contract's PV fields (IEEMA/CACMAI, base date, basis, PV value/ceiling, delivery schedule, prices) once against the client's **original PO** (not the ERP PO copy), saved in Drive folder "PV Contract Copies".
- Live/not-live status comes from Power BI "CONT EX 2" for now. One RC has many contracts; one contract has many MCs.
- PV tabs built by Claude must be protected against edits by others.

## H. NOT verified
CACMAI/conductor formula (ratio forms), conductor weights WA/WAL semantics, holiday-aware working days, ceiling on negative PV, XLPE LV/HV selection by voltage, PE vs PVC mapping of CCF, the "main metals" list.
