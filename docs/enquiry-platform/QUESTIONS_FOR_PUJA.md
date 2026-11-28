# Status reply for Puja (draft, not sent)

Subject: Enquiry dashboard: status against the guideline, and two documents for your approval

Hi Puja,

I am working from the live Google Doc only. The open questions are in your section 12 and 12A, so I have not repeated them here. This note covers what is built, what needs your approval, and what I found that changes the guideline.

**For your approval**
1. Autofill matrix (`AUTOFILL_MATRIX.md`): every field of the enquiry and item forms and how it is filled. 16 fields stay manual (6 on the enquiry, 10 on an item line). Four points to confirm are at the end.
2. Interconnection map (`INTERCONNECTION_MAP.md`): the records, the identifiers that join them and which page uses which link.
3. Hover summaries (9.7): your draft text is live on every menu entry. Please correct the wording in the page status list (Reports menu). Editing needs the admin role, which only my login has today; tell me if you want it on yours.

**Built**
- All 22 pages of ENQUIRY TO QUOTATION (N) exist and are in the main menu: Home, 9 with data, 3 that fill once a draft costing is run (Auto quotation, Cost calculation sheet, Quotation export and review), and 9 with a "Source needed" notice.
- The 5 pages of CONT EX 2 exist under a new "Contract Execution" menu, all with a "Source needed" notice. I cannot open the report myself, so the layout of each page still has to be read in your session before I can write the page specs.
- Grouped main menu, list of new enquiries, Export to Excel and last sync time on every table, and a page status list.
- The costing draft now warns when an item has no delivery location, as in your changed rule in 3.5.
- PV rows without a base date now say that the technical opening date is not yet available from the Tenders app.

**Corrections to the guideline**
- Sections 4 and 5 say Home still reads Smartsheet live. It already reads the dashboard database.
- The sync complaint of 10 Nov was a real fault: Smartsheet did not report every changed row, so 33 enquiries and 265 item lines were out of date on 27 Nov. The daily sync now re-reads every row, and the dashboard matched Smartsheet exactly after that run (5,961 enquiries, all ERP 11 item lines, no differences).

**Findings that affect your decisions**

| Section | Finding |
|---|---|
| 9.11 No-quote rule | The price list in Circulars does have an MOQ column, "MOQ (KM)", but it is set per product family (for example "1 CORE BIG POWER CABLE - ARD"), not per item. The rule will match each item to its family through the item master. Please confirm that reading. |
| 9.8 Delivery location | No item line has a delivery location today: the Destination PIN Code column is blank on all 21,630 lines. Every past offer will show "not recorded" until locations are read from mails, tenders and POs. |
| 8.1 PV base date | Of the 19 contracts without a base date, only 7 carry a tender voucher number in the ERP contract dump. The other 12 cannot be linked to a tender by a real identifier. Are those 12 tender orders at all? |
| 9.16 Tenders app | Its link for other apps gives only docket number, raw materials and price basis. Reading decisions, dates, EMD and results needs Bidyut to extend it. I have drafted that request together with B04 and B05 (`MESSAGE_FOR_BIDYUT.md`). |
| 9.7 Page 14 | Your draft marks DD Master as "Source needed". It shows drum standards from the Drum Indent sheet; only the drum drawings lack a source. |

**Waiting on**
- Your approval of 12A, the matrix and the map.
- Bidyut: B04, B05 and the extended data link.
- Access to the enquiry mailbox for the mail ingest (my proposal: the office n8n passes each enquiry mail to the dashboard).
- Sources for the "Source needed" pages, including the CONT EX 2 feed and free stock.

Nothing has been sent to anyone, and no source sheet, Smartsheet, ERP or Tenders app data has been changed.

Thanks,
Asmita
