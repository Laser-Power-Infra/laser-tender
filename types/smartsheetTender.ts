/**
 * SmartsheetTender - typed interface for a single row from the Smartsheet tender sheet.
 * All fields are nullable since column presence is not guaranteed.
 */
export interface SmartsheetTender {
  id?: string;
  enquiryDate: string | null;
  partyName: string | null;
  docketNumber: string | null;
  utility: string | null;
  quotationNumber: string | null;
  quotationDate: string | null;
  accountHolder: string | null;
  allocatedTo: string | null;
  status: string | null;
  reverseAuctionApplicable: string | null;
  tenderPurchase: string | null;
  cvaValue?: string | null;
  
  // Enriched costing details from joined Excel
  attachmentUrl?: string | null;
  proposedErpItemName?: string | null;
  proposedQty?: string | null;
  priceBasis?: string | null;
  aluminiumPrice?: number | null;
  aluminiumAlloyPrice?: number | null;
  copperTapePrice?: number | null;
  extrudedSemiconductivePrice?: number | null;
  htXlpePrice?: number | null;
  pvcTypeSt2Price?: number | null;
  galvanisedSteelFlatStripPrice?: number | null;
  fillerPrice?: number | null;
  rawMaterials?: any;
}
