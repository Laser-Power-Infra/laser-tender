"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ColumnFilter } from "@/components/ColumnFilter";
import { filterRows, columnOptions } from "@/lib/tableFilter";

export interface FilterTableRow {
  text: string[];        // one plain value per column: what search and the dropdowns work on
  cells?: ReactNode[];   // optional rich cell per column; falls back to the text
}

const PAGE_SIZE = 100;
// shortcut: a dropdown lists at most this many values (type in its box to narrow); raise or virtualise if users need more at once.
const MAX_OPTIONS = 500;

/** Read-only table with a search box, and on every column a search field plus a value dropdown. All filtering is in the browser. */
export function FilterTable({ title, badge, cols, rows }: { title: string; badge?: string; cols: { label: string; width?: number }[]; rows: FilterTableRow[] }) {
  const [q, setQ] = useState("");
  const [searches, setSearches] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[][]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [panelSearch, setPanelSearch] = useState("");
  const [page, setPage] = useState(1);

  const texts = useMemo(() => rows.map(r => r.text), [rows]);
  const visible = useMemo(() => filterRows(texts, q, searches, selected), [texts, q, searches, selected]);
  // Options only for the open dropdown, from the rows that pass every other filter.
  const options = useMemo(() => {
    if (open == null) return [];
    const p = panelSearch.trim().toLowerCase();
    const all = columnOptions(texts, filterRows(texts, q, searches, selected, open), open);
    return (p ? all.filter(o => o.toLowerCase().includes(p)) : all).slice(0, MAX_OPTIONS);
  }, [open, panelSearch, texts, q, searches, selected]);

  useEffect(() => {
    const close = () => setOpen(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const setAt = <T,>(list: T[], i: number, v: T, empty: T) => { const next = cols.map((_, c) => list[c] ?? empty); next[i] = v; return next; };
  const setSel = (c: number, v: string[]) => { setSelected(prev => setAt(prev, c, v, [])); setPage(1); };
  const filtered = q.trim() !== "" || searches.some(s => s?.trim()) || selected.some(s => s?.length);
  const clearAll = () => { setQ(""); setSearches([]); setSelected([]); setOpen(null); setPage(1); };
  // Every row that passes the filters (not just this page). xlsx is loaded on click so it stays out of the page bundle.
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols.map(c => c.label), ...visible.map(i => rows[i].text)]), "Data");
    XLSX.writeFile(wb, `${title.replace(/[\\/:*?"<>|]/g, " ").trim()}.xlsx`);
  };

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const minWidth = cols.reduce((a, c) => a + (c.width ?? 160), 0);

  return (
    <div className="smartsheet-table-container">
      <div className="smartsheet-toolbar">
        <div className="smartsheet-toolbar-left">
          <h2 className="smartsheet-table-title">{title}</h2>
          <span className="smartsheet-record-badge" role="status">
            {filtered ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`}{badge ? ` · ${badge}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            aria-label={`Search ${title}`}
            placeholder="Search all columns..."
            className="smartsheet-search-input"
            style={{ paddingLeft: 12, width: 240 }}
          />
          {filtered && <button type="button" className="smartsheet-page-btn" onClick={clearAll}>Clear filters</button>}
          <button type="button" className="smartsheet-page-btn" disabled={visible.length === 0} onClick={exportExcel}>Export to Excel</button>
        </div>
      </div>

      <div className="smartsheet-table-wrapper">
        <table className="smartsheet-data-table" style={{ minWidth }}>
          <thead>
            <tr>
              {cols.map((col, c) => (
                <th key={col.label} scope="col" className={open === c ? "th-dropdown-open" : ""} style={{ width: col.width, cursor: "default" }}>
                  <div className="smartsheet-th-inner"><span>{col.label}</span></div>
                  <div className="column-filter-container" style={{ position: "relative" }}>
                    <ColumnFilter
                      searchValue={searches[c] ?? ""}
                      onSearchChange={v => { setSearches(prev => setAt(prev, c, v, "")); setPage(1); }}
                      selected={selected[c] ?? []}
                      options={open === c ? options : []}
                      isOpen={open === c}
                      onToggleOpen={() => { setPanelSearch(""); setOpen(open === c ? null : c); }}
                      onToggle={val => setSel(c, (selected[c] ?? []).includes(val) ? (selected[c] ?? []).filter(x => x !== val) : [...(selected[c] ?? []), val])}
                      onClear={() => { setSel(c, []); setOpen(null); }}
                      onSelectAll={() => { setSel(c, options); setOpen(null); }}
                      placeholder={`Search ${col.label}...`}
                      panelSearchValue={open === c ? panelSearch : ""}
                      onPanelSearchChange={setPanelSearch}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(i => (
              <tr key={i} className="smartsheet-row">
                {cols.map((col, c) => {
                  const text = rows[i].text[c];
                  return <td key={col.label} title={rows[i].cells ? undefined : text || undefined}>{rows[i].cells?.[c] ?? (text || <span className="smartsheet-null-cell">-</span>)}</td>;
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 24 }} role="status">No rows match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="smartsheet-table-footer">
        <div className="smartsheet-footer-left">Page {current} of {pages} · {PAGE_SIZE} rows per page</div>
        <div className="smartsheet-pagination">
          <button type="button" className="smartsheet-page-btn" disabled={current <= 1} onClick={() => setPage(current - 1)}>‹ Previous</button>
          <button type="button" className="smartsheet-page-btn" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next ›</button>
        </div>
      </div>
    </div>
  );
}
