// The one list of dashboard pages: the main navigation and the page status list both read it.
// `no` is the page number in the Power BI report "ENQUIRY TO QUOTATION (N)" (22 pages); `ce` is the page number in the second
// report, "CONT EX 2" (5 pages). Guideline (live Google Doc, 27 Nov 2026), sections 5, 9.7 and 9.9.
// `summary` is the hover text (9.7): Puja's draft wording, at most 40 words, no prices or party data. She can replace any of them
// in the page status list; the saved text (table page_summary) then wins over the draft here.
// No SQL here: this file is bundled into the browser for the navigation.

export const GROUPS = ['Enquiry', 'Quotation and Cost', 'Masters', 'Attachments and Approvals', 'Supply and Performance', 'Contract Execution', 'PV', 'Reports'] as const;
export type Group = (typeof GROUPS)[number];

export interface Page { no?: number; ce?: number; label: string; group: Group; href: string; summary: string }

const report = (key: string) => `/reports?tab=${key}`;
/** The key in lib/reports.ts REPORTS, for a page that is a report. */
export const reportKey = (p: Page) => (p.href.startsWith('/reports?tab=') ? p.href.slice('/reports?tab='.length) : null);
/** The key a group's summary is saved under (pages use their href). */
export const groupKey = (g: Group) => `group:${g}`;

export const GROUP_SUMMARY: Record<Group, string> = {
  'Enquiry': 'Enquiries as they arrive: the control view, new enquiries, and their items.',
  'Quotation and Cost': 'Costing and quotations: cost build-up, quotation history, review status and raw material rates.',
  'Masters': 'Reference records used by costing and offers: bills of materials, CSD, drum, item and specification masters.',
  'Attachments and Approvals': 'Documents that go with offers: type tests, approved GTPs, costing sheets and board approvals.',
  'Supply and Performance': 'What was supplied and how it performed: supply history and performance certificates.',
  'Contract Execution': 'Orders in hand: contracts and their execution status, lots, pending orders and raw material need.',
  'PV': 'Price variation for every docket with a PV clause: terms, base date, indices, calculated against billed.',
  'Reports': 'The status of every page, and the raw ERP lists of tenders, quotation lines and contract lines.',
};

const CONT_EX = 'From the CONT EX 2 report. Source needed.';

export const PAGES: Page[] = [
  { no: 1, label: 'Home', group: 'Enquiry', href: '/',
    summary: 'Control view of all enquiries: new, unreviewed, uncosted, offers due, orders received and pending submissions. Click any count to see the dockets.' },
  { label: 'New enquiry', group: 'Enquiry', href: '/enquiries/new',
    summary: 'Creates an enquiry from the mail automatically. Only blank or low-confidence fields need checking. Shows new and pending enquiries.' },
  { label: 'Enquiry mails', group: 'Enquiry', href: '/enquiries/mails',
    summary: 'Enquiry mails as they arrive: which became a new enquiry, which belong to an existing one, and which need a person to decide.' },
  { no: 2, label: 'Item wise breakup', group: 'Enquiry', href: report('items'),
    summary: 'Item-wise view of enquiries, quotations and contracts: how an ERP item has been quoted and ordered across parties.' },
  { no: 13, label: 'No ERP code', group: 'Enquiry', href: report('no-erp-code'),
    summary: 'Items in enquiries that have no ERP code yet, with the proposal status and spec source.' },

  { no: 3, label: 'Quotation history', group: 'Quotation and Cost', href: report('quotations'),
    summary: 'All past quotations with date, party, item and status; open one to see its costing and docket.' },
  { no: 10, label: 'Auto quotation', group: 'Quotation and Cost', href: report('auto-quotation'),
    summary: 'Item-wise costing from the Claude costing sheet, set against the specification master: raw material cost, ex-works, freight and price for each item.' },
  { no: 11, label: 'Cost calculation sheet', group: 'Quotation and Cost', href: report('cost-sheet'),
    summary: 'Step-by-step cost build-up for a docket with formulas and links to each input.' },
  { no: 22, label: 'Cost calculation tender & budgetary', group: 'Quotation and Cost', href: report('cost-tender-budgetary'),
    summary: 'Costing for tender and budgetary enquiries, with their own formulas and links. Source needed.' },
  { no: 18, label: 'Quotation export and review', group: 'Quotation and Cost', href: report('quotation-review'),
    summary: 'Quotations ready to export, with review status and reviewer remarks.' },
  { no: 12, label: "Today's rate chart", group: 'Quotation and Cost', href: report('rates'),
    summary: "Today's raw material rates and how they have moved, from the Circulars sheet." },

  { no: 4, label: 'BOM master', group: 'Masters', href: report('bom-master'),
    summary: 'Approved factory bill of materials for each cable item, used to check consumption in costings.' },
  // no: 5 (GTP master) is not a page here: it is the same thing as Pre-approved GTP (no: 15)
  { no: 6, label: 'CSD master', group: 'Masters', href: report('csd-master'),
    summary: 'Master records for CSD submissions, by utility and contract, with status. Source needed.' },
  { no: 7, label: 'BOM master quad', group: 'Masters', href: report('bom-quad'),
    summary: 'Bill of materials for quad cables. Source needed.' },
  { no: 14, label: 'DD master', group: 'Masters', href: report('dd-master'),
    summary: 'Drum standards: drum types, requirement and stock, from the Drum Indent sheet. The drum drawings still need a source.' },
  { label: 'Drums per truck master', group: 'Masters', href: report('drums-per-truck'),
    summary: 'How many drums of each type and size go on each kind of truck, from past freight orders in the Claude costing sheet.' },
  { label: 'Item master', group: 'Masters', href: report('item-master'),
    summary: 'Every ERP item with its code, name, category levels and unit, from the Laser Item Master sheet.' },
  { label: 'Specification master', group: 'Masters', href: report('spec-master'),
    summary: 'Specifications already evaluated, by utility and item: construction, voltage grade and the ERP item proposed.' },

  { no: 9, label: 'Type test', group: 'Attachments and Approvals', href: report('type-test'),
    summary: 'Available type test reports and attachments by product and voltage grade, for sending with offers.' },
  { no: 15, label: 'Pre-approved GTP', group: 'Attachments and Approvals', href: report('approved-gtp'),
    summary: 'GTPs already approved by utilities, available to attach to offers. Read from a copy of the responses sheet.' },
  { no: 16, label: 'Attachment of costing sheet', group: 'Attachments and Approvals', href: report('costing-sheets'),
    summary: "Claude's and Touhid's costing sheet for each docket, side by side." },
  { no: 19, label: 'Board attachment', group: 'Attachments and Approvals', href: report('board-attachment'),
    summary: 'Board approval documents linked to dockets and contracts. Source needed.' },

  { no: 8, label: 'Supply history', group: 'Supply and Performance', href: report('supply-history'),
    summary: 'Past supplies by party and product (quantities and dates; never prices) for reference and for requirements that ask for supply records.' },
  { no: 20, label: 'Performance history', group: 'Supply and Performance', href: report('performance'),
    summary: 'Performance certificates on record, by party and utility: the certificate file, issue and signing dates, whether to use it, and the supplies it covers.' },
  // not pages here, removed 28 Nov 2026: no: 17 (Supply history for sale bill), no: 21 (Performance history (2)), ce: 1 (Contract execution home)

  { label: 'Sales contract', group: 'Contract Execution', href: '/sales-contract',
    summary: 'Contracts and orders received, with their status, linked quotation, PV and pending submissions.' },
  { ce: 2, label: 'Lot review', group: 'Contract Execution', href: report('ce-lot-review'),
    summary: `Lots by contract with MC and delivery status. ${CONT_EX}` },
  { ce: 3, label: 'Pending order', group: 'Contract Execution', href: report('ce-pending-order'),
    summary: `Orders with balance quantity still to be executed. ${CONT_EX}` },
  { ce: 4, label: 'TVA', group: 'Contract Execution', href: report('ce-tva'),
    summary: `The TVA page of the contract execution report; its content is still to be read from the report. ${CONT_EX}` },
  { ce: 5, label: 'RM req against balance MC', group: 'Contract Execution', href: report('ce-rm-req'),
    summary: `Raw material needed for the balance manufacturing clearance quantity, against stock and rates. ${CONT_EX}` },

  { label: 'PV', group: 'PV', href: '/pv', summary: GROUP_SUMMARY.PV },

  { label: 'Page status', group: 'Reports', href: report('status'),
    summary: 'Every page of the dashboard with its status: built, or created and waiting for a source. Hover summaries are edited here.' },
  { label: 'ERP tenders', group: 'Reports', href: report('erp-tenders'),
    summary: 'Tenders as recorded in ERP, newest first. Read from a copy of the Tender Dump sheet.' },
  { label: 'ERP quotation lines', group: 'Reports', href: report('erp-quotations'),
    summary: 'Quotation lines as recorded in ERP, newest 20,000. Read from a copy of the Tender Dump sheet.' },
  { label: 'ERP contract lines', group: 'Reports', href: report('erp-contracts'),
    summary: 'Contract lines as recorded in ERP, newest first. Read from a copy of the Tender Dump sheet.' },
];

/** Every key a summary can be saved under, with its draft text. */
export const DEFAULT_SUMMARIES: Record<string, string> = Object.fromEntries([
  ...GROUPS.map(g => [groupKey(g), GROUP_SUMMARY[g]]),
  ...PAGES.map(p => [p.href, p.summary]),
]);

export const MAX_SUMMARY_WORDS = 40;
