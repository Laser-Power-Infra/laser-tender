import { formFields } from "@/lib/enquiryWrite";
import { getPicklistOptions } from "@/actions/enquiryWrite";
import { EnquiryForm } from "@/components/EnquiryForm";

export const dynamic = "force-dynamic";

export default async function NewEnquiryPage() {
  const fields = formFields("sales_enquiry");
  const options = (await getPicklistOptions(fields.flatMap(f => (f.picklist ? [f.picklist] : [])))).data ?? {};
  return (
    <div className="flex-1 overflow-y-auto bg-mist font-sans">
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
        <h1 className="tender-header-title">New <span>Enquiry</span></h1>
        <p className="m-0 text-[13px] text-[#5f6368]">
          The enquiry is saved with a temporary docket number (PENDING-n). Smartsheet issues the real docket number when the row is mirrored;
          it then replaces the temporary one everywhere. Saving needs a signed-in user.
        </p>
        <EnquiryForm fields={fields} options={options} target={{ op: "createEnquiry" }} submitLabel="Create enquiry" />
      </main>
    </div>
  );
}
