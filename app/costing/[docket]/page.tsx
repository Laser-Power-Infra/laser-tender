"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getCostingRuns, runDraftCosting } from "@/actions/costing";
import type { CostingRunView } from "@/lib/costingRun";

// Same text as DRAFT_BANNER in lib/costingRun (type-only import above keeps the server code out of the client bundle).
const DRAFT_BANNER = "DRAFT for Touhid's review — profit, TTR, special VA and freight are NOT verified against his sheets";

const money = (v: string | null) => (v == null ? "-" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const th = "border-b-2 border-r border-line bg-[#f4f6f8] px-3 py-2 text-left text-[11px] font-bold uppercase whitespace-nowrap text-navy";
const td = "border-b border-r border-line px-3 py-1.5 align-top";
const tdNum = `${td} text-right whitespace-nowrap`;

const CostingPage: React.FC = () => {
  const docket = decodeURIComponent(useParams<{ docket: string }>().docket);
  const [runs, setRuns] = useState<CostingRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getCostingRuns(docket);
    setRuns(res.data);
    if (!res.success) setError(res.error ?? "Failed to load costing runs");
    setLoading(false);
  }, [docket]);
  useEffect(() => { load(); }, [load]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    const res = await runDraftCosting(docket);
    if (!res.success) setError(res.error ?? "Draft costing failed");
    await load();
    setRunning(false);
  };

  return (
    <div className="tender-workspace">
      <header className="tender-top-header">
        <div className="tender-header-brand">
          <h2 className="tender-header-title">Draft <span>Costing</span></h2>
          <div className="tender-header-divider" />
          <span className="tender-header-subtitle">{docket}</span>
        </div>
        <div className="tender-header-actions">
          <button className="clear-filters-btn" onClick={handleRun} disabled={running}>
            {running ? "Running..." : "Run draft costing"}
          </button>
        </div>
      </header>

      <main className="tender-body" style={{ overflowY: "auto" }}>
        <div role="alert" className="mb-4 shrink-0 rounded border-2 border-[#c62828] bg-[#fdecea] px-4 py-3 text-[14px] font-extrabold text-[#c62828]">
          {DRAFT_BANNER}
        </div>
        {error && <div role="alert" className="smartsheet-error-code mb-4 shrink-0">{error}</div>}
        {loading && <p className="smartsheet-state-title">Loading costing runs...</p>}
        {!loading && runs.length === 0 && <p className="smartsheet-state-title">No costing run for this docket yet.</p>}

        {runs.map(run => (
          <section key={run.id} className="mb-6 shrink-0 rounded-lg border border-line bg-white">
            <div className="smartsheet-toolbar rounded-t-lg">
              <div className="smartsheet-toolbar-left">
                <h3 className="smartsheet-table-title">Revision {run.revision}</h3>
                <span className="smartsheet-record-badge">{run.status}</span>
                <span className="text-[11px]">
                  RM rates: {run.rm_rate_policy}{run.rm_base_date ? ` (base date ${run.rm_base_date})` : ""} • {run.created_at} • {run.created_by ?? "-"}
                </span>
              </div>
              <a className="export-excel-btn" href={`/api/costing-run/${run.id}/xlsx`}>Download Excel</a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    {["Item", "ERP item", "Qty", "Unit", "BOM ID", "RM cost", "Drum cost", "Freight", "Ex-works", "Price ex GST", "GST", "Price incl GST"].map(h => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {run.items.map(it => (
                    <React.Fragment key={it.id}>
                      <tr>
                        <td className={`${td} font-bold`}>{it.it_code}</td>
                        <td className={td}>{it.erp_item ?? "-"}</td>
                        <td className={tdNum}>{it.qty == null ? "-" : Number(it.qty)}</td>
                        <td className={td}>{it.unit ?? "-"}</td>
                        <td className={td}>{it.bom_id ?? it.bom_match_note ?? "-"}</td>
                        <td className={tdNum}>{money(it.rm_cost)}</td>
                        <td className={tdNum}>{money(it.drum_cost)}</td>
                        <td className={tdNum}>{money(it.freight)}</td>
                        <td className={tdNum}>{money(it.ex_works)}</td>
                        <td className={tdNum}>{money(it.price_ex_gst)}</td>
                        <td className={tdNum}>{money(it.gst)}</td>
                        <td className={`${tdNum} font-bold`}>{money(it.price_incl_gst)}</td>
                      </tr>
                      <tr>
                        <td className={td} />
                        <td className={`${td} bg-[#fafbfc]`} colSpan={11}>
                          {it.bom_match_note && <div className="mb-1 font-semibold text-[#c62828]">{it.bom_match_note}</div>}
                          {it.warnings.length > 0 && (
                            <ul className="m-0 mb-2 list-disc pl-5 text-[12px] text-[#b45309]">
                              {it.warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                          )}
                          {it.rm.length > 0 && (
                            <table className="w-full border-separate border-spacing-0 text-[12px]">
                              <thead>
                                <tr>{["RM", "Consumption", "Rate", "Rate date", "Amount", "Source", "Formula"].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                              </thead>
                              <tbody>
                                {it.rm.map((r, i) => (
                                  <tr key={i}>
                                    <td className={td}>{r.rm_name}</td>
                                    <td className={tdNum}>{Number(r.consumption)}{r.unit ? ` ${r.unit}` : ""}</td>
                                    <td className={tdNum}>{money(r.rate)}</td>
                                    <td className={td}>{r.rate_date ?? "-"}</td>
                                    <td className={tdNum}>{money(r.amount)}</td>
                                    <td className={td}>{r.consumption_source}<br />{r.source_ref}</td>
                                    <td className={td}>{r.formula}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
};

export default CostingPage;
