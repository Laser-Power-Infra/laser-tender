"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkMailNowAction, createFromMailAction, ignoreMailAction, linkMailAction, type MailActionResponse } from "@/actions/enquiryMail";

function useRun() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<MailActionResponse>) => start(async () => {
    const res = await fn();
    setMessage(res.success ? res.message ?? "Done" : res.error ?? "Could not do that");
    if (res.success) router.refresh();
  });
  return { message, pending, run };
}

/** Reads the feed now instead of waiting for the next scheduled run. */
export function CheckMailButton() {
  const { message, pending, run } = useRun();
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="smartsheet-page-btn" disabled={pending} onClick={() => run(checkMailNowAction)}>{pending ? "Checking mail..." : "Check mail now"}</button>
      <span role="status" className="text-[12px] text-[#5f6368]">{message}</span>
    </span>
  );
}

/** What a person can do with a mail that has no enquiry yet. `candidates` are dockets it may belong to. */
export function MailActions({ threadId, subject, candidates }: { threadId: string; subject: string; candidates: string[] }) {
  const { message, pending, run } = useRun();
  const [docket, setDocket] = useState(candidates[0] ?? "");
  return (
    <div className="flex min-w-[300px] flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <input value={docket} onChange={e => setDocket(e.target.value)} placeholder="ENQ-..." aria-label={`Docket to link "${subject}" to`} list={`cand-${threadId}`}
          className="w-[150px] rounded border border-line px-1 py-[2px] font-sans text-[12px]" />
        <datalist id={`cand-${threadId}`}>{candidates.map(c => <option key={c} value={c} />)}</datalist>
        <button type="button" className="smartsheet-page-btn" disabled={pending || !docket.trim()} onClick={() => run(() => linkMailAction(threadId, docket))}>Link</button>
        <button type="button" className="smartsheet-page-btn" disabled={pending} onClick={() => run(() => createFromMailAction(threadId))}>Create enquiry</button>
        <button type="button" className="smartsheet-page-btn" disabled={pending} onClick={() => run(() => ignoreMailAction(threadId))}>Ignore</button>
      </div>
      <span role="status" className="text-[11px] text-[#5f6368]">{pending ? "Working..." : message}</span>
    </div>
  );
}
