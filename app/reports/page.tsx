import Link from "next/link";
import { pool } from "@/lib/prisma";
import { REPORTS, reportRows } from "@/lib/reports";
import { FilterTable } from "@/components/FilterTable";

export const dynamic = "force-dynamic";

const isLink = (v: string) => /^https:\/\/\S+$/.test(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tabKey = typeof sp.tab === "string" && Object.hasOwn(REPORTS, sp.tab) ? sp.tab : "items";
  const tab = REPORTS[tabKey];

  let rows: Record<string, string | null>[] = [];
  let problem = "";
  try {
    rows = await reportRows(pool, tabKey);
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") problem = "Not available yet: the tables for this report are not deployed in this database.";
    else { console.error("[Reports] Error:", err); problem = "This report could not be loaded. Please try again."; }
  }
  if (!problem && rows.length === 0) problem = "Not available yet: no data has been synced for this report.";

  return (
    <div className="tender-layout-container">
      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">Enquiry <span>Reports</span></h1>
          </div>
          <nav className="tender-header-actions" aria-label="Reports">
            {Object.entries(REPORTS).map(([k, t]) => (
              <Link key={k} href={`/reports?tab=${k}`} aria-current={k === tabKey ? "page" : undefined} className={`smartsheet-page-btn${k === tabKey ? " active" : ""}`}>
                {t.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="tender-body">
          {problem ? (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <p className="smartsheet-state-title" role="status">{problem}</p>
              </div>
            </div>
          ) : (
            // key: a fresh table (filters cleared) when the report tab changes
            <FilterTable key={tabKey} title={tab.label} badge={tab.note} cols={tab.cols.map(label => ({ label }))} rows={rows.map(r => {
              const text = tab.cols.map(c => r[c] ?? "");
              // a cell that is only a web link (e.g. the GTP attachment) opens in a new tab
              const cells = text.some(isLink) ? text.map((v, i) => isLink(v) ? <a key={i}href={v} target="_blank" rel="noopener noreferrer" className="underline">Open</a> : (v || <span className="smartsheet-null-cell">-</span>)) : undefined;
              return { text, cells };
            })} />
          )}
        </main>
      </div>
    </div>
  );
}
