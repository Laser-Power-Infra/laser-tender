// "PV PROV open contracts": our PV per unit next to the sheet's own PV VALUE. Read-only, reads the synced Circulars tabs.
import { pool } from "@/lib/prisma";
import { mapPvRows, summarizePvRows, type PvRow, type SheetRow } from "@/lib/pvSheet";

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
            <div className="smartsheet-table-container">
              <div className="smartsheet-toolbar">
                <div className="smartsheet-toolbar-left">
                  <h3 className="smartsheet-table-title">PV per unit: sheet vs computed</h3>
                  <span className="smartsheet-record-badge">{summarizePvRows(rows)}</span>
                </div>
              </div>
              <div className="smartsheet-table-wrapper">
                <table className="smartsheet-data-table" style={{ minWidth: COLS.reduce((a, [, w]) => a + w, 0) }}>
                  <thead>
                    <tr>{COLS.map(([label, width]) => <th key={label} style={{ width, cursor: "default" }}>{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.key}#${i}`} className="smartsheet-row">
                        <td title={r.customer}>{r.contract}</td>
                        <td title={r.itemName}>{r.itemCode} · {r.itemName}</td>
                        <td>{r.lot || dash}</td>
                        <td>{r.baseDate ?? <span className="short-close-badge">MISSING</span>}</td>
                        <td>{r.applicableDate ?? dash}</td>
                        <td style={r.sheetPv == null ? wrap : right}>{r.sheetPv == null ? r.sheetPvText || dash : inr(r.sheetPv)}</td>
                        <td style={right}>
                          {r.pv == null ? dash : inr(r.pvCapped)}
                          {r.ceilingApplied && <div className="smartsheet-null-cell">ceiling applied (uncapped {inr(r.pv)})</div>}
                        </td>
                        <td style={right}>
                          {r.status === "DIFFER" ? <span className="short-close-badge">{inr(r.diff)}</span> : r.diff == null ? dash : inr(r.diff)}
                        </td>
                        <td style={right}>{r.pctPv == null ? dash : `${(r.pctPv * 100).toFixed(2)}%`}</td>
                        <td style={wrap}>
                          {r.advice ?? dash}
                          {r.sheetAdvice && <div className="smartsheet-null-cell">sheet: {r.sheetAdvice}</div>}
                        </td>
                        <td style={wrap}>
                          {r.note && <span className="short-close-badge" style={wrap}>{r.note}</span>}
                          {r.warnings.map(w => <div key={w}>{w}</div>)}
                          {!r.note && !r.warnings.length && dash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
