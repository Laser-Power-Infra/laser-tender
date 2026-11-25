import Link from "next/link";
import { pool } from "@/lib/prisma";
import { PAGE_SIZE, REPORTS, runReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const tabKey = typeof sp.tab === "string" && Object.hasOwn(REPORTS, sp.tab) ? sp.tab : "items";
  const tab = REPORTS[tabKey];
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const href = (p: { tab?: string; q?: string; page?: number }) => {
    const u = new URLSearchParams({ tab: p.tab ?? tabKey });
    if (p.q) u.set("q", p.q);
    if (p.page && p.page > 1) u.set("page", String(p.page));
    return `/reports?${u}`;
  };

  let rows: Record<string, string | null>[] = [];
  let hasNext = false;
  let problem = "";
  try {
    ({ rows, hasNext } = await runReport(pool, tabKey, q, page));
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") problem = "Not available yet: the tables for this report are not deployed in this database.";
    else { console.error("[Reports] Error:", err); problem = "This report could not be loaded. Please try again."; }
  }
  if (!problem && rows.length === 0) {
    problem = q ? `No rows match "${q}".` : page > 1 ? "No more rows." : "Not available yet: no data has been synced for this report.";
  }

  return (
    <div className="tender-layout-container">
      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">Enquiry <span>Reports</span></h1>
          </div>
          <nav className="tender-header-actions" aria-label="Reports">
            {Object.entries(REPORTS).map(([k, t]) => (
              <Link key={k} href={href({ tab: k })} aria-current={k === tabKey ? "page" : undefined} className={`smartsheet-page-btn${k === tabKey ? " active" : ""}`}>
                {t.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="tender-body">
          <div className="smartsheet-table-container">
            <div className="smartsheet-toolbar">
              <div className="smartsheet-toolbar-left">
                <h2 className="smartsheet-table-title">{tab.label}</h2>
                {rows.length > 0 && <span className="smartsheet-record-badge">Rows {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + rows.length}</span>}
              </div>
              <form method="get" action="/reports" role="search" className="flex items-center gap-2">
                <input type="hidden" name="tab" value={tabKey} />
                <input name="q" defaultValue={q} aria-label={`Search ${tab.label}`} placeholder="Search..." className="smartsheet-search-input" style={{ paddingLeft: 12, width: 240 }} />
                <button type="submit" className="smartsheet-page-btn">Search</button>
                {q && <Link href={href({})} className="smartsheet-page-btn">Clear</Link>}
              </form>
            </div>

            {rows.length === 0 ? (
              <div className="smartsheet-state-wrapper">
                <p className="smartsheet-state-title" role="status">{problem}</p>
              </div>
            ) : (
              <div className="smartsheet-table-wrapper">
                <table className="smartsheet-data-table">
                  <thead>
                    <tr>{tab.cols.map(c => <th key={c} scope="col" style={{ cursor: "default" }}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="smartsheet-row">
                        {tab.cols.map(c => (
                          <td key={c} title={r[c] ?? undefined}>{r[c] ?? <span className="smartsheet-null-cell">-</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="smartsheet-table-footer">
              <div className="smartsheet-footer-left">Page {page} · {PAGE_SIZE} rows per page</div>
              <div className="smartsheet-pagination">
                {page > 1 && <Link href={href({ q, page: page - 1 })} className="smartsheet-page-btn">‹ Previous</Link>}
                {hasNext && <Link href={href({ q, page: page + 1 })} className="smartsheet-page-btn">Next ›</Link>}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
