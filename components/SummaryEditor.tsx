"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePageSummaryAction } from "@/actions/pageSummary";

/** One hover summary in the page status list, editable by an admin. */
export function SummaryEditor({ pageKey, label, text }: { pageKey: string; label: string; text: string }) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const res = await savePageSummaryAction(pageKey, value);
    setMessage(res.success ? "Saved" : res.error ?? "Could not save");
    if (res.success) router.refresh();
  });
  return (
    <div className="flex min-w-[320px] flex-col gap-1">
      <textarea value={value} onChange={e => { setValue(e.target.value); setMessage(""); }} rows={2} aria-label={`Hover summary for ${label}`}
        className="w-full rounded border border-line p-1 font-sans text-[12px]" />
      <div className="flex items-center gap-2">
        <button type="button" className="smartsheet-page-btn" disabled={pending || value.trim() === text} onClick={save}>{pending ? "Saving..." : "Save"}</button>
        <span role="status" className="text-[11px] text-[#5f6368]">{message}</span>
      </div>
    </div>
  );
}
