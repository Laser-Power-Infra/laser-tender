import Link from "next/link";
import { pool } from "@/lib/prisma";
import { REPORTS, reportRows, lastSync } from "@/lib/reports";
import { GROUPS, GROUP_SUMMARY, PAGES, groupKey, reportKey } from "@/lib/pages";
import { readPageSummaries } from "@/lib/pageSummary";
import { getSessionUser } from "@/lib/auth";
import { SummaryEditor } from "@/components/SummaryEditor";
import { FilterTable, type FilterTableRow } from "@/components/FilterTable";

export const dynamic = "force-dynamic";

const isLink = (v: string) => /^https:\/\/\S+$/.test(v);
const STATUS = "status";

// The running list of every page (guideline 27 Nov 2026, section 5 and 10.6). "Built" means the page and its query exist, not that numbers are signed off.
// Power BI page no.: a plain number is a page of "ENQUIRY TO QUOTATION (N)"; "CE n" is a page of "CONT EX 2".
const STATUS_COLS = ["Power BI page no.", "Page", "Group", "Status", "Detail", "Hover summary"];
/** One row per page, then one per navigation group (groups only carry a hover summary). An admin edits the summaries in place. */
function statusRows(saved: Record<string, string>, canEdit: boolean): FilterTableRow[] {
  const dash = <span className="smartsheet-null-cell">-</span>;
  const summaryCell = (key: string, label: string, text: string) => canEdit ? <SummaryEditor key={key} pageKey={key} label={label} text={text} /> : text;
  const pages = PAGES.map(p => {
    const key = reportKey(p);
    const r = key ? REPORTS[key] : undefined;
    const summary = saved[p.href] ?? p.summary;
    const text = [p.no ? String(p.no) : p.ce ? `CE ${p.ce}` : "", p.label, p.group, r?.sourceNeeded ? "Created, source needed" : "Built",
      r?.sourceNeeded ?? (r && "note" in r ? r.note ?? "" : ""), summary];
    return { text, cells: text.map((v, i) => i === 1 ? <Link key={i} href={p.href} className="underline">{v}</Link> : i === 5 ? summaryCell(p.href, p.label, summary) : (v || dash)) };
  });
  const groups = GROUPS.map(g => {
    const summary = saved[groupKey(g)] ?? GROUP_SUMMARY[g];
    const text = ["", `${g} (menu)`, g, "", "", summary];
    return { text, cells: text.map((v, i) => i === 5 ? summaryCell(groupKey(g), g, summary) : (v || dash)) };
  });
  return [...pages, ...groups];
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tabKey = sp.tab === STATUS || (typeof sp.tab === "string" && Object.hasOwn(REPORTS, sp.tab)) ? sp.tab : "items";
  const page = PAGES.find(p => reportKey(p) === tabKey);
  const tab = tabKey === STATUS ? undefined : REPORTS[tabKey];

  let rows: Record<string, string | null>[] = [];
  let synced: Awaited<ReturnType<typeof lastSync>> = null;
  let problem = "";
  // the status list also shows the hover summaries; an admin edits them there (guideline 9.7)
  const [saved, user] = tab ? [{}, null] : await Promise.all([readPageSummaries(pool).catch(() => ({})), getSessionUser()]);
  if (tab && tab.sourceNeeded === undefined) {
    try {
      [rows, synced] = await Promise.all([reportRows(pool, tabKey), lastSync(pool, tabKey)]);
    } catch (err) {
      if ((err as { code?: string })?.code === "42P01") problem = "Not available yet: the tables for this report are not deployed in this database.";
      else { console.error("[Reports] Error:", err); problem = "This report could not be loaded. Please try again."; }
    }
    if (!problem && rows.length === 0) problem = "No data yet for this page.";
  }
  const freshness = synced
    ? `last synced ${synced.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}${synced.copy ? " from the “Copy - auto sync” sheet" : ""}`
    : "";

  return (
    <div className="tender-layout-container">
      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">{page?.group ?? "Enquiry"} <span>{page?.label ?? "Reports"}</span></h1>
          </div>
          {/* the other pages of the same group; every page is also in the main navigation */}
          <nav className="tender-header-actions" aria-label={page?.group ?? "Reports"}>
            {PAGES.filter(p => p.group === page?.group && reportKey(p)).map(p => (
              <Link key={p.href} href={p.href} aria-current={p === page ? "page" : undefined} className={`smartsheet-page-btn${p === page ? " active" : ""}`}>
                {p.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="tender-body">
          {!tab ? (
            <FilterTable key={STATUS} title="Page status" cols={STATUS_COLS.map(label => ({ label }))} rows={statusRows(saved, user?.role === "ADMIN")} />
          ) : tab.sourceNeeded !== undefined || problem ? (
            <div className="smartsheet-table-container">
              <div className="smartsheet-state-wrapper">
                <p className="smartsheet-state-title" role="status">{tab.sourceNeeded ?? problem}</p>
                {tab.sourceNeeded !== undefined && <p className="m-0 text-[13px] text-[#5f6368]">This page fills with data as soon as the source is connected.</p>}
              </div>
            </div>
          ) : (
            // key: a fresh table (filters cleared) when the report tab changes
            <FilterTable key={tabKey} title={tab.label} badge={[tab.note, freshness].filter(Boolean).join(" · ") || undefined} cols={tab.cols.map(label => ({ label }))} rows={rows.map(r => {
              const text = tab.cols.map(c => r[c] ?? "");
              // a cell that is only a web link (e.g. the GTP attachment) opens in a new tab
              // and the report's own link column (e.g. a type test certificate) opens the file the row points to
              const href = tab.link ? r[tab.link.href] : null;
              const linkAt = href ? tab.cols.indexOf(tab.link!.col) : -1;
              const cells = href || text.some(isLink) ? text.map((v, i) =>
                i === linkAt ? <a key={i} href={href!} target="_blank" rel="noopener noreferrer" className="underline">{v || "Open"}</a>
                : isLink(v) ? <a key={i} href={v} target="_blank" rel="noopener noreferrer" className="underline">Open</a> : (v || <span className="smartsheet-null-cell">-</span>)) : undefined;
              return { text, cells };
            })} />
          )}
        </main>
      </div>
    </div>
  );
}
