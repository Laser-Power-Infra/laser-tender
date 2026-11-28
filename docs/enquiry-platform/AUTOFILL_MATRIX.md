# Autofill matrix for the New Enquiry form (for Puja's approval)

Guideline section 3.1, dated 27 Nov 2026. Draft: nothing below is built until approved.

Field list is taken from `db/columns.json` (the Smartsheet columns of Sales Enquiry 3 and Item List ERP 11). Every autofilled value will keep its source and confidence. Blank or low-confidence values are highlighted for a person.

Confidence: **H** taken directly from the mail or a rule; **M** matched or extracted, usually right; **L** a guess a person must confirm; **Manual** cannot be derived from the enquiry mail.

"AI" means extraction by Claude from the mail body or attachments. "Later stage" means the field is not known when the enquiry arrives; it is filled by a later step of the flow (item proposal, costing, quotation), not typed on this form.

## A. Enquiry (Sales Enquiry 3), 51 fields

### Filled from the mail itself

| Field | How it is derived | Source | Conf. | Fallback |
|---|---|---|---|---|
| Enquiry Date | Received date of the mail (IST) | mail header | H | none needed |
| Enquiry from Email id | Sender address. If the mail was forwarded internally, the original sender inside the forwarded block | mail header / body | H (M if forwarded) | person picks from addresses found |
| Email Subject Line | Mail subject, without "Fwd:/Re:" | mail header | H | none needed |
| Party Name | Sender address, then sender domain, then signature company name, matched to the party master | party master (`ref_party`) | M | not matched: blank, highlighted, with the top 3 candidates |
| Reference No | RFQ / tender / bid number found in subject, then body, then attachment | AI | M | blank, highlighted |
| Enquiry / Tender No. | Same extraction as Reference No when the mail is a tender (GeM bid no, NIT no) | AI | M | blank |
| Enquiry From Contact Person | Name in the signature or the sender display name | mail body / header | M | sender display name |
| Enquiry From Contact No. | Phone number in the signature | mail body | M | blank |
| Due Date | Submission / due date stated in the mail or tender document | AI | M | blank, highlighted (it drives the offer countdown) |
| Project Name | Project or scheme named in the mail or tender | AI | M | blank |
| Utility | Utility named in the mail or tender, matched to the utility master | AI + `ref_utility` | M | blank, with candidates |
| Tender/Purchase/Budgetary/Laser Tender | Rule: tender portal or bid number present = Tender; "budgetary" wording = Budgetary; otherwise Purchase | rule + AI | M | highlighted |
| Enquery Type | Picklist value chosen from the mail wording | AI | L | highlighted |
| Party Business Activity Type | The value last used for the same party | earlier dockets of the party | M | new party: blank |
| Attachment of Specifications | "Yes" when a spec / TS file is among the attachments | attachments | M | "No", highlighted |
| Attachment of GTP Format | "Yes" when a GTP format file is attached | attachments | M | "No" |
| Attachment of Title Block | "Yes" when a title block file is attached | attachments | L | "No" |
| GTP (requirement) | Tender asks for GTP with the offer | AI | M | blank |
| CSD (requirement) | Tender asks for cross-section drawing | AI | M | blank |
| DD (requirement) | Tender asks for drum drawing | AI | M | blank |
| Type Test (requirement) | Tender asks for type test reports | AI | M | blank |
| Sample Required | Tender asks for a sample | AI | M | blank |
| Interest % | Payment / credit terms in the mail, converted by the rule 1 % per 30 days | AI + costing rule | L | party's last quote (costing rule 3.5 step 6) |
| Inspection & Commission | Inspection clause in the tender | AI | L | blank |
| TERMS & CONDITION (both columns) | Payment, delivery, validity and LD terms quoted from the mail or tender | AI | M | blank |
| Matching Docket No. | Open docket with the same party and the same reference or tender number | earlier dockets | M | blank; candidates listed |
| TENDER DOCKET NO (MKT) | Docket of the tender this enquiry belongs to, matched on tender number | earlier dockets | M | blank |
| CORRIGENDOM ISSUED DATE | Date of a corrigendum mail linked to the docket | mail header | M | blank |
| CORRIGENDOM ATTACHED | "Yes" when a corrigendum file is attached to a linked mail | attachments | M | blank |
| TOTAL JOBS | Number of item lines created for the docket | item list | H | 0 |

### Filled by a rule at creation

| Field | How it is derived | Source | Conf. | Fallback |
|---|---|---|---|---|
| Enquiry Status | Starting status "Open" (confirm the picklist value) | rule | H | none |
| Enquiry Forwarded To UIC | Unticked at creation | rule | H | none |

### Filled by a later stage of the flow (not typed on this form)

| Field | Filled by |
|---|---|
| ERP Inquiry Voucher No. and Date | ERP entry (Animesh). Read back from the QTN DUMP (ENQUIRY_NO) once the voucher exists |
| Quotation No. and Quotation Date | Read back from the QTN DUMP once the quotation is made |
| Qtn. sub for ver to D Roy, Qtn. ver by D Roy | Costing / quotation review stage (guideline 9.2, stages 3 and 4) |
| FINAL CSD / DD / BOM Attachment and their PROCESS columns (6 fields) | Intermediary-process tasks (guideline 9.2 C) |

### Stay manual (a person's decision)

| Field | Why |
|---|---|
| Accept / Regret / Transfer, Reason for Regret / Transfer | Marketing decision |
| ORDER EXPECTATION | Account holder's judgement |
| LAST UPDATED COMMENT BY ACC HOLDER | Free comment (moves to the comment thread, guideline 13.3) |
| CORRIGENDOM REVIEWED BY ACC HOLDER | A person's confirmation |
| Column1 | Purpose unknown. **Question for Puja: what is this column used for, or can it be dropped from the form?** |

## B. Item lines (Item List ERP 11), 42 fields

One item line is created per item in the enquiry's BOQ / schedule.

### Filled from the mail and attachments

| Field | How it is derived | Source | Conf. | Fallback |
|---|---|---|---|---|
| PARTY ITEM NAME | Item description exactly as the party wrote it | BOQ / mail (AI) | H | blank, highlighted |
| QTY, Unit | Quantity and unit on the BOQ line | BOQ (AI) | H | blank, highlighted |
| Item Schedule | Schedule / lot number on the BOQ line | BOQ (AI) | M | blank |
| PARTY LENGTH | Drum length asked by the party, when it differs from standard | spec (AI) | M | blank |
| Utility, STATE, Country | Copied from the enquiry; state and country from the utility master | enquiry + `ref_utility` | H | blank |
| Destination PIN Code | Delivery location in the tender, converted to PIN | AI | L | blank = ex-works, no freight (costing rule) |
| ACCOUNT HOLDER UPDATE (TS ATTACHED / GTP ATTACHED) | "Yes" when the file is among the docket's attachments | attachments | M | "No" |
| Base Date | Stated in the tender; otherwise the PV rule (technical opening date minus one month, guideline 8.1) | AI + Tender Dashboard | M | flagged "base date not found" |

### Filled by the automated item proposal (guideline 3.4)

Conductor, Armouring, Voltage Grade, PROPOSE ERP ITEM NAME @ CODE, REMARKS OF PROPOSER, Spec master Available, DUPLICATE ITEM, DUPLICATE ITEM 2. All are proposals with source and confidence for a person to accept or correct.

### Filled by the automated costing (guideline 3.5)

freight, TRUCK TYPE, GST % (18 % by rule), FIRM %, MFG%, PROF%, Intt %, insp%, TTR CHARGES%, ACTUAL LG %, ACTUAL NON CHAIN BOM ID, Remarks of Extra Consumption. All draft until Touhid's review.

### Stay manual (a person's decision or approval)

INSTRUCTION OF ACCOUNT HOLDER, REMARK BY ACCOUNT HOLDER, PROPOSE OLD QUOTATION NO (the system will suggest the last quotation for the same party and item), All Technical job completed (Sunil Sharma), Comment of MD Sir (NO ERP CODE), SPECIAL RATE REQUIREMENT, SPECIAL VALUE ADITION %, SPECIAL RATE APPROVAL (DVG), FREIGHT REVIEWED BY LOGISTIC, AKSHAT G APPROVAL (BOM & LG %).

## Summary

| | Enquiry | Item line |
|---|---|---|
| From mail / attachments / masters | 31 | 12 |
| By rule at creation | 2 | 0 |
| By a later automated stage | 12 | 20 |
| Manual | 6 | 10 |

## Points to confirm

1. The starting value of Enquiry Status for an auto-created enquiry.
2. What Column1 is for.
3. When a mail is forwarded to the enquiry mailbox by a colleague, the party is taken from the original sender inside the forward. Is that right?
4. "Enquery Type" and "Party Business Activity Type": may the AI choose a picklist value, or should these stay manual?
