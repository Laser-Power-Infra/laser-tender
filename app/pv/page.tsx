// "PV PROV open contracts": our PV per unit next to the sheet's own PV VALUE. Read-only, reads the synced Circulars tabs.
import { pool } from "@/lib/prisma";
import { mapPvRows, summarizePvRows, type PvRow, type SheetRow } from "@/lib/pvSheet";
import { FilterTable, type FilterTableRow } from "@/components/FilterTable";

export const dynamic = "force-dynamic";

const TABS = ["PV PROV open contracts", "PV ITEM FACTORS", "PV INDEX MONTHLY"];

/** null = not synced yet (table missing, or one of the three tabs is empty). */
async function loadRows(): Promise<PvRow[] | null> {
  let rows: { tab_name: string; data: SheetRow }[];
  try {
    ({ rows } = await pool.query("SELECT tab_name, data FROM sheet_snapshot WHERE sheet_key = 'CIRCULARS' AND tab_name = ANY($1) ORDER BY row_no", [TABS]));
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return null;
    throw e;
  }
  const [contracts, factors, index] = TABS.map(t => rows.filter(r => r.tab_name === t).map(r => r.data));
  if (!contracts.length || !factors.length || !index.length) return null;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);      // IST calendar date
  return mapPvRows(contracts, factors, index, today);
}

const inr = (n: number | null) => (n == null ? null : n.toLocaleString("en-IN"));
const COLS: [string, number][] = [
  ["Contract", 120], ["Item", 300], ["Lot", 80], ["Base date", 100], ["Applicable date", 120], ["Sheet PV", 170], ["Computed PV", 120],
  ["Difference", 110], ["% PV", 80], ["Recommendation", 380], ["Warnings", 460],
];
const wrap = { whiteSpace: "normal" } as const, right = { textAlign: "right" } as const;
const dash = <span className="smartsheet-null-cell">-</span>;

/** text = what the column filters and search see; cells = the rich rendering. */
function tableRow(r: PvRow): FilterTableRow {
  return {
    text: [
      r.contract, `${r.itemCode} · ${r.itemName}`, r.lot || "", r.baseDate ?? "MISSING", r.applicableDate ?? "",
      r.sheetPv == null ? r.sheetPvText || "" : inr(r.sheetPv) ?? "", r.pv == null ? "" : inr(r.pvCapped) ?? "", r.diff == null ? "" : inr(r.diff) ?? "",
      r.pctPv == null ? "" : `${(r.pctPv * 100).toFixed(2)}%`, [r.advice, r.sheetAdvice].filter(Boolean).join(" | "), [r.note, ...r.warnings].filter(Boolean).join(" | "),
    ],
    cells: [
      <div title={r.customer}>{r.contract}</div>,
      <div title={r.itemName}>{r.itemCode} · {r.itemName}</div>,
      <div>{r.lot || dash}</div>,
      <div>{r.baseDate ?? <span className="short-close-badge">MISSING</span>}</div>,
      <div>{r.applicableDate ?? dash}</div>,
      <div style={r.sheetPv == null ? wrap : right}>{r.sheetPv == null ? r.sheetPvText || dash : inr(r.sheetPv)}</div>,
      <div style={right}>
        {r.pv == null ? dash : inr(r.pvCapped)}
        {r.ceilingApplied && <div className="smartsheet-null-cell">ceiling applied (uncapped {inr(r.pv)})</div>}
      </div>,
      <div style={right}>
        {r.status === "DIFFER" ? <span className="short-close-badge">{inr(r.diff)}</span> : r.diff == null ? dash : inr(r.diff)}
      </div>,
      <div style={right}>{r.pctPv == null ? dash : `${(r.pctPv * 100).toFixed(2)}%`}</div>,
      <div style={wrap}>
        {r.advice ?? dash}
        {r.sheetAdvice && <div className="smartsheet-null-cell">sheet: {r.sheetAdvice}</div>}
      </div>,
      <div style={wrap}>
        {r.note && <span className="short-close-badge" style={wrap}>{r.note}</span>}
        {r.warnings.map(w => <div key={w}>{w}</div>)}
        {!r.note && !r.warnings.length && dash}
      </div>,
    ],
  };
}

export default async function PvPage() {
  const rows = await loadRows();
  return (
    <div className="tender-layout-container">
      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h2 className="tender-header-title">PV PROV <span>open contracts</span></h2>
            <div className="tender-header-divider" />
            <span className="tender-header-subtitle">Price variation</span>
          </div>
        </header>
        <main className="tender-body">
          {!rows ? (
            <div className="smartsheet-state-wrapper">
              <p className="smartsheet-state-title">PV sheets not synced yet</p>
              <p className="smartsheet-state-sub">
                Run <code>npm run sync:gsheets</code> to load the Circulars tabs ({TABS.join(", ")}) into the database, then reload this page.
              </p>
            </div>
          ) : (
            <FilterTable title="PV per unit: sheet vs computed" badge={summarizePvRows(rows)} cols={COLS.map(([label, width]) => ({ label, width }))} rows={rows.map(tableRow)} />
          )}
        </main>
      </div>
    </div>
  );
}
