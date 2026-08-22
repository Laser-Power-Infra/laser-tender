"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useSmartsheetTenders } from "@/hooks/useSmartsheetTenders";
import { SmartsheetTender } from "@/types/smartsheetTender";
import {
  updateTenderAllocatedTo,
  updateTenderStatus,
  updateTenderReverseAuction,
  batchUpdateAllocatedTo,
  scanCostingFiles,
  refreshCosting,
  pushCostingToQueue,
  syncSmartsheetData,
  updateTenderContactNo,
} from "@/actions/tenders";

type SortField = keyof SmartsheetTender;
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortField;
  label: string;
  width: number;
}

const COLUMNS: ColDef[] = [
  { key: "enquiryDate",     label: "Enquiry Date",      width: 200 },
  { key: "partyName",       label: "Party Name",         width: 220 },
  { key: "docketNumber",    label: "Docket Number",      width: 160 },
  { key: "utility",         label: "Utility",            width: 200 },
  { key: "quotationNumber", label: "Quotation Number",   width: 170 },
  { key: "contractNo",      label: "Contract Number",    width: 220 },
  { key: "quotationDate",   label: "Quotation Date",     width: 190 },
  { key: "accountHolder",   label: "Account Holder",     width: 180 },
  { key: "allocatedTo",     label: "Allocated To",       width: 180 },
  { key: "status",          label: "Status",             width: 180 },
  { key: "emailId",         label: "Email Id",           width: 220 },
  { key: "emailSubjectLine",label: "Email Subject Line", width: 280 },
  { key: "contactNo",       label: "Contact No",         width: 160 },
  { key: "reverseAuctionApplicable", label: "Reverse Auction",  width: 150 },
  { key: "cvaValue",            label: "CVA Value",          width: 120 },
  { key: "tenderPurchase",      label: "Tender / Purchase",  width: 150 },
  { key: "proposedErpItemName", label: "Item Name",          width: 250 },
  { key: "proposedQty",         label: "Tender Qty",         width: 140 },
  { key: "attachmentUrl",       label: "Attachment",         width: 150 },
  { key: "priceBasis",          label: "Price Basis",        width: 130 },
  { key: "rawMaterials",        label: "Raw Materials",      width: 260 },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function cmp(a: string | null, b: string | null, dir: SortDir): number {
  const va = (a ?? "").toLowerCase();
  const vb = (b ?? "").toLowerCase();
  if (va < vb) return dir === "asc" ? -1 : 1;
  if (va > vb) return dir === "asc" ? 1 : -1;
  return 0;
}

/** Format raw date string "YYYY-MM-DD" → "DD-MMM-YY" for display */
function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Derive badge class from tender/purchase type value */
function purchaseBadgeClass(val: string): string {
  const v = val.toLowerCase();
  if (v.includes("tender")) return "tender";
  if (v.includes("purchase")) return "purchase";
  if (v.includes("budgetary") || v.includes("bugetary")) return "budgetary";
  if (v.includes("laser")) return "laser";
  return "purchase";
}

function parseQuantities(qtyStr: string | null): number[] {
  if (!qtyStr) return [];
  const parts = qtyStr.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
  const nums: number[] = [];
  parts.forEach(part => {
    const cleaned = part.replace(/,/g, "");
    const match = cleaned.match(/[\d.]+/);
    if (match) {
      const val = parseFloat(match[0]);
      if (!isNaN(val)) {
        nums.push(val);
      }
    }
  });
  return nums;
}

const TenderDashboardPage: React.FC = () => {
  const { data, loading, error } = useSmartsheetTenders();

  const [search, setSearch]           = useState("");
  const [sortField, setSortField]     = useState<SortField>("enquiryDate");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [costingRefreshing, setCostingRefreshing] = useState(false);
  const [costingSummary, setCostingSummary] = useState<{ matched: number; total: number } | null>(null);
  const [scanningCosting, setScanningCosting] = useState(false);
  const [scanSummary, setScanSummary] = useState<{ scanned: number; matched: number; notFound: number; total: number; remaining: number } | null>(null);
  const [pushingQueue, setPushingQueue] = useState(false);
  const [queueSummary, setQueueSummary] = useState<{ total: number; published: number; failed: number } | null>(null);
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(50);

  // Inline editing state for Allocated To
  const [editingAllocatedTo, setEditingAllocatedTo] = useState<string | null>(null);
  const [editAllocatedValue, setEditAllocatedValue] = useState("");
  const [savingAllocated, setSavingAllocated] = useState<Record<string, boolean>>({});
  const [allocatedToOverrides, setAllocatedToOverrides] = useState<Record<string, string | null>>({});

  // Inline editing state for Status
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [editStatusValue, setEditStatusValue] = useState("");
  const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string | null>>({});

  // Inline editing state for Reverse Auction
  const [savingReverseAuction, setSavingReverseAuction] = useState<Record<string, boolean>>({});
  const [reverseAuctionOverrides, setReverseAuctionOverrides] = useState<Record<string, string | null>>({});

  // Inline editing state for Contact No
  const [editingContactNo, setEditingContactNo] = useState<string | null>(null);
  const [editContactValue, setEditContactValue] = useState("");
  const [savingContact, setSavingContact] = useState<Record<string, boolean>>({});
  const [contactNoOverrides, setContactNoOverrides] = useState<Record<string, string | null>>({});

  const [syncing, setSyncing] = useState(false);

  // Column width states for manual expansion/resize
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    COLUMNS.forEach(col => {
      widths[col.key] = col.width;
    });
    return widths;
  });

  // Column search states (maps each column key to its search term, excluding attachmentUrl)
  const [colSearches, setColSearches] = useState<Record<string, string>>({
    enquiryDate: "",
    partyName: "",
    docketNumber: "",
    utility: "",
    quotationNumber: "",
    contractNo: "",
    quotationDate: "",
    accountHolder: "",
    allocatedTo: "",
    status: "",
    emailId: "",
    emailSubjectLine: "",
    contactNo: "",
    reverseAuctionApplicable: "",
    tenderPurchase: "",
    proposedErpItemName: "",
    proposedQty: "",
    priceBasis: "",
    rawMaterials: "",
  });

  // Specialized filters states
  const [enquiryStartDate, setEnquiryStartDate] = useState("");
  const [enquiryEndDate, setEnquiryEndDate] = useState("");
  const [quotationStartDate, setQuotationStartDate] = useState("");
  const [quotationEndDate, setQuotationEndDate] = useState("");
  const [tenderPurchaseFilter, setTenderPurchaseFilter] = useState("All");
  const [priceBasisFilter, setPriceBasisFilter] = useState("All");
  const [alMin, setAlMin] = useState("");
  const [alMax, setAlMax] = useState("");
  const [cuMin, setCuMin] = useState("");
  const [cuMax, setCuMax] = useState("");

  // Account Holder Multi-select dropdown states
  const [showAccountHolderDropdown, setShowAccountHolderDropdown] = useState(false);
  const [selectedAccountHolders, setSelectedAccountHolders] = useState<string[]>([]);
  const accountHolderDropdownRef = useRef<HTMLDivElement>(null);

  // Party Name Multi-select dropdown states
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const partyDropdownRef = useRef<HTMLDivElement>(null);

  // Item Name Multi-select dropdown states
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const itemDropdownRef = useRef<HTMLDivElement>(null);

  // Quotation Number Multi-select dropdown states
  const [showQuotationDropdown, setShowQuotationDropdown] = useState(false);
  const [selectedQuotations, setSelectedQuotations] = useState<string[]>([]);
  const quotationDropdownRef = useRef<HTMLDivElement>(null);

  // Utility Multi-select dropdown states
  const [showUtilityDropdown, setShowUtilityDropdown] = useState(false);
  const [selectedUtilities, setSelectedUtilities] = useState<string[]>([]);
  const utilityDropdownRef = useRef<HTMLDivElement>(null);

  // Allocated To Multi-select dropdown states
  const [showAllocatedToDropdown, setShowAllocatedToDropdown] = useState(false);
  const [selectedAllocatedTo, setSelectedAllocatedTo] = useState<string[]>([]);
  const allocatedToDropdownRef = useRef<HTMLDivElement>(null);

  // Tender Qty min/max states
  const [qtyMin, setQtyMin] = useState("");
  const [qtyMax, setQtyMax] = useState("");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setShowPartyDropdown(false);
      }
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(event.target as Node)) {
        setShowItemDropdown(false);
      }
      if (quotationDropdownRef.current && !quotationDropdownRef.current.contains(event.target as Node)) {
        setShowQuotationDropdown(false);
      }
      if (utilityDropdownRef.current && !utilityDropdownRef.current.contains(event.target as Node)) {
        setShowUtilityDropdown(false);
      }
      if (accountHolderDropdownRef.current && !accountHolderDropdownRef.current.contains(event.target as Node)) {
        setShowAccountHolderDropdown(false);
      }
      if (allocatedToDropdownRef.current && !allocatedToDropdownRef.current.contains(event.target as Node)) {
        setShowAllocatedToDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleColSearchChange = (key: string, val: string) => {
    setColSearches(prev => ({
      ...prev,
      [key]: val
    }));
    setPage(1);
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = colWidths[colKey];
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(60, startWidth + deltaX) // Min width of 60px
      }));
    };
    
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSaveAllocatedTo = async (docketNumber: string) => {
    if (savingAllocated[docketNumber]) return;
    const newValue = editAllocatedValue;
    setSavingAllocated(prev => ({ ...prev, [docketNumber]: true }));
    try {
      const json = await updateTenderAllocatedTo(docketNumber, newValue || null);
      if (json.success) {
        setAllocatedToOverrides(prev => ({ ...prev, [docketNumber]: newValue }));

        const currentRow = data.find(r => r.docketNumber === docketNumber);
        const partyName = currentRow?.partyName;
        if (partyName) {
          const samePartyRows = data.filter(
            r => r.partyName === partyName && r.docketNumber !== docketNumber
          );
          if (samePartyRows.length > 0) {
            const batchDocketNumbers = samePartyRows.map(r => r.docketNumber!);
            setAllocatedToOverrides(prev => {
              const next = { ...prev };
              batchDocketNumbers.forEach(dn => { next[dn] = newValue; });
              return next;
            });
            batchUpdateAllocatedTo(batchDocketNumbers, newValue || null).catch(err => console.error("Batch auto-fill failed:", err));
          }
        }
      }
    } catch (err) {
      console.error("Failed to update Allocated To:", err);
    } finally {
      setSavingAllocated(prev => ({ ...prev, [docketNumber]: false }));
      setEditingAllocatedTo(null);
    }
  };

  const handleSaveStatus = async (docketNumber: string) => {
    if (savingStatus[docketNumber]) return;
    const newValue = editStatusValue;
    setSavingStatus(prev => ({ ...prev, [docketNumber]: true }));
    try {
      const json = await updateTenderStatus(docketNumber, newValue || null);
      if (json.success) {
        setStatusOverrides(prev => ({ ...prev, [docketNumber]: newValue }));
      }
    } catch (err) {
      console.error("Failed to update Status:", err);
    } finally {
      setSavingStatus(prev => ({ ...prev, [docketNumber]: false }));
      setEditingStatus(null);
    }
  };

  const handleSaveReverseAuction = async (docketNumber: string, value: string) => {
    if (savingReverseAuction[docketNumber]) return;
    setSavingReverseAuction(prev => ({ ...prev, [docketNumber]: true }));
    try {
      const json = await updateTenderReverseAuction(docketNumber, value);
      if (json.success) {
        setReverseAuctionOverrides(prev => ({ ...prev, [docketNumber]: value }));
      }
    } catch (err) {
      console.error("Failed to update Reverse Auction:", err);
    } finally {
      setSavingReverseAuction(prev => ({ ...prev, [docketNumber]: false }));
    }
  };

  const handleSaveContactNo = async (docketNumber: string) => {
    if (savingContact[docketNumber]) return;
    const newValue = editContactValue;
    setSavingContact(prev => ({ ...prev, [docketNumber]: true }));
    try {
      const json = await updateTenderContactNo(docketNumber, newValue || null);
      if (json.success) {
        setContactNoOverrides(prev => ({ ...prev, [docketNumber]: newValue }));
      }
    } catch (err) {
      console.error("Failed to update Contact No:", err);
    } finally {
      setSavingContact(prev => ({ ...prev, [docketNumber]: false }));
      setEditingContactNo(null);
    }
  };

  const handleRefresh = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const json = await syncSmartsheetData();
      if (!json.success) {
        console.error("Sync failed:", json.error);
      }
      // Polling will pick up new data within 30s; force reload to see immediately
      window.location.reload();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleClearAllFilters = () => {
    setSearch("");
    setTenderPurchaseFilter("All");
    setPriceBasisFilter("All");
    setSelectedAccountHolders([]);
    setEnquiryStartDate("");
    setEnquiryEndDate("");
    setQuotationStartDate("");
    setQuotationEndDate("");
    setAlMin("");
    setAlMax("");
    setCuMin("");
    setCuMax("");
    setSelectedParties([]);
    setSelectedItems([]);
    setSelectedQuotations([]);
    setSelectedUtilities([]);
    setSelectedAllocatedTo([]);
    setReverseAuctionOverrides({});
    setShowPartyDropdown(false);
    setShowItemDropdown(false);
    setShowQuotationDropdown(false);
    setShowUtilityDropdown(false);
    setShowAccountHolderDropdown(false);
    setShowAllocatedToDropdown(false);
    setQtyMin("");
    setQtyMax("");
    setContactNoOverrides({});
    setColSearches({
      enquiryDate: "",
      partyName: "",
      docketNumber: "",
      utility: "",
      quotationNumber: "",
      contractNo: "",
      quotationDate: "",
      accountHolder: "",
      allocatedTo: "",
      status: "",
      emailId: "",
      emailSubjectLine: "",
      contactNo: "",
      reverseAuctionApplicable: "",
      tenderPurchase: "",
      proposedErpItemName: "",
      proposedQty: "",
      priceBasis: "",
      rawMaterials: "",
    });
    setPage(1);
  };

  // ── Shared filter logic used by both the main filtered data
  //     and each dropdown's unique-value list (with its own filter excluded) ──
  function applyFilters(baseRows: SmartsheetTender[], excludeKeys: string[] = []): SmartsheetTender[] {
    let rows = baseRows;

    if (!excludeKeys.includes("tenderPurchase") && tenderPurchaseFilter !== "All") {
      rows = rows.filter(r => r.tenderPurchase === tenderPurchaseFilter);
    }

    if (!excludeKeys.includes("accountHolder") && selectedAccountHolders.length > 0) {
      rows = rows.filter(r => {
        const holder = (r.accountHolder ?? "").trim();
        return holder !== "" && selectedAccountHolders.includes(holder);
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(row =>
        COLUMNS.some(col => {
          if (col.key === "rawMaterials") {
            const materials = [
              { label: "al", price: row.aluminiumPrice },
              { label: "al alloy", price: row.aluminiumAlloyPrice },
              { label: "cu", price: row.copperTapePrice },
              { label: "semicon", price: row.extrudedSemiconductivePrice },
              { label: "xlpe", price: row.htXlpePrice },
              { label: "st-2", price: row.pvcTypeSt2Price },
              { label: "steel", price: row.galvanisedSteelFlatStripPrice },
              { label: "filler", price: row.fillerPrice }
            ];
            return materials.some(m =>
              m.price !== null && m.price !== undefined && m.price !== 0 &&
              (m.label.includes(q) || String(m.price).includes(q))
            );
          }
          const v = row[col.key];
          return v && String(v).toLowerCase().includes(q);
        })
      );
    }

    Object.entries(colSearches).forEach(([key, val]) => {
      const sVal = val.trim().toLowerCase();
      if (sVal) {
        rows = rows.filter(row => {
          if (key === "rawMaterials") {
            const materials = [
              { label: "al", price: row.aluminiumPrice },
              { label: "al alloy", price: row.aluminiumAlloyPrice },
              { label: "cu", price: row.copperTapePrice },
              { label: "semicon", price: row.extrudedSemiconductivePrice },
              { label: "xlpe", price: row.htXlpePrice },
              { label: "st-2", price: row.pvcTypeSt2Price },
              { label: "steel", price: row.galvanisedSteelFlatStripPrice },
              { label: "filler", price: row.fillerPrice }
            ];
            return materials.some(m =>
              m.price !== null && m.price !== undefined && m.price !== 0 &&
              (m.label.includes(sVal) || String(m.price).includes(sVal))
            );
          }
          const v = row[key as keyof SmartsheetTender];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(sVal);
        });
      }
    });

    if (!excludeKeys.includes("partyName") && selectedParties.length > 0) {
      rows = rows.filter(row => row.partyName && selectedParties.includes(row.partyName.trim()));
    }

    if (!excludeKeys.includes("itemName") && selectedItems.length > 0) {
      rows = rows.filter(row => {
        if (!row.proposedErpItemName) return false;
        const rowItems = row.proposedErpItemName.split(/\n+/).map(p => p.trim()).filter(Boolean);
        return rowItems.some(item => selectedItems.includes(item));
      });
    }

    if (!excludeKeys.includes("quotationNumber") && selectedQuotations.length > 0) {
      rows = rows.filter(row => row.quotationNumber && selectedQuotations.includes(row.quotationNumber.trim()));
    }

    if (!excludeKeys.includes("utility") && selectedUtilities.length > 0) {
      rows = rows.filter(row => row.utility && selectedUtilities.includes(row.utility.trim()));
    }

    if (!excludeKeys.includes("allocatedTo") && selectedAllocatedTo.length > 0) {
      rows = rows.filter(row => {
        const val = (row.docketNumber && allocatedToOverrides.hasOwnProperty(row.docketNumber))
          ? allocatedToOverrides[row.docketNumber]
          : row.allocatedTo;
        if (selectedAllocatedTo.includes("(blank)") && !val) return true;
        return val && selectedAllocatedTo.includes(val.trim());
      });
    }

    if (qtyMin.trim() !== "" || qtyMax.trim() !== "") {
      rows = rows.filter(row => {
        if (!row.proposedQty) return false;
        const nums = parseQuantities(row.proposedQty);
        if (nums.length === 0) return false;
        const minVal = qtyMin.trim() !== "" ? parseFloat(qtyMin) : Number.NEGATIVE_INFINITY;
        const maxVal = qtyMax.trim() !== "" ? parseFloat(qtyMax) : Number.POSITIVE_INFINITY;
        return nums.some(n => n >= minVal && n <= maxVal);
      });
    }

    if (enquiryStartDate) {
      const start = new Date(enquiryStartDate);
      rows = rows.filter(row => {
        if (!row.enquiryDate) return false;
        const d = new Date(row.enquiryDate);
        return d >= start;
      });
    }
    if (enquiryEndDate) {
      const end = new Date(enquiryEndDate);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.enquiryDate) return false;
        const d = new Date(row.enquiryDate);
        return d <= end;
      });
    }

    if (quotationStartDate) {
      const start = new Date(quotationStartDate);
      rows = rows.filter(row => {
        if (!row.quotationDate) return false;
        const d = new Date(row.quotationDate);
        return d >= start;
      });
    }
    if (quotationEndDate) {
      const end = new Date(quotationEndDate);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(row => {
        if (!row.quotationDate) return false;
        const d = new Date(row.quotationDate);
        return d <= end;
      });
    }

    if (!excludeKeys.includes("priceBasis") && priceBasisFilter !== "All") {
      rows = rows.filter(row => {
        const pb = row.priceBasis || "";
        return pb.toLowerCase() === priceBasisFilter.toLowerCase();
      });
    }

    if (alMin.trim() !== "" || alMax.trim() !== "") {
      rows = rows.filter(row => {
        if (row.aluminiumPrice === null || row.aluminiumPrice === undefined) return false;
        const minVal = alMin.trim() !== "" ? parseFloat(alMin) : Number.NEGATIVE_INFINITY;
        const maxVal = alMax.trim() !== "" ? parseFloat(alMax) : Number.POSITIVE_INFINITY;
        return row.aluminiumPrice >= minVal && row.aluminiumPrice <= maxVal;
      });
    }
    if (cuMin.trim() !== "" || cuMax.trim() !== "") {
      rows = rows.filter(row => {
        if (row.copperTapePrice === null || row.copperTapePrice === undefined) return false;
        const minVal = cuMin.trim() !== "" ? parseFloat(cuMin) : Number.NEGATIVE_INFINITY;
        const maxVal = cuMax.trim() !== "" ? parseFloat(cuMax) : Number.POSITIVE_INFINITY;
        return row.copperTapePrice >= minVal && row.copperTapePrice <= maxVal;
      });
    }

    return rows;
  }

  // Unique purchase types for sidebar/column filters
  const purchaseTypes = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["tenderPurchase"]);
    rows.forEach(r => { if (r.tenderPurchase) set.add(r.tenderPurchase); });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, selectedAccountHolders, selectedParties, selectedItems, selectedQuotations, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Unique price basis options for dropdown filter
  const priceBasisOptions = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["priceBasis"]);
    rows.forEach(r => { if (r.priceBasis) set.add(r.priceBasis); });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedParties, selectedItems, selectedQuotations, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, alMin, alMax, cuMin, cuMax]);

  // Unique account holders for dropdown filter
  const accountHolderOptions = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["accountHolder"]);
    rows.forEach(r => { if (r.accountHolder) set.add(r.accountHolder.trim()); });
    return Array.from(set).sort();
  }, [data, search, colSearches, tenderPurchaseFilter, selectedParties, selectedItems, selectedQuotations, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Unique party names for dropdown filter
  const partyNamesList = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["partyName"]);
    rows.forEach(r => { if (r.partyName) set.add(r.partyName.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedItems, selectedQuotations, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Unique item names for dropdown filter
  const itemNamesList = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["itemName"]);
    rows.forEach(r => {
      if (r.proposedErpItemName) {
        r.proposedErpItemName.split(/\n+/).forEach(item => {
          const trimmed = item.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedParties, selectedQuotations, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Unique quotation numbers for dropdown filter
  const quotationNumbersList = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["quotationNumber"]);
    rows.forEach(r => {
      if (r.quotationNumber) {
        const trimmed = r.quotationNumber.trim();
        if (trimmed) set.add(trimmed);
      }
    });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedParties, selectedItems, selectedUtilities, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Filter
  const filtered = useMemo<SmartsheetTender[]>(() => {
    return applyFilters(data, []);
  }, [
    data, 
    search, 
    colSearches, 
    tenderPurchaseFilter, 
    selectedAccountHolders,
    selectedParties,
    selectedItems,
    selectedQuotations,
    selectedUtilities,
    selectedAllocatedTo,
    qtyMin,
    qtyMax,
    enquiryStartDate, 
    enquiryEndDate, 
    quotationStartDate,
    quotationEndDate,
    priceBasisFilter, 
    alMin, 
    alMax, 
    cuMin, 
    cuMax
  ]);

  // Unique utilities for dropdown filter
  const utilitiesList = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["utility"]);
    rows.forEach(r => { if (r.utility) set.add(r.utility.trim()); });
    return ["All", ...Array.from(set).sort()];
  }, [data, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedParties, selectedItems, selectedQuotations, selectedAllocatedTo, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Unique allocatedTo values for dropdown filter
  const allocatedToList = useMemo(() => {
    const set = new Set<string>();
    const rows = applyFilters(data, ["allocatedTo"]);
    rows.forEach(r => {
      const val = (r.docketNumber && allocatedToOverrides.hasOwnProperty(r.docketNumber))
        ? allocatedToOverrides[r.docketNumber]
        : r.allocatedTo;
      if (val) set.add(val.trim());
    });
    const list = Array.from(set).sort();
    list.push("(blank)");
    return ["All", ...list];
  }, [data, allocatedToOverrides, search, colSearches, tenderPurchaseFilter, selectedAccountHolders, selectedParties, selectedItems, selectedQuotations, selectedUtilities, qtyMin, qtyMax, enquiryStartDate, enquiryEndDate, quotationStartDate, quotationEndDate, priceBasisFilter, alMin, alMax, cuMin, cuMax]);

  // Allocated To counts for assigned persons sidebar cards (cascading calculation)
  const allocatedToCounts = useMemo(() => {
    const rows = applyFilters(data, ["allocatedTo"]);
    const counts: Record<string, number> = {};
    rows.forEach(r => {
      const val = (r.docketNumber && allocatedToOverrides.hasOwnProperty(r.docketNumber))
        ? allocatedToOverrides[r.docketNumber]
        : r.allocatedTo;
      const person = val?.trim();
      if (person) {
        counts[person] = (counts[person] || 0) + 1;
      }
    });

    const allPersonsSet = new Set<string>();
    data.forEach(r => {
      const val = (r.docketNumber && allocatedToOverrides.hasOwnProperty(r.docketNumber))
        ? allocatedToOverrides[r.docketNumber]
        : r.allocatedTo;
      if (val?.trim()) {
        allPersonsSet.add(val.trim());
      }
    });

    return Array.from(allPersonsSet)
      .map(name => ({ name, count: counts[name] || 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [
    data,
    allocatedToOverrides,
    search,
    colSearches,
    tenderPurchaseFilter,
    selectedAccountHolders,
    selectedParties,
    selectedItems,
    selectedQuotations,
    selectedUtilities,
    qtyMin,
    qtyMax,
    enquiryStartDate,
    enquiryEndDate,
    quotationStartDate,
    quotationEndDate,
    priceBasisFilter,
    alMin,
    alMax,
    cuMin,
    cuMax
  ]);

  const handleAllocatedCardClick = (personName: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (selectedAllocatedTo.includes(personName)) {
        setSelectedAllocatedTo(selectedAllocatedTo.filter(p => p !== personName));
      } else {
        setSelectedAllocatedTo([...selectedAllocatedTo, personName]);
      }
    } else {
      if (selectedAllocatedTo.length === 1 && selectedAllocatedTo[0] === personName) {
        setSelectedAllocatedTo([]);
      } else {
        setSelectedAllocatedTo([personName]);
      }
    }
    setPage(1);
  };


  // Sort
  const sorted = useMemo<SmartsheetTender[]>(() => {
    return [...filtered].sort((a, b) => cmp(a[sortField], b[sortField], sortDir));
  }, [filtered, sortField, sortDir]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart  = (page - 1) * pageSize;
  const paginated  = sorted.slice(pageStart, pageStart + pageSize);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  const handleRefreshCosting = async () => {
    setCostingRefreshing(true);
    setCostingSummary(null);
    const json = await refreshCosting();
    if (json.success && json.summary) setCostingSummary(json.summary);
    setCostingRefreshing(false);
  };

  const handleScanCostingFiles = async () => {
    setScanningCosting(true);
    setScanSummary(null);
    try {
      const json = await scanCostingFiles();
      if (!json.success) {
        console.error("Failed to scan costing files:", json.error);
        return;
      }
      setScanSummary(json.scanSummary || null);
    } catch (err) {
      console.error("Failed to scan costing files:", err);
    } finally {
      setScanningCosting(false);
    }
  };

  const handlePushCostingToQueue = async () => {
    setPushingQueue(true);
    setQueueSummary(null);
    try {
      const json = await pushCostingToQueue();
      if (!json.success) {
        console.error("Failed to push costing to queue:", json.error);
        return;
      }
      setQueueSummary(json.queueSummary || null);
    } catch (err) {
      console.error("Failed to push costing to queue:", err);
    } finally {
      setPushingQueue(false);
    }
  };

  const handleExportExcel = () => {
    const tableHeader = COLUMNS.map(c => `<th style="background-color:#0a2540;color:#ffffff;font-weight:bold;padding:8px;border:1px solid #ddd;">${c.label}</th>`).join("");
    const tableRows = sorted.map(rec => {
      const cells = COLUMNS.map(col => {
        let val: any;
        if (col.key === "rawMaterials") {
          const activeRates = [
            { label: "Al", price: rec.aluminiumPrice },
            { label: "Al Alloy", price: rec.aluminiumAlloyPrice },
            { label: "Cu", price: rec.copperTapePrice },
            { label: "Semicon", price: rec.extrudedSemiconductivePrice },
            { label: "XLPE", price: rec.htXlpePrice },
            { label: "ST-2", price: rec.pvcTypeSt2Price },
            { label: "Steel", price: rec.galvanisedSteelFlatStripPrice },
            { label: "Filler", price: rec.fillerPrice }
          ].filter(m => m.price !== null && m.price !== undefined && m.price !== 0);
          val = activeRates.map(m => `${m.label}: ${m.price}`).join(" | ");
        } else {
          val = rec[col.key];
        }
        if (val === null || val === undefined) return "<td style='border:1px solid #ddd;padding:8px;'></td>";
        return `<td style='border:1px solid #ddd;padding:8px;'>${String(val)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-type" content="text/html;charset=utf-8" />
        <!--[if gte o4 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Enquiry to Quotation</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
      </head>
      <body>
        <table border="1" style="border-collapse:collapse;">
          <thead><tr>${tableHeader}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Enquiry_to_Quotation_Data_${new Date().toISOString().split('T')[0]}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const pageNumbers = (): (number | "...")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const ps: (number | "...")[] = [1];
    if (page > 3) ps.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) ps.push(i);
    if (page < totalPages - 2) ps.push("...");
    ps.push(totalPages);
    return ps;
  };

  // Sidebar stats
  const totalRecords   = data.length;
  const tenderCount    = data.filter(r => r.tenderPurchase?.toLowerCase().includes("tender")).length;
  const purchaseCount  = data.filter(r => r.tenderPurchase?.toLowerCase().includes("purchase")).length;
  const withQuotation  = data.filter(r => r.quotationNumber).length;

  return (
    <div className="tender-layout-container">
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside className="tender-sidebar">
        <div className="tender-sidebar-header">📋 Tender Dashboard</div>
        <div className="tender-sidebar-body">

          {/* Stats */}
          <div className="tender-stat-card">
            <div className="tender-stat-label">Total Records</div>
            <div className="tender-stat-value">{totalRecords.toLocaleString()}</div>
            <div className="tender-stat-sub">from Smartsheet</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">Tenders</div>
            <div className="tender-stat-value" style={{ color: "#ff6b6b" }}>{tenderCount.toLocaleString()}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">Purchases</div>
            <div className="tender-stat-value" style={{ color: "#38ef7d" }}>{purchaseCount.toLocaleString()}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">With Quotation</div>
            <div className="tender-stat-value" style={{ color: "#69b2ff" }}>{withQuotation.toLocaleString()}</div>
          </div>

          {/* Filters */}
          <div className="tender-filter-section">
            <div className="tender-filter-label">Type Filter</div>
            <select
              className="tender-filter-select"
              value={tenderPurchaseFilter}
              onChange={e => { setTenderPurchaseFilter(e.target.value); setPage(1); }}
            >
              {purchaseTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="tender-filter-section">
            <div className="tender-filter-label">Party Search</div>
            <input
              className="tender-filter-input"
              type="text"
              placeholder="Search party name..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          {/* Assigned Tenders By Person */}
          <div className="assigned-tenders-section">
            <div className="assigned-tenders-title">ASSIGNED TENDERS BY PERSON</div>
            {allocatedToCounts.length === 0 ? (
              <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.45)", fontStyle: "italic", padding: "4px 0" }}>
                {loading ? "Loading assigned persons..." : "No assigned persons found"}
              </div>
            ) : (
              allocatedToCounts.map(({ name, count }) => {
                const isActive = selectedAllocatedTo.includes(name);
                return (
                  <div
                    key={name}
                    className={`assigned-tender-card${isActive ? " active" : ""}`}
                    onClick={(e) => handleAllocatedCardClick(name, e)}
                    title={`Click to filter by ${name}`}
                  >
                    <span className="assigned-tender-name">{name}</span>
                    <span className="assigned-tender-count">{count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="tender-sidebar-footer">
          <button
            className="tender-refresh-sidebar-btn"
            onClick={handleRefresh}
            disabled={loading || syncing}
          >
            {syncing ? "🔄 Syncing..." : "🔄 Refresh Data"}
          </button>
          <button
            className="tender-refresh-sidebar-btn"
            onClick={handleRefreshCosting}
            disabled={loading || costingRefreshing}
            style={{ marginTop: 8 }}
          >
            {costingRefreshing ? "📎 Fetching..." : "📎 Refresh Costing"}
          </button>
          <button
            className="tender-refresh-sidebar-btn"
            onClick={handleScanCostingFiles}
            disabled={loading || scanningCosting}
            style={{ marginTop: 8 }}
          >
            {scanningCosting ? "📁 Scanning..." : "📁 Scan Costing Files"}
          </button>
          <button
            className="tender-refresh-sidebar-btn"
            onClick={handlePushCostingToQueue}
            disabled={loading || pushingQueue}
            style={{ marginTop: 8 }}
          >
            {pushingQueue ? "🚀 Pushing..." : "🚀 Push to Queue (Test)"}
          </button>
          {costingSummary && (
            <div style={{ fontSize: 11, color: "#5f6368", marginTop: 4, textAlign: "center" }}>
              Costing: {costingSummary.matched}/{costingSummary.total} records matched
            </div>
          )}
          {scanSummary && (
            <div style={{ fontSize: 11, color: "#5f6368", marginTop: 4, textAlign: "center" }}>
              Costing Files: {scanSummary.matched}/{scanSummary.scanned} found · {scanSummary.remaining} remaining
            </div>
          )}
          {queueSummary && (
            <div style={{ fontSize: 11, color: "#5f6368", marginTop: 4, textAlign: "center" }}>
              Queue: {queueSummary.published}/{queueSummary.total} logged (publish off)
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Workspace ──────────────────────────────────────────────── */}
      <div className="tender-workspace">
        {/* Header */}
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">LASERPOWER <span>TENDER</span></h1>
            <div className="tender-header-divider" />
            <span className="tender-header-subtitle">Smartsheet Dashboard</span>
          </div>
          <div className="tender-header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters}>
              🧹 Clear Filters
            </button>
            <a
              href="https://app.smartsheet.com/sheets/R95FFRH5rmHhQPqM2Qqxqv5rphRhFGmhqFMfRVC1?view=grid&filterId=2884071246221188"
              target="_blank"
              rel="noopener noreferrer"
              className="clear-filters-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Smartsheet
            </a>
            <button className="export-excel-btn" onClick={handleExportExcel}>
              📊 Export Excel
            </button>
            {/* <a
              href="http://192.168.0.230:2026/"
              target="_blank"
              rel="noopener noreferrer"
              className="ai-dashboard-btn"
            >
              🤖 AI Dashboard
            </a> */}
          </div>
        </header>

        {/* Body */}
        <main className="tender-body">
          {/* ── Loading ── */}
          {loading && (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <div className="smartsheet-spinner" />
                <span className="smartsheet-state-title">Fetching Smartsheet Data...</span>
                <span className="smartsheet-state-sub">Connecting to Smartsheet API and mapping columns.</span>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {!loading && error && (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <span className="smartsheet-state-icon">⚠️</span>
                <h3 className="smartsheet-error-title">Failed to Load Tender Data</h3>
                <p className="smartsheet-state-sub">{error.message}</p>
                <div className="smartsheet-error-code">{error.message}</div>
                <button className="smartsheet-retry-btn" onClick={() => window.location.reload()}>
                  Retry Connection
                </button>
              </div>
            </div>
          )}

          {/* ── Data Table ── */}
          {!loading && !error && (
            <div className="smartsheet-table-container">
              {/* Toolbar */}
              <div className="smartsheet-toolbar">
                <div className="smartsheet-toolbar-left">
                  <p className="smartsheet-table-title">Tender Records</p>
                  <span className="smartsheet-record-badge">
                    {filtered.length.toLocaleString()} of {data.length.toLocaleString()} Records
                  </span>
                  <div className="smartsheet-search-container">
                    <span className="smartsheet-search-icon">🔍</span>
                    <input
                      id="smartsheet-global-search"
                      type="text"
                      className="smartsheet-search-input"
                      placeholder="Search all columns..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                    />
                  </div>
                </div>
              </div>
 
              {/* Table — always rendered so headers stay visible */}
              <>
                  <div className="smartsheet-table-wrapper">
                    <table 
                      className="smartsheet-data-table"
                      style={{ width: COLUMNS.reduce((sum, col) => sum + colWidths[col.key], 0) }}
                    >
                      <thead>
                        <tr>
                          {COLUMNS.map((col, colIdx) => {
                            const isSticky = colIdx < 2;
                            const leftOffset = colIdx === 0 ? "0px" : (colIdx === 1 ? `${colWidths[COLUMNS[0].key]}px` : undefined);
                            const isDropdownOpen = 
                               (col.key === "utility" && showUtilityDropdown) ||
                               (col.key === "quotationNumber" && showQuotationDropdown) ||
                               (col.key === "partyName" && showPartyDropdown) ||
                               (col.key === "proposedErpItemName" && showItemDropdown) ||
                               (col.key === "accountHolder" && showAccountHolderDropdown) ||
                               (col.key === "allocatedTo" && showAllocatedToDropdown);
                             
                             const thClassName = [
                               isSticky ? `sticky-column-header sticky-col-${colIdx + 1}` : "",
                               isDropdownOpen ? "th-dropdown-open" : ""
                             ].filter(Boolean).join(" ");
                            return (
                              <th
                                key={col.key}
                                className={thClassName}
                                style={{ 
                                  width: colWidths[col.key], 
                                  minWidth: colWidths[col.key],
                                  position: "sticky",
                                  left: leftOffset,
                                  zIndex: isSticky ? 4 : 2,
                                }}
                              >
                                <div className="smartsheet-th-inner" onClick={() => handleSort(col.key)}>
                                  {col.label}
                                  <span className="smartsheet-sort-icon">
                                    {sortField === col.key
                                      ? sortDir === "asc" ? "▲" : "▼"
                                      : "⇅"}
                                  </span>
                                </div>
                                <div className="column-filter-container" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                  {col.key !== "attachmentUrl" && col.key !== "proposedQty" && col.key !== "enquiryDate" && col.key !== "quotationDate" && col.key !== "reverseAuctionApplicable" && col.key !== "cvaValue" && (
                                    <input
                                      type="text"
                                      className="column-search-input"
                                      placeholder="Search..."
                                      value={colSearches[col.key] || ""}
                                      onChange={e => handleColSearchChange(col.key, e.target.value)}
                                    />
                                  )}
                                {col.key === "utility" && (
                                  <div className="custom-multiselect-container" ref={utilityDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowUtilityDropdown(!showUtilityDropdown)}
                                      style={{ marginBottom: "4px" }}
                                    >
                                      {selectedUtilities.length === 0 ? "All Utilities" : `${selectedUtilities.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showUtilityDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedUtilities([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedUtilities(utilitiesList.filter(u => u !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {utilitiesList.filter(u => u !== "All").map(util => (
                                            <label key={util} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedUtilities.includes(util)}
                                                onChange={() => {
                                                  if (selectedUtilities.includes(util)) {
                                                    setSelectedUtilities(selectedUtilities.filter(u => u !== util));
                                                  } else {
                                                    setSelectedUtilities([...selectedUtilities, util]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{util}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "proposedQty" && (
                                  <div className="filter-row">
                                    <input
                                      type="number"
                                      placeholder="Min"
                                      className="col-price-filter-input"
                                      value={qtyMin}
                                      onChange={e => { setQtyMin(e.target.value); setPage(1); }}
                                      title="Tender Qty Min"
                                    />
                                    <span className="filter-row-dash">-</span>
                                    <input
                                      type="number"
                                      placeholder="Max"
                                      className="col-price-filter-input"
                                      value={qtyMax}
                                      onChange={e => { setQtyMax(e.target.value); setPage(1); }}
                                      title="Tender Qty Max"
                                    />
                                  </div>
                                )}
                                {col.key === "quotationNumber" && (
                                  <div className="custom-multiselect-container" ref={quotationDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowQuotationDropdown(!showQuotationDropdown)}
                                    >
                                      {selectedQuotations.length === 0 ? "All Quotations" : `${selectedQuotations.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showQuotationDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedQuotations([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedQuotations(quotationNumbersList.filter(q => q !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {quotationNumbersList.filter(q => q !== "All").map(qNum => (
                                            <label key={qNum} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedQuotations.includes(qNum)}
                                                onChange={() => {
                                                  if (selectedQuotations.includes(qNum)) {
                                                    setSelectedQuotations(selectedQuotations.filter(q => q !== qNum));
                                                  } else {
                                                    setSelectedQuotations([...selectedQuotations, qNum]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{qNum}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "partyName" && (
                                  <div className="custom-multiselect-container" ref={partyDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowPartyDropdown(!showPartyDropdown)}
                                    >
                                      {selectedParties.length === 0 ? "All Parties" : `${selectedParties.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showPartyDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedParties([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedParties(partyNamesList.filter(p => p !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {partyNamesList.filter(p => p !== "All").map(party => (
                                            <label key={party} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedParties.includes(party)}
                                                onChange={() => {
                                                  if (selectedParties.includes(party)) {
                                                    setSelectedParties(selectedParties.filter(p => p !== party));
                                                  } else {
                                                    setSelectedParties([...selectedParties, party]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{party}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "proposedErpItemName" && (
                                  <div className="custom-multiselect-container" ref={itemDropdownRef}>
                                    <button 
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowItemDropdown(!showItemDropdown)}
                                    >
                                      {selectedItems.length === 0 ? "All Items" : `${selectedItems.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showItemDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedItems([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedItems(itemNamesList.filter(p => p !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {itemNamesList.filter(p => p !== "All").map(item => (
                                            <label key={item} className="multiselect-option-label">
                                              <input 
                                                type="checkbox"
                                                checked={selectedItems.includes(item)}
                                                onChange={() => {
                                                  if (selectedItems.includes(item)) {
                                                    setSelectedItems(selectedItems.filter(i => i !== item));
                                                  } else {
                                                    setSelectedItems([...selectedItems, item]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span className="option-text" title={item}>{item}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "enquiryDate" && (
                                  <div className="column-date-filter">
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={enquiryStartDate}
                                      onChange={e => { setEnquiryStartDate(e.target.value); setPage(1); }}
                                      title="Start Date"
                                    />
                                    <span className="date-filter-to">to</span>
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={enquiryEndDate}
                                      onChange={e => { setEnquiryEndDate(e.target.value); setPage(1); }}
                                      title="End Date"
                                    />
                                    {(enquiryStartDate || enquiryEndDate) && (
                                      <button
                                        className="date-filter-clear-btn"
                                        onClick={() => {
                                          setEnquiryStartDate("");
                                          setEnquiryEndDate("");
                                          setPage(1);
                                        }}
                                        title="Clear date filter"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                )}
                                {col.key === "quotationDate" && (
                                  <div className="column-date-filter">
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={quotationStartDate}
                                      onChange={e => { setQuotationStartDate(e.target.value); setPage(1); }}
                                      title="Start Date"
                                    />
                                    <span className="date-filter-to">to</span>
                                    <input
                                      type="date"
                                      className="date-filter-input"
                                      value={quotationEndDate}
                                      onChange={e => { setQuotationEndDate(e.target.value); setPage(1); }}
                                      title="End Date"
                                    />
                                    {(quotationStartDate || quotationEndDate) && (
                                      <button
                                        className="date-filter-clear-btn"
                                        onClick={() => {
                                          setQuotationStartDate("");
                                          setQuotationEndDate("");
                                          setPage(1);
                                        }}
                                        title="Clear date filter"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                )}
                                {col.key === "tenderPurchase" && (
                                  <select
                                    className="price-basis-filter-select"
                                    value={tenderPurchaseFilter}
                                    onChange={e => { setTenderPurchaseFilter(e.target.value); setPage(1); }}
                                  >
                                    {purchaseTypes.map(t => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {col.key === "accountHolder" && (
                                  <div className="custom-multiselect-container" ref={accountHolderDropdownRef}>
                                    <button
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowAccountHolderDropdown(!showAccountHolderDropdown)}
                                    >
                                      {selectedAccountHolders.length === 0 ? "All Holders" : `${selectedAccountHolders.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showAccountHolderDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedAccountHolders([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedAccountHolders(accountHolderOptions); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {accountHolderOptions.map(holder => (
                                            <label key={holder} className="multiselect-option-label">
                                              <input
                                                type="checkbox"
                                                checked={selectedAccountHolders.includes(holder)}
                                                onChange={() => {
                                                  if (selectedAccountHolders.includes(holder)) {
                                                    setSelectedAccountHolders(selectedAccountHolders.filter(h => h !== holder));
                                                  } else {
                                                    setSelectedAccountHolders([...selectedAccountHolders, holder]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{holder}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "allocatedTo" && (
                                  <div className="custom-multiselect-container" ref={allocatedToDropdownRef}>
                                    <button
                                      className="multiselect-trigger-btn"
                                      onClick={() => setShowAllocatedToDropdown(!showAllocatedToDropdown)}
                                    >
                                      {selectedAllocatedTo.length === 0 ? "All Allocated" : `${selectedAllocatedTo.length} Selected`} <span className="dropdown-arrow">▼</span>
                                    </button>
                                    {showAllocatedToDropdown && (
                                      <div className="multiselect-dropdown-panel" style={{ left: 0, right: "auto", minWidth: "260px", maxWidth: "none" }}>
                                        <div className="multiselect-actions">
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedAllocatedTo([]); setPage(1); }}>Clear All</button>
                                          <button className="multiselect-action-btn" onClick={() => { setSelectedAllocatedTo(allocatedToList.filter(p => p !== "All")); setPage(1); }}>Select All</button>
                                        </div>
                                        <div className="multiselect-options-list">
                                          {allocatedToList.filter(p => p !== "All").map(item => (
                                            <label key={item} className="multiselect-option-label">
                                              <input
                                                type="checkbox"
                                                checked={selectedAllocatedTo.includes(item)}
                                                onChange={() => {
                                                  if (selectedAllocatedTo.includes(item)) {
                                                    setSelectedAllocatedTo(selectedAllocatedTo.filter(p => p !== item));
                                                  } else {
                                                    setSelectedAllocatedTo([...selectedAllocatedTo, item]);
                                                  }
                                                  setPage(1);
                                                }}
                                              />
                                              <span>{item}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {col.key === "priceBasis" && (
                                  <select
                                    className="price-basis-filter-select"
                                    value={priceBasisFilter}
                                    onChange={e => { setPriceBasisFilter(e.target.value); setPage(1); }}
                                  >
                                    {priceBasisOptions.map(t => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {col.key === "rawMaterials" && (
                                  <div className="column-raw-materials-filter">
                                    <div className="filter-row">
                                      <span className="filter-row-label">Al:</span>
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        className="col-price-filter-input"
                                        value={alMin}
                                        onChange={e => { setAlMin(e.target.value); setPage(1); }}
                                        title="Aluminium Min"
                                      />
                                      <span className="filter-row-dash">-</span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        className="col-price-filter-input"
                                        value={alMax}
                                        onChange={e => { setAlMax(e.target.value); setPage(1); }}
                                        title="Aluminium Max"
                                      />
                                    </div>
                                    <div className="filter-row" style={{ marginTop: "4px" }}>
                                      <span className="filter-row-label">Cu:</span>
                                      <input
                                        type="number"
                                        placeholder="Min"
                                        className="col-price-filter-input"
                                        value={cuMin}
                                        onChange={e => { setCuMin(e.target.value); setPage(1); }}
                                        title="Copper Min"
                                      />
                                      <span className="filter-row-dash">-</span>
                                      <input
                                        type="number"
                                        placeholder="Max"
                                        className="col-price-filter-input"
                                        value={cuMax}
                                        onChange={e => { setCuMax(e.target.value); setPage(1); }}
                                        title="Copper Max"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div
                                className="col-resize-handle"
                                onMouseDown={e => handleResizeStart(e, col.key)}
                              />
                            </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.length === 0 ? (
                          <tr>
                            <td
                              colSpan={COLUMNS.length}
                              style={{
                                textAlign: "center",
                                padding: "48px 20px",
                                color: "rgba(0,0,0,0.4)",
                                fontSize: "13px",
                                fontWeight: 500,
                              }}
                            >
                              📭&nbsp; No matching records found. Try adjusting your filters.
                            </td>
                          </tr>
                        ) : paginated.map((row, idx) => (
                          <tr key={pageStart + idx} className="smartsheet-row">
                            {/* Enquiry Date */}
                            <td
                              className="sticky-body-cell sticky-col-1"
                              style={{
                                left: "0px",
                                width: colWidths["enquiryDate"],
                                minWidth: colWidths["enquiryDate"],
                                maxWidth: colWidths["enquiryDate"]
                              }}
                            >
                              {row.enquiryDate
                                ? <span className="enquiry-date-badge">{formatDate(row.enquiryDate)}</span>
                                : <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Party Name */}
                            <td
                              className="sticky-body-cell sticky-col-2"
                              title={row.partyName ?? undefined}
                              style={{
                                left: `${colWidths["enquiryDate"]}px`,
                                width: colWidths["partyName"],
                                minWidth: colWidths["partyName"],
                                maxWidth: colWidths["partyName"]
                              }}
                            >
                              {row.partyName ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Docket Number */}
                            <td style={{ fontFamily: "monospace", fontWeight: 600, color: "#0a2540" }}>
                              {row.docketNumber ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Utility */}
                            <td title={row.utility ?? undefined}>
                              {row.utility ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Quotation Number */}
                            <td style={{ fontFamily: "monospace" }}>
                              {row.quotationNumber ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Contract Number */}
                            <td style={{ fontFamily: "monospace", fontWeight: 600, color: "#0a2540" }} title={row.contractNo ?? undefined}>
                              {row.contractNo ? (
                                row.contractNo.includes(",") ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    {row.contractNo.split(",").map((c) => c.trim()).filter(Boolean).map((c, i) => (
                                      <span key={i} style={{ display: "inline-block", background: "#e8f0fe", padding: "1px 5px", borderRadius: "3px", border: "1px solid #d2e3fc", fontSize: "11px", width: "fit-content" }}>{c}</span>
                                    ))}
                                  </div>
                                ) : row.contractNo
                              ) : <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Quotation Date */}
                            <td>
                              {row.quotationDate ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Account Holder */}
                            <td>
                              {row.accountHolder ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Allocated To */}
                            <td>
                              {editingAllocatedTo === row.docketNumber ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input
                                    type="text"
                                    className="allocated-edit-input"
                                    value={editAllocatedValue}
                                    autoFocus
                                    onChange={e => setEditAllocatedValue(e.target.value)}
                                    onBlur={() => row.docketNumber && handleSaveAllocatedTo(row.docketNumber)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                      } else if (e.key === "Escape") {
                                        setEditingAllocatedTo(null);
                                      }
                                    }}
                                  />
                                  {savingAllocated[row.docketNumber!] && (
                                    <span style={{ fontSize: 10, color: "#999" }}>...</span>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="allocated-to-display"
                                  onClick={() => {
                                    if (!row.docketNumber || savingAllocated[row.docketNumber]) return;
                                    setEditingAllocatedTo(row.docketNumber);
                                    setEditAllocatedValue(
                                      row.docketNumber && allocatedToOverrides.hasOwnProperty(row.docketNumber)
                                        ? allocatedToOverrides[row.docketNumber] ?? ""
                                        : row.allocatedTo ?? ""
                                    );
                                  }}
                                  title="Click to edit"
                                >
                                  {row.docketNumber && allocatedToOverrides.hasOwnProperty(row.docketNumber)
                                    ? allocatedToOverrides[row.docketNumber] ?? <span className="smartsheet-null-cell">—</span>
                                    : row.allocatedTo ?? <span className="smartsheet-null-cell">—</span>}
                                  {!savingAllocated[row.docketNumber!] && (
                                    <span className="allocated-edit-icon">✎</span>
                                  )}
                                </div>
                              )}
                            </td>
                            {/* Status */}
                            <td
                              className="col-status"
                              style={{
                                width: colWidths["status"],
                                minWidth: colWidths["status"],
                                maxWidth: colWidths["status"],
                              }}
                            >
                              {editingStatus === row.docketNumber ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input
                                    type="text"
                                    className="allocated-edit-input"
                                    value={editStatusValue}
                                    autoFocus
                                    onChange={e => setEditStatusValue(e.target.value)}
                                    onBlur={() => row.docketNumber && handleSaveStatus(row.docketNumber)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                      } else if (e.key === "Escape") {
                                        setEditingStatus(null);
                                      }
                                    }}
                                  />
                                  {savingStatus[row.docketNumber!] && (
                                    <span style={{ fontSize: 10, color: "#999" }}>...</span>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="allocated-to-display"
                                  onClick={() => {
                                    if (!row.docketNumber || savingStatus[row.docketNumber]) return;
                                    setEditingStatus(row.docketNumber);
                                    setEditStatusValue(
                                      row.docketNumber && statusOverrides.hasOwnProperty(row.docketNumber)
                                        ? statusOverrides[row.docketNumber] ?? ""
                                        : row.status ?? ""
                                    );
                                  }}
                                  title="Click to edit"
                                >
                                  <span className="status-text status-scroll-wrap">
                                    {row.docketNumber && statusOverrides.hasOwnProperty(row.docketNumber)
                                      ? statusOverrides[row.docketNumber] ?? <span className="smartsheet-null-cell">—</span>
                                      : row.status ?? <span className="smartsheet-null-cell">—</span>}
                                  </span>
                                  {!savingStatus[row.docketNumber!] && (
                                    <span className="allocated-edit-icon">✎</span>
                                  )}
                                </div>
                              )}
                            </td>
                            {/* Email Id */}
                            <td title={row.emailId ?? undefined} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {row.emailId ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Email Subject Line */}
                            <td title={row.emailSubjectLine ?? undefined} style={{ whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                              {row.emailSubjectLine ?? <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Contact No */}
                            <td
                              style={{
                                width: colWidths["contactNo"],
                                minWidth: colWidths["contactNo"],
                                maxWidth: colWidths["contactNo"],
                              }}
                            >
                              {editingContactNo === row.docketNumber ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input
                                    type="text"
                                    className="allocated-edit-input"
                                    value={editContactValue}
                                    autoFocus
                                    onChange={e => setEditContactValue(e.target.value)}
                                    onBlur={() => row.docketNumber && handleSaveContactNo(row.docketNumber)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                      } else if (e.key === "Escape") {
                                        setEditingContactNo(null);
                                      }
                                    }}
                                  />
                                  {savingContact[row.docketNumber!] && (
                                    <span style={{ fontSize: 10, color: "#999" }}>...</span>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="allocated-to-display"
                                  onClick={() => {
                                    if (!row.docketNumber || savingContact[row.docketNumber]) return;
                                    setEditingContactNo(row.docketNumber);
                                    setEditContactValue(
                                      row.docketNumber && contactNoOverrides.hasOwnProperty(row.docketNumber)
                                        ? contactNoOverrides[row.docketNumber] ?? ""
                                        : row.contactNo ?? ""
                                    );
                                  }}
                                  title="Click to edit"
                                >
                                  {row.docketNumber && contactNoOverrides.hasOwnProperty(row.docketNumber)
                                    ? contactNoOverrides[row.docketNumber] ?? <span className="smartsheet-null-cell">—</span>
                                    : row.contactNo ?? <span className="smartsheet-null-cell">—</span>}
                                  {!savingContact[row.docketNumber!] && (
                                    <span className="allocated-edit-icon">✎</span>
                                  )}
                                </div>
                              )}
                            </td>
                            {/* Reverse Auction */}
                            <td>
                              {(() => {
                                const effectiveVal = row.docketNumber && reverseAuctionOverrides.hasOwnProperty(row.docketNumber)
                                  ? reverseAuctionOverrides[row.docketNumber]
                                  : row.reverseAuctionApplicable;
                                return (
                                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    <button
                                      className={`ra-toggle-btn ${effectiveVal === "yes" ? "ra-yes" : "ra-inactive"}`}
                                      disabled={savingReverseAuction[row.docketNumber!]}
                                      onClick={() => row.docketNumber && handleSaveReverseAuction(row.docketNumber, "yes")}
                                    >
                                      Yes
                                    </button>
                                    <button
                                      className={`ra-toggle-btn ${effectiveVal === "no" ? "ra-no" : "ra-inactive"}`}
                                      disabled={savingReverseAuction[row.docketNumber!]}
                                      onClick={() => row.docketNumber && handleSaveReverseAuction(row.docketNumber, "no")}
                                    >
                                      No
                                    </button>
                                    {savingReverseAuction[row.docketNumber!] && (
                                      <span style={{ fontSize: 10, color: "#999" }}>...</span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            {/* CVA Value */}
                            <td className="col-cva-value" style={{ textAlign: "center" }}>
                              {(() => {
                                if (!row.cvaValue) return <span className="smartsheet-null-cell">—</span>;
                                const parts = row.cvaValue.split(/\n+/).map(p => p.trim()).filter(Boolean);
                                if (parts.length > 0) {
                                  return (
                                    <div className="tender-item-stack" style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                                      {parts.map((part, pIdx) => (
                                        <span className="tender-item-name-tag" key={pIdx} style={{ display: "inline-block", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return row.cvaValue;
                              })()}
                            </td>
                            {/* Tender Purchase */}
                            <td>
                              {row.tenderPurchase
                                ? <span className={`purchase-type-badge ${purchaseBadgeClass(row.tenderPurchase)}`}>
                                    {row.tenderPurchase}
                                  </span>
                                : <span className="smartsheet-null-cell">—</span>}
                            </td>
                            {/* Item Name */}
                            <td className="col-item-name text-pre-line" title={row.proposedErpItemName ?? undefined}>
                              {(() => {
                                if (!row.proposedErpItemName) return <span className="smartsheet-null-cell">—</span>;
                                const parts = row.proposedErpItemName.split(/\n+/).map(p => p.trim()).filter(Boolean);
                                if (parts.length > 0) {
                                  return (
                                    <div className="tender-item-stack" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                      {parts.map((part, pIdx) => (
                                        <span className="tender-item-name-tag" key={pIdx} style={{ display: "inline-block", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return row.proposedErpItemName;
                              })()}
                            </td>
                            {/* Tender Qty */}
                            <td className="col-tender-qty text-pre-line">
                              {(() => {
                                if (!row.proposedQty) return <span className="smartsheet-null-cell">—</span>;
                                const parts = row.proposedQty.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
                                if (parts.length > 0) {
                                  return (
                                    <div className="tender-qty-stack" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                      {parts.map((part, pIdx) => (
                                        <span className="tender-qty-item" key={pIdx} style={{ display: "inline-block", background: "#f1f3f4", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", border: "1px solid #dadce0", width: "fit-content", color: "#202124" }}>
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return row.proposedQty;
                              })()}
                            </td>
                            {/* Attachment */}
                            <td style={{ textAlign: "center" }}>
                              {row.attachmentUrl ? (
                                <a
                                  href={`/api/costing/download?docket=${encodeURIComponent(row.docketNumber || "")}`}
                                  className="table-attachment-btn"
                                  title="Open / Download Costing File"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ padding: "4px 8px", background: "#e8f0fe", color: "#1a73e8", border: "1px solid #d2e3fc", borderRadius: "4px", fontSize: "11px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-block" }}
                                >
                                  📎 Costing
                                </a>
                              ) : (
                                <span className="smartsheet-null-cell">—</span>
                              )}
                            </td>
                            {/* Price Basis */}
                            <td style={{ textAlign: "center" }}>
                              {row.priceBasis ? (
                                <span className="purchase-type-badge purchase" style={{ textTransform: "capitalize" }}>
                                  {row.priceBasis}
                                </span>
                              ) : (
                                <span className="smartsheet-null-cell">—</span>
                              )}
                            </td>
                            {/* Raw Materials */}
                            <td>
                              {(() => {
                                const activeRates = [
                                  { label: "Al", price: row.aluminiumPrice },
                                  { label: "Al Alloy", price: row.aluminiumAlloyPrice },
                                  { label: "Cu", price: row.copperTapePrice },
                                  { label: "Semicon", price: row.extrudedSemiconductivePrice },
                                  { label: "XLPE", price: row.htXlpePrice },
                                  { label: "ST-2", price: row.pvcTypeSt2Price },
                                  { label: "Steel", price: row.galvanisedSteelFlatStripPrice },
                                  { label: "Filler", price: row.fillerPrice }
                                ].filter(m => m.price !== null && m.price !== undefined && m.price !== 0);

                                return activeRates.length > 0 ? (
                                  <div className="raw-materials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2px", fontSize: "10px" }}>
                                    {activeRates.map(m => (
                                      <div className="material-rate-tag" key={m.label} title={`${m.label}: ₹${m.price}/kg`} style={{ background: "#f1f3f4", padding: "2px 4px", borderRadius: "3px", border: "1px solid #dadce0" }}>
                                        <span className="mat-lbl" style={{ fontWeight: 600, color: "#5f6368" }}>{m.label}:</span>
                                        <span className="mat-val" style={{ marginLeft: "2px", color: "#202124" }}>₹{m.price}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="smartsheet-null-cell">—</span>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <div className="smartsheet-table-footer">
                    <div className="smartsheet-footer-left">
                      <span>Rows per page:</span>
                      <select
                        className="smartsheet-rows-select"
                        value={pageSize}
                        onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                      >
                        {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="smartsheet-footer-center">
                      {pageStart + 1}–{Math.min(pageStart + pageSize, sorted.length)} of {sorted.length}
                    </div>
                    <div className="smartsheet-pagination">
                      <button className="smartsheet-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                      {pageNumbers().map((p, i) =>
                        p === "..." ? (
                          <span key={`e${i}`} style={{ padding: "0 4px", color: "#5f6368", fontSize: 12 }}>…</span>
                        ) : (
                          <button key={p} className={`smartsheet-page-btn${page === p ? " active" : ""}`} onClick={() => setPage(p as number)}>{p}</button>
                        )
                      )}
                      <button className="smartsheet-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                    </div>
                  </div>
                </>
            </div>
          )}
        </main>

        {/* Footer status bar */}
        <footer className="tender-status-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#137333" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#34a853", display: "inline-block", animation: "blink 1.5s infinite" }} />
              <span>SMARTSHEET LIVE</span>
            </div>
          </div>
          <div style={{ color: "#0a2540", textTransform: "uppercase", fontWeight: 700 }}>
            LASERPOWER TENDER SMARTSHEET PIPELINE
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ backgroundColor: "#e1e6eb", color: "#0a2540", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
              LASERPOWER ERP V2.1 PRO
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default TenderDashboardPage;
