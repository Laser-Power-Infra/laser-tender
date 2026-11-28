import Link from "next/link";
import { pool } from "@/lib/prisma";
import { formFields } from "@/lib/enquiryWrite";
import { NEW_ENQUIRY_COLS, readNewEnquiries } from "@/lib/enquiryRead";
import { getPicklistOptions } from "@/actions/enquiryWrite";
import { EnquiryForm } from "@/components/EnquiryForm";
import { FilterTable } from "@/components/FilterTable";

export const dynamic = "force-dynamic";

export default async function NewEnquiryPage() {
  const fields = formFields("sales_enquiry");
  const [options, created] = await Promise.all([
    getPicklistOptions(fields.flatMap(f => (f.picklist ? [f.picklist] : []))).then(r => r.data ?? {}),
    readNewEnquiries(pool),
  ]);
  return (
    <div className="flex-1 overflow-y-auto bg-mist font-sans">
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
        <h1 className="tender-header-title">New <span>Enquiries</span></h1>
        {created.length === 0 ? (
          <p className="m-0 text-[13px] text-[#5f6368]" role="status">No enquiry has been created in the dashboard yet. A new one appears here as soon as it is saved.</p>
        ) : (
          <FilterTable title="Created in the dashboard" cols={NEW_ENQUIRY_COLS.map(label => ({ label }))} rows={created.map(text => ({
            text,
            cells: text.map((v, i) => i === 0
              ? <Link key={i} href={`/enquiries/${encodeURIComponent(v)}/edit`} className="underline">{v}</Link>
              : (v || <span className="smartsheet-null-cell">-</span>)),
          }))} />
        )}
        <h2 className="tender-header-title">Add <span>an enquiry</span></h2>
        <p className="m-0 text-[13px] text-[#5f6368]">
          The enquiry is saved with a temporary docket number (PENDING-n). Smartsheet issues the real docket number when the row is mirrored;
          it then replaces the temporary one everywhere. Saving needs a signed-in user.
        </p>
        <EnquiryForm fields={fields} options={options} target={{ op: "createEnquiry" }} submitLabel="Create enquiry" />
      </main>
    </div>
  );
}
