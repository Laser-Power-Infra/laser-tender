import React, { useState, useMemo, useEffect } from "react";
import { useSalesContracts } from "../hooks/useSalesContracts";
import { SalesContract } from "../types/salesContract";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import "./TenderDashboard.css";

type SortField = keyof SalesContract;
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortField;
  label: string;
  width: number;
}

const COLUMNS: ColDef[] = [
  { key: "contractNumber",          label: "Contract No",         width: 140 },
  { key: "quotationNumber",         label: "Quotation Number",    width: 180 },
  { key: "contractDate",            label: "Contract Date",       width: 140 },
  { key: "customerName",            label: "Customer Name",       width: 200 },
  { key: "partyOrderNo",            label: "Party Order No",      width: 160 },
  { key: "partyOrderDate",          label: "Party Order Date",    width: 160 },
  { key: "itemCode",                label: "Item Code",           width: 130 },
  { key: "itemName",                label: "Item Name",           width: 220 },
  { key: "priceBasis",              label: "Price Basis",         width: 130 },
  { key: "deliveryDate",            label: "Delivery Date",       width: 140 },
  { key: "contractQty",             label: "Contract Qty",        width: 130 },
  { key: "netContractQty",          label: "Net Contract Qty",    width: 150 },
  { key: "rate",                    label: "Rate",                width: 120 },
  { key: "mfgClrnQty",              label: "Mfg Clrn Qty",        width: 130 },
  { key: "balanceContractQty",      label: "Balance Contract Qty",width: 170 },
  { key: "pendingOfferAgainstMC",   label: "Pending Offer MC",    width: 150 },
  { key: "pendingDIAgainstInspection", label: "Pending DI Insp",  width: 150 },
  { key: "pendingDIAgainstContract",   label: "Pending DI Cont",  width: 150 },
  { key: "balanceDispatchQty",      label: "Balance Dispatch Qty",width: 170 },
  { key: "cancelledQty",            label: "Cancelled Qty",       width: 140 },
  { key: "invoiceQty",              label: "Invoice Qty",         width: 130 },
  { key: "percentBalContractQty",   label: "% Bal Contract Qty",  width: 160 },
];

const SIDEBAR_FILTERS: { key: string; label: string }[] = [
  { key: "closedFlag", label: "Closed Flag" },
  { key: "itemScheduleName", label: "Item Schedule Name" },
  { key: "ourStaffName", label: "Our Staff Name" },
  { key: "accountClass", label: "Account Class" },
  { key: "basicValue", label: "Basic Value" },
];

const DATE_COLUMNS = new Set(["contractDate", "partyOrderDate", "deliveryDate"]);

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function cmp(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  const va = (a ?? "").toLowerCase();
  const vb = (b ?? "").toLowerCase();
  if (va < vb) return dir === "asc" ? -1 : 1;
  if (va > vb) return dir === "asc" ? 1 : -1;
  return 0;
}

function isNumericCell(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (s === "" || s === "-") return false;
  return /^-?\d{1,3}(,\d{3})*(\.\d+)?%?$/.test(s)
    || /^-?\d+(\.\d+)?%?$/.test(s)
    || /^-?\.\d+%?$/.test(s);
}

function parseNumeric(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().replace(/,/g, "").replace(/%$/, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function shouldShortClose(rec: SalesContract): boolean {
  const balance = parseNumeric(rec.balanceDispatchQty);
  const contractQty = parseNumeric(rec.contractQty);
  if (balance === null || contractQty === null) return false;
  return balance < 0.5 && balance < 0.02 * contractQty;
}

function displayValue(rec: SalesContract, key: string): string {
  if (key === "percentBalContractQty" && shouldShortClose(rec)) {
    return "TO BE SHORT CLOSED";
  }
  if (key === "basicValue") {
    const num = parseNumeric(rec.basicValue);
    if (num === null) return "";
    if (num > 100000) {
      return `${(Math.round((num / 10000000) * 10000) / 10000)} Cr.`;
    }
    return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  const raw = rec[key as keyof SalesContract];
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export const SalesContractPage: React.FC = () => {
  const { data, loading, error, refresh } = useSalesContracts();

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("contractNumber");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [openSidebarDropdown, setOpenSidebarDropdown] = useState<string | null>(null);

  const [contractDateStart, setContractDateStart] = useState("");
  const [contractDateEnd, setContractDateEnd] = useState("");
  const [partyOrderDateStart, setPartyOrderDateStart] = useState("");
  const [partyOrderDateEnd, setPartyOrderDateEnd] = useState("");
  const [deliveryDateStart, setDeliveryDateStart] = useState("");
  const [deliveryDateEnd, setDeliveryDateEnd] = useState("");

  const [basicValueMin, setBasicValueMin] = useState("");
  const [basicValueMax, setBasicValueMax] = useState("");

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    COLUMNS.forEach(col => { widths[col.key] = col.width; });
    return widths;
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (openDropdown) {
        if (document.querySelector(".dropdown-panel-open")?.contains(target)) return;
        if ((target as Element)?.closest(".multiselect-trigger-btn")) return;
        setOpenDropdown(null);
      }
      if (openSidebarDropdown) {
        const panel = document.getElementById("sidebar-dropdown-panel");
        if (panel?.contains(target)) return;
        if ((target as Element)?.closest(".sidebar-filter-trigger")) return;
        setOpenSidebarDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown, openSidebarDropdown]);

  const handleColFilterToggle = (key: string, value: string) => {
    setColumnFilters(prev => {
      const current = prev[key] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [key]: next.length > 0 ? next : [] };
    });
    setPage(1);
  };

  const handleClearColumnFilter = (key: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  };

  const handleResizeStart = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey];
    const handleMouseMove = (moveEvent: MouseEvent) => {
      setColWidths(prev => ({
        ...prev,
        [colKey]: Math.max(60, startWidth + moveEvent.clientX - startX),
      }));
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleClearAllFilters = () => {
    setSearch("");
    setColumnFilters({});
    setContractDateStart("");
    setContractDateEnd("");
    setPartyOrderDateStart("");
    setPartyOrderDateEnd("");
    setDeliveryDateStart("");
    setDeliveryDateEnd("");
    setBasicValueMin("");
    setBasicValueMax("");
    setPage(1);
  };

  const allFilterKeys = useMemo(() => {
    const keys: string[] = COLUMNS.map(c => c.key).filter(k => !DATE_COLUMNS.has(k));
    SIDEBAR_FILTERS.forEach(sf => { if (!keys.includes(sf.key)) keys.push(sf.key); });
    return keys;
  }, []);

  function applyAllFilters(rows: SalesContract[], excludeFieldKeys: string[] = []): SalesContract[] {
    let r = rows;

    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter(row =>
        COLUMNS.some(col => {
          const v = displayValue(row, col.key);
          return v !== "" && v.toLowerCase().includes(q);
        })
      );
    }

    Object.entries(columnFilters).forEach(([key, selected]) => {
      if (excludeFieldKeys.includes(key)) return;
      if (key === "basicValue") return;
      if (selected.length > 0) {
        r = r.filter(row => {
          const v = displayValue(row, key);
          return v !== "" && selected.includes(v);
        });
      }
    });

    if (!excludeFieldKeys.includes("basicValue")) {
      const min = parseNumeric(basicValueMin);
      const max = parseNumeric(basicValueMax);
      if (min !== null || max !== null) {
        r = r.filter(row => {
          const v = parseNumeric(row.basicValue);
          if (v === null) return false;
          const crore = v / 10000000;
          if (min !== null && crore < min) return false;
          if (max !== null && crore > max) return false;
          return true;
        });
      }
    }

    if (!excludeFieldKeys.includes("contractDate")) {
      r = applyDateFilter(r, "contractDate", contractDateStart, contractDateEnd);
    }
    if (!excludeFieldKeys.includes("partyOrderDate")) {
      r = applyDateFilter(r, "partyOrderDate", partyOrderDateStart, partyOrderDateEnd);
    }
    if (!excludeFieldKeys.includes("deliveryDate")) {
      r = applyDateFilter(r, "deliveryDate", deliveryDateStart, deliveryDateEnd);
    }

    return r;
  }

  function applyDateFilter(rows: SalesContract[], field: keyof SalesContract, start: string, end: string): SalesContract[] {
    let r = rows;
    if (start) {
      const s = new Date(start);
      r = r.filter(row => {
        const v = row[field];
        if (!v) return false;
        const d = new Date(v);
        return d >= s;
      });
    }
    if (end) {
      const e = new Date(end);
      e.setHours(23, 59, 59, 999);
      r = r.filter(row => {
        const v = row[field];
        if (!v) return false;
        const d = new Date(v);
        return d <= e;
      });
    }
    return r;
  }

  const cascadingUniqueValues = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    allFilterKeys.forEach(key => {
      const base = applyAllFilters(data, [key]);
      const set = new Set<string>();
      base.forEach(row => {
        const v = displayValue(row, key);
        if (v !== "") set.add(v);
      });
      map[key] = Array.from(set).sort();
    });
    return map;
  }, [data, search, columnFilters, contractDateStart, contractDateEnd, partyOrderDateStart, partyOrderDateEnd, deliveryDateStart, deliveryDateEnd, basicValueMin, basicValueMax]);

  const filtered = useMemo<SalesContract[]>(() => {
    return applyAllFilters(data, []);
  }, [data, search, columnFilters, contractDateStart, contractDateEnd, partyOrderDateStart, partyOrderDateEnd, deliveryDateStart, deliveryDateEnd, basicValueMin, basicValueMax]);

  const sorted = useMemo<SalesContract[]>(() => {
    return [...filtered].sort((a, b) => cmp(displayValue(a, sortField), displayValue(b, sortField), sortDir));
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const paginated = sorted.slice(pageStart, pageStart + pageSize);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  const handleRefresh = async () => { setPage(1); await refresh(); };

  const handleExportExcel = () => {
    const tableHeader = COLUMNS.map(c =>
      `<th style="background-color:#0a2540;color:#ffffff;font-weight:bold;padding:8px;border:1px solid #ddd;">${c.label}</th>`
    ).join("");
    const tableRows = sorted.map(rec => {
      const cells = COLUMNS.map(col => {
        const val = rec[col.key];
        if (val === null || val === undefined) return "<td style='border:1px solid #ddd;padding:8px;'></td>";
        return `<td style='border:1px solid #ddd;padding:8px;'>${String(val)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const excelHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"></head>
<body><table>${tableHeader}${tableRows}</table></body></html>`;

    const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SalesContract_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const computeStats = () => {
    const total = sorted.length;
    const withRate = sorted.filter(r => r.rate !== null && r.rate !== "").length;
    const withBalance = sorted.filter(r => r.balanceContractQty !== null && r.balanceContractQty !== "").length;
    return { total, withRate, withBalance };
  };

  const stats = useMemo(computeStats, [sorted]);

  const sortIndicator = (field: SortField) => {
    if (field !== sortField) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const activeFilterCount = Object.values(columnFilters).reduce((sum, arr) => sum + arr.length, 0)
    + (contractDateStart || contractDateEnd ? 1 : 0)
    + (partyOrderDateStart || partyOrderDateEnd ? 1 : 0)
    + (deliveryDateStart || deliveryDateEnd ? 1 : 0)
    + (basicValueMin || basicValueMax ? 1 : 0);

  const showDateFilter = (start: string, end: string, setStart: (v: string) => void, setEnd: (v: string) => void) => (
    <div className="column-date-filter">
      <input
        type="date"
        className="date-filter-input"
        value={start}
        onChange={e => { setStart(e.target.value); setPage(1); }}
        title="Start Date"
      />
      <span className="date-filter-to">to</span>
      <input
        type="date"
        className="date-filter-input"
        value={end}
        onChange={e => { setEnd(e.target.value); setPage(1); }}
        title="End Date"
      />
      {(start || end) && (
        <button
          className="date-filter-clear-btn"
          onClick={() => { setStart(""); setEnd(""); setPage(1); }}
          title="Clear date filter"
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div className="tender-layout-container">
      <aside className="tender-sidebar">
        <div className="tender-sidebar-header">Sales Contract</div>
        <div className="tender-sidebar-body">
          <div className="tender-stat-card">
            <div className="tender-stat-label">Total Records</div>
            <div className="tender-stat-value">{stats.total}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">With Rate</div>
            <div className="tender-stat-value" style={{ fontSize: 18 }}>{stats.withRate}</div>
          </div>
          <div className="tender-stat-card">
            <div className="tender-stat-label">With Balance Qty</div>
            <div className="tender-stat-value" style={{ fontSize: 18 }}>{stats.withBalance}</div>
          </div>
          <div className="tender-filter-section">
            <span className="tender-filter-label">Search</span>
            <input
              className="tender-filter-input"
              placeholder="Search all fields..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          {SIDEBAR_FILTERS.map(sf => {
            const selected = columnFilters[sf.key] || [];
            const isOpen = openSidebarDropdown === sf.key;
            return (
              <div key={sf.key} className="tender-filter-section">
                <span className="tender-filter-label">{sf.label}</span>
                {sf.key === "basicValue" ? (
                  <div className="basic-value-range">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="tender-filter-input"
                      placeholder="Min (Cr.)"
                      value={basicValueMin}
                      onChange={e => { setBasicValueMin(e.target.value); setPage(1); }}
                    />
                    <span className="basic-value-range-to">to</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="tender-filter-input"
                      placeholder="Max (Cr.)"
                      value={basicValueMax}
                      onChange={e => { setBasicValueMax(e.target.value); setPage(1); }}
                    />
                  </div>
                ) : (
                  <MultiSelectDropdown
                    selected={selected}
                    options={cascadingUniqueValues[sf.key] || []}
                    isOpen={isOpen}
                    onToggle={val => handleColFilterToggle(sf.key, val)}
                    onClear={() => { handleClearColumnFilter(sf.key); setOpenSidebarDropdown(null); }}
                    onSelectAll={() => { setColumnFilters(prev => ({ ...prev, [sf.key]: [...(cascadingUniqueValues[sf.key] || [])] })); setPage(1); setOpenSidebarDropdown(null); }}
                    onToggleOpen={() => setOpenSidebarDropdown(isOpen ? null : sf.key)}
                    panelId="sidebar-dropdown-panel"
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="tender-sidebar-footer">
          <button className="tender-refresh-sidebar-btn" onClick={handleRefresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
      </aside>

      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h2 className="tender-header-title">Sales <span>Contract</span></h2>
            <div className="tender-header-divider" />
            <span className="tender-header-subtitle">Dashboard</span>
          </div>
          <div className="tender-header-actions">
            <button className="clear-filters-btn" onClick={handleClearAllFilters}>
              Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""} Filters
            </button>
            <button className="export-excel-btn" onClick={handleExportExcel}>
              Export Excel
            </button>
          </div>
        </header>

        <main className="tender-body">
          {loading && (
            <div className="smartsheet-state-wrapper">
              <div className="smartsheet-spinner" />
              <p className="smartsheet-state-title">Loading Sales Contracts...</p>
            </div>
          )}
          {error && (
            <div className="smartsheet-state-wrapper">
              <div className="smartsheet-state-icon" style={{ color: "#c5221f" }}>!</div>
              <p className="smartsheet-error-title">Failed to load data</p>
              <div className="smartsheet-error-code">{error.message}</div>
              <button className="smartsheet-retry-btn" onClick={handleRefresh}>Retry</button>
            </div>
          )}
          {!loading && !error && (
            <div className="smartsheet-table-container">
              <div className="smartsheet-toolbar">
                <div className="smartsheet-toolbar-left">
                  <h3 className="smartsheet-table-title">Sales Contracts</h3>
                  <span className="smartsheet-record-badge">{sorted.length} records</span>
                </div>
              </div>
              <div className="smartsheet-table-wrapper">
                <table className="smartsheet-data-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(col => {
                        const selected = columnFilters[col.key] || [];
                        const isDateCol = DATE_COLUMNS.has(col.key);
                        return (
                          <th
                            key={col.key}
                            className={openDropdown === col.key ? "th-dropdown-open" : ""}
                            style={{ width: colWidths[col.key] }}
                            onClick={() => handleSort(col.key)}
                          >
                            <div className="smartsheet-th-inner">
                              <span>{col.label}{sortIndicator(col.key)}</span>
                              <span className="smartsheet-sort-icon">
                                {sortField === col.key ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </div>
                            <div className="column-filter-container" style={{ position: "relative" }}>
                              {isDateCol ? (
                                col.key === "contractDate" ? showDateFilter(contractDateStart, contractDateEnd, setContractDateStart, setContractDateEnd)
                                : col.key === "partyOrderDate" ? showDateFilter(partyOrderDateStart, partyOrderDateEnd, setPartyOrderDateStart, setPartyOrderDateEnd)
                                : showDateFilter(deliveryDateStart, deliveryDateEnd, setDeliveryDateStart, setDeliveryDateEnd)
                              ) : (
                                <MultiSelectDropdown
                                  selected={selected}
                                  options={cascadingUniqueValues[col.key] || []}
                                  isOpen={openDropdown === col.key}
                                  onToggle={val => handleColFilterToggle(col.key, val)}
                                  onClear={() => { handleClearColumnFilter(col.key); setOpenDropdown(null); }}
                                  onSelectAll={() => { setColumnFilters(prev => ({ ...prev, [col.key]: [...(cascadingUniqueValues[col.key] || [])] })); setPage(1); setOpenDropdown(null); }}
                                  onToggleOpen={() => setOpenDropdown(openDropdown === col.key ? null : col.key)}
                                />
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
                    {paginated.map((rec, idx) => (
                      <tr key={rec.id ?? idx} className="smartsheet-row">
                        {COLUMNS.map(col => {
                          const raw = rec[col.key];
                          const isShortClose = col.key === "percentBalContractQty" && shouldShortClose(rec);
                          const isEmpty = raw === null || raw === undefined || raw === "";
                          const isNumeric = isNumericCell(raw);
                          return (
                            <td
                              key={col.key}
                              style={{ width: colWidths[col.key], textAlign: isShortClose || !isNumeric ? "center" : "right" }}
                            >
                              {isShortClose ? (
                                <span className="short-close-badge">TO BE SHORT CLOSED</span>
                              ) : isEmpty ? (
                                <span className="smartsheet-null-cell">-</span>
                              ) : (
                                String(raw)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                  <button
                    className="smartsheet-page-btn"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        className={`smartsheet-page-btn${pageNum === page ? " active" : ""}`}
                        onClick={() => setPage(pageNum)}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    className="smartsheet-page-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        <footer className="tender-status-bar">
          <span>Sales Contract Dashboard</span>
          <span>{sorted.length} records • Page {page} of {totalPages}</span>
        </footer>
      </div>
    </div>
  );
};

export default SalesContractPage;
