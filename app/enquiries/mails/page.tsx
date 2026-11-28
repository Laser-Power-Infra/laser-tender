import Link from "next/link";
import { pool } from "@/lib/prisma";
import { FilterTable, type FilterTableRow } from "@/components/FilterTable";
import { CheckMailButton, MailActions } from "@/components/MailActions";

export const dynamic = "force-dynamic";

// Enquiry mails read from the Email Dashboard (guideline 27 Nov 2026, sections 3.1 to 3.3).
const VIEWS = {
  review: { label: "To review", where: `status = 'review'`, about: "Mails the dashboard would not decide alone: they look like an existing enquiry, or the AI judged them not to be a new cable or conductor enquiry." },
  created: { label: "Created", where: `status = 'created'`, about: "Enquiries the dashboard created from mail, after checking that none existed." },
  linked: { label: "Linked", where: `status = 'linked'`, about: "Mails that belong to an enquiry that already existed." },
  waiting: { label: "Waiting", where: `status = 'new'`, about: "New mails not read yet: they are read at the next run." },
  ignored: { label: "Ignored", where: `status = 'ignored'`, about: "Mails a person set aside." },
} as const;
type View = keyof typeof VIEWS;

const COLS = ["Mail date", "From", "Subject", "Messages", "Files", "Enquiry", "Why", "Actions"];
const dash = <span className="smartsheet-null-cell">-</span>;
const isView = (v: string | undefined): v is View => !!v && Object.hasOwn(VIEWS, v);

export default async function EnquiryMailsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const view: View = isView(sp.show) ? sp.show : "review";

  let rows: any[] = [], counts: Record<string, number> = {}, today = { n: 0, cost: 0, mails: 0 }, problem = "";
  try {
    [rows, counts, today] = await Promise.all([
      pool.query(`SELECT thread_id, to_char(mail_date, 'DD-Mon-YYYY HH24:MI') AS d, first_from, subject, msg_count, attach_names, attach_links, docket_no, reason, candidates
        FROM enquiry_mail WHERE ${VIEWS[view].where} ORDER BY mail_date DESC NULLS LAST LIMIT 1000`).then(r => r.rows),
      pool.query(`SELECT status, count(*)::int AS n FROM enquiry_mail GROUP BY 1`).then(r => Object.fromEntries(r.rows.map(x => [x.status, x.n]))),
      // "today" in India
      pool.query(`SELECT count(*) FILTER (WHERE extracted_at IS NOT NULL)::int AS n, coalesce(sum(cost_usd) FILTER (WHERE extracted_at IS NOT NULL), 0)::float AS cost, count(*)::int AS mails
        FROM enquiry_mail WHERE (first_seen_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`).then(r => r.rows[0]),
    ]);
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") problem = "Not available yet: the enquiry_mail table is not deployed in this database.";
    else { console.error("[EnquiryMails] Error:", err); problem = "The mails could not be loaded. Please try again."; }
  }

  const tableRows: FilterTableRow[] = rows.map(m => {
    const names = String(m.attach_names ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const links = String(m.attach_links ?? "").split(",").map((s: string) => s.trim());
    const text = [m.d ?? "", m.first_from ?? "", m.subject ?? "", String(m.msg_count ?? ""), names.join(", "), m.docket_no ?? "", m.reason ?? "", ""];
    return {
      text,
      cells: [
        m.d ?? dash, m.first_from ?? dash, m.subject ?? dash, String(m.msg_count ?? ""),
        names.length ? <span key="f" className="flex flex-col">{names.map((n: string, i: number) => /^https:\/\//.test(links[i] ?? "")
          ? <a key={i} href={links[i]} target="_blank" rel="noopener noreferrer" className="underline">{n}</a> : <span key={i}>{n}</span>)}</span> : dash,
        m.docket_no ? <Link key="e" href={`/enquiries/${encodeURIComponent(m.docket_no)}/edit`} className="underline">{m.docket_no}</Link> : dash,
        m.reason ?? dash,
        view === "review" || view === "waiting" || view === "ignored" ? <MailActions key="a" threadId={m.thread_id} subject={m.subject ?? ""} candidates={Array.isArray(m.candidates) ? m.candidates : []} /> : dash,
      ],
    };
  });
  const countOf = (v: View) => counts[v === "waiting" ? "new" : v] ?? 0;

  return (
    <div className="tender-layout-container">
      <div className="tender-workspace">
        <header className="tender-top-header">
          <div className="tender-header-brand">
            <h1 className="tender-header-title">Enquiry <span>Mails</span></h1>
          </div>
          <nav className="tender-header-actions" aria-label="Enquiry mails">
            {(Object.keys(VIEWS) as View[]).map(v => (
              <Link key={v} href={`/enquiries/mails?show=${v}`} aria-current={v === view ? "page" : undefined} className={`smartsheet-page-btn${v === view ? " active" : ""}`}>
                {VIEWS[v].label} ({countOf(v)})
              </Link>
            ))}
          </nav>
        </header>

        <main className="tender-body">
          {problem ? (
            <div className="smartsheet-table-container"><div className="smartsheet-state-wrapper"><p className="smartsheet-state-title" role="status">{problem}</p></div></div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-4 text-[13px] text-[#3c4043]">
                <CheckMailButton />
                <span>Today: {today.mails} mail{today.mails === 1 ? "" : "s"} received, {today.n} read by AI, cost US$ {today.cost.toFixed(4)}. Signed-in users can act on mails.</span>
              </div>
              <p className="mb-2 mt-0 text-[13px] text-[#5f6368]">{VIEWS[view].about}</p>
              {tableRows.length === 0
                ? <div className="smartsheet-table-container"><div className="smartsheet-state-wrapper"><p className="smartsheet-state-title" role="status">No mails in this list.</p></div></div>
                : <FilterTable key={view} title={VIEWS[view].label} cols={COLS.map(label => ({ label }))} rows={tableRows} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
