# Message for Bidyut (draft, not sent)

Subject: Tenders app: two changes from Puja (B04, B05) and one data link for the enquiry dashboard

Hi Bidyut,

Puja has asked me to pass on two changes in the Tenders app (Tender Executive Dashboard, port 3126). They are in the team task tracker as B04 and B05, and in section 9.17 of her guideline document. I have added a third point that the enquiry dashboard needs in order to use them.

**B04: Technical Opening Date field**
- A separate date-and-time field next to Bid Opening Date Time.
- Filled for every tender from the tender documents and corrigenda, and updated whenever a corrigendum changes it.
- A Financial Opening Date field as well, if that date is tracked separately.
- Used for the PV base date (technical opening date minus one month) and for the stage clocks.

**B05: Corrigendum series**
- For every tender, each corrigendum recorded in order: corrigendum number, date received, what changed (due date, opening date, specification, EMD or other term), the new values, and the corrigendum file.
- Each corrigendum file added to the tender's documents, so the original tender document and all corrigenda sit together in sequence.
- When a corrigendum changes the Deadline, Bid Opening Date Time or Technical Opening Date, those fields are updated too.
- Live tenders first (Pre Participation and Quotation Pending), then older ones.

**From my side: a read-only data link for the enquiry dashboard**

The enquiry dashboard must read tender data from your app and must not keep a second copy or change anything in it. Today `/api/external` returns only docket number, raw materials, price basis and the costing-sheet lines. Could you extend it (or add a second read-only route with the same key) so that it returns, for a list of docket numbers or for everything changed since a given time:

| Needed for | Fields |
|---|---|
| Linking | Docket No, Reference No, Contract No, LOI / PO number and date |
| Decision (guideline 9.10) | Pre / Post / Not Participated state, Participated, Marked Status, reason for not participating, Assigned To |
| Dates (8.1, 9.10) | Deadline, Bid Opening Date Time, Technical Opening Date (B04), Reverse Auction date, and the corrigendum series (B05) |
| Commercial terms (9.13) | EMD amount, payment mode and validity, document fee, bid validity, PBG percentage and duration, contract period |
| Results (9.12) | Current Status, Bid Status, L1, our rank and value, rank 1 and 2 names and values, difference from L1 and L2, final remarks |

A "changed since" filter would let me refresh every 15 minutes without reading all tenders each time. I will not read the "Links and Password" page or anything from it.

Please tell me which is easier for you, and when B04 and B05 are likely to be live.

Thanks,
Asmita
