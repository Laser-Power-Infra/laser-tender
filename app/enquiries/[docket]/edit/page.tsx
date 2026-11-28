import Link from "next/link";
import { pool } from "@/lib/prisma";
import { formFields, getForEdit, listItems } from "@/lib/enquiryWrite";
import { getPicklistOptions } from "@/actions/enquiryWrite";
import { EnquiryForm, type FieldSource } from "@/components/EnquiryForm";

export const dynamic = "force-dynamic";

type Row = Record<string, string | null>;
const READ_ONLY = "Owned by Smartsheet: read-only here. Edit it in Smartsheet - the next import would overwrite any change made on this page.";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-mist font-sans">
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
        <h1 className="tender-header-title">Enquiry <span>{title}</span></h1>
        {children}
      </main>
    </div>
  );
}

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p role="status" className="m-0 rounded-lg border border-line bg-white p-4 text-[13px] font-semibold text-navy">{children}</p>
);

export default async function EditEnquiryPage({ params, searchParams }: { params: Promise<{ docket: string }>; searchParams: Promise<{ item?: string }> }) {
  let docket = (await params).docket;
  try { docket = decodeURIComponent(docket); } catch { /* malformed escape: use as given, it will simply not be found */ }
  const { item } = await searchParams;
  const base = `/enquiries/${encodeURIComponent(docket)}/edit`;

  let enquiry: Row | null, items: Row[], itemRow: Row | null = null;
  try {
    enquiry = await getForEdit(pool, "sales_enquiry", docket);
    items = enquiry ? await listItems(pool, docket) : [];
    if (enquiry && item && item !== "new") itemRow = await getForEdit(pool, "item_list", item);
  } catch (err) {
    if ((err as { code?: string })?.code !== "42P01") throw err;
    return <Shell title={docket}><Notice>Not available yet: the enquiry tables are not deployed in this database.</Notice></Shell>;
  }
  // Mails read from the Email Dashboard for this docket, and where its autofilled values came from. Absent until the enquiry_mail migration is deployed.
  let mails: Row[] = [], sources: Record<string, FieldSource> = {};
  if (enquiry) try {
    mails = (await pool.query(`SELECT thread_id, to_char(mail_date, 'DD-Mon-YYYY HH24:MI') AS d, first_from, subject, msg_count::text AS msg_count, attach_names, attach_links, left(body, 6000) AS body, status
      FROM enquiry_mail WHERE docket_no = $1 ORDER BY mail_date`, [docket])).rows;
    sources = (await pool.query("SELECT field_source FROM enquiry WHERE docket_no = $1", [docket])).rows[0]?.field_source ?? {};
  } catch (err) {
    if (!["42P01", "42703"].includes((err as { code?: string })?.code ?? "")) throw err;
  }
  const fromMail = Object.keys(sources).length > 0;
  if (!enquiry) return <Shell title={docket}><Notice>Enquiry {docket} was not found. A temporary PENDING number stops working once Smartsheet has issued the real docket number.</Notice></Shell>;

  const fields = formFields("sales_enquiry");
  const itemFields = formFields("item_list");
  const showItemForm = item === "new" || (itemRow?.docket_no === docket && itemRow.master === "dashboard");
  const keys = [...fields, ...(showItemForm ? itemFields : [])].flatMap(f => (f.picklist ? [f.picklist] : []));
  const options = (await getPicklistOptions(keys)).data ?? {};

  return (
    <Shell title={docket}>
      {docket.startsWith("PENDING-") && (
        <Notice>Temporary docket number. Smartsheet issues the real one at the next mirror run; this page then moves to the new number.</Notice>
      )}

      {fromMail && (
        <Notice>Created automatically from the enquiry mail. Each filled field says where its value came from; fields marked &quot;please check&quot; were read with low confidence or could not be found.</Notice>
      )}

      {mails.length > 0 && (
        <section className="tender-detail-section" aria-labelledby="mail-title">
          <h2 id="mail-title" className="tender-detail-section-title">Enquiry mail</h2>
          {mails.map(m => {
            const names = (m.attach_names ?? "").split(",").map(s => s.trim()).filter(Boolean);
            const links = (m.attach_links ?? "").split(",").map(s => s.trim());
            return (
              <div key={m.thread_id} className="flex flex-col gap-1 text-[13px]">
                <div><strong>{m.subject}</strong></div>
                <div className="text-[#5f6368]">{m.first_from} · {m.d} · {m.msg_count} message{m.msg_count === "1" ? "" : "s"}</div>
                {names.length > 0 && (
                  <div className="flex flex-wrap gap-x-3">
                    {names.map((n, i) => /^https:\/\//.test(links[i] ?? "")
                      ? <a key={i} href={links[i]} target="_blank" rel="noopener noreferrer" className="underline">{n}</a> : <span key={i}>{n}</span>)}
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-[#5f6368]">Mail text</summary>
                  <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap font-sans text-[12px]">{m.body}</pre>
                </details>
              </div>
            );
          })}
        </section>
      )}

      {enquiry.master === "dashboard"
        ? <EnquiryForm fields={fields} options={options} initial={enquiry} sources={fromMail ? sources : undefined} target={{ op: "updateEnquiry", docketNo: docket }} submitLabel="Save enquiry" />
        : <Notice>{READ_ONLY}</Notice>}

      <section className="tender-detail-section" aria-labelledby="item-lines-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="item-lines-title" className="tender-detail-section-title m-0">Item lines ({items.length})</h2>
          {item !== "new" && <Link href={`${base}?item=new`} className="smartsheet-page-btn">Add item line</Link>}
        </div>
        {items.length === 0 ? <p className="m-0 text-[13px] text-[#5f6368]">No item lines yet.</p> : (
          <div className="overflow-x-auto rounded border border-line bg-white">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-mist text-[11px] uppercase text-navy">
                  {["Line", "Party item name", "Proposed ERP item", "Qty", "Unit", "Source", ""].map(h => <th key={h} scope="col" className="border-b border-line px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id} className={i.id === item ? "bg-[#eef5ff]" : undefined}>
                    <td className="border-b border-line px-3 py-2">#{i.id}</td>
                    <td className="border-b border-line px-3 py-2">{i.party_item_name}</td>
                    <td className="border-b border-line px-3 py-2">{i.propose_erp_item}</td>
                    <td className="border-b border-line px-3 py-2">{i.qty}</td>
                    <td className="border-b border-line px-3 py-2">{i.unit}</td>
                    <td className="border-b border-line px-3 py-2">{i.master === "dashboard" ? "Dashboard" : `Smartsheet ${i.item_list} (read-only)`}</td>
                    <td className="border-b border-line px-3 py-2 text-right">
                      {i.master === "dashboard" && <Link href={`${base}?item=${i.id}`} className="font-semibold text-brand underline">Edit<span className="sr-only"> line #{i.id}</span></Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {item && (
        <section className="flex flex-col gap-3" aria-labelledby="item-form-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="item-form-title" className="tender-detail-section-title m-0">{item === "new" ? "New item line" : `Item line #${item}`}</h2>
            <Link href={base} className="smartsheet-page-btn">Close</Link>
          </div>
          {item === "new" ? (
            <EnquiryForm key="new" fields={itemFields} options={options} target={{ op: "addItem", docketNo: docket }} submitLabel="Add item line" />
          ) : showItemForm && itemRow ? (
            <EnquiryForm key={item} fields={itemFields} options={options} initial={itemRow} target={{ op: "updateItem", id: item }} submitLabel="Save item line" />
          ) : (
            <Notice>{itemRow?.docket_no === docket ? READ_ONLY : `Item line #${item} was not found on this docket.`}</Notice>
          )}
        </section>
      )}
    </Shell>
  );
}
