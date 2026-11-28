"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormField } from "@/lib/enquiryWrite";
import { addItemAction, createEnquiryAction, updateEnquiryAction, updateItemAction } from "@/actions/enquiryWrite";

export type EnquiryFormTarget =
  | { op: "createEnquiry" }
  | { op: "updateEnquiry"; docketNo: string }
  | { op: "addItem"; docketNo: string }
  | { op: "updateItem"; id: string };

interface Props {
  fields: FormField[];                          // formFields(kind), computed on the server
  options: Record<string, string[]>;            // picklist key -> values
  initial?: Record<string, string | null>;      // current row as text (getForEdit)
  sources?: Record<string, FieldSource>;        // for an enquiry created from mail: where each value came from
  target: EnquiryFormTarget;
  submitLabel: string;
}

export interface FieldSource { source: string; confidence: string; note?: string }
const SOURCE_LABEL: Record<string, string> = { mail: "from the mail", history: "from past enquiries", ai: "read by AI" };
/** Small tag under a field of a mail-created enquiry. Low confidence and "nothing found" are marked for checking. */
function SourceTag({ s, blank }: { s?: FieldSource; blank: boolean }) {
  if (!s) return null;
  const check = s.confidence === "low" || blank;
  return (
    <span className={`text-[11px] ${check ? "font-semibold text-[#b45309]" : "text-[#5f6368]"}`} title={s.note}>
      {blank ? "Not filled" : SOURCE_LABEL[s.source] ?? s.source}{check ? " - please check" : s.confidence === "medium" ? " (likely)" : ""}{s.note ? `: ${s.note.length > 90 ? s.note.slice(0, 90) + "..." : s.note}` : ""}
    </span>
  );
}

const SELECT_MAX = 50; // longer lists (parties, utilities, ERP items, countries) become a searchable <input list>

export function EnquiryForm({ fields, options, initial = {}, sources, target, submitLabel }: Props) {
  const uid = useId();
  const router = useRouter();
  const start = (f: FormField) => (f.type === "checkbox" ? initial[f.name] === "true" : initial[f.name] ?? "");
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map(f => [f.name, start(f)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [signInHref, setSignInHref] = useState("");

  const set = (name: string, v: string | boolean) => { setValues(prev => ({ ...prev, [name]: v })); setSaved(""); };
  // Quotation No. is a Smartsheet dropdown that also takes typed quotation numbers, so it stays free text with suggestions.
  const asSelect = (f: FormField, opts: string[]) => opts.length >= 2 && opts.length <= SELECT_MAX && f.name !== "quotation_no";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSaved(""); setSignInHref("");
    // Send only what the user changed: other people own other columns of the same row.
    const dirty = Object.fromEntries(fields.filter(f => values[f.name] !== start(f)).map(f => [f.name, values[f.name]]));
    if (Object.keys(dirty).length === 0) { setError("Nothing to save: no field was changed."); return; }
    setBusy(true);
    try {
      const failed = (res: { success: boolean; error?: string }) => {
        if (res.success) return false;
        setError(res.error || "Could not save.");
        if (res.error === "Sign in required") setSignInHref(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return true;
      };
      if (target.op === "createEnquiry") {
        const res = await createEnquiryAction(dirty);
        if (!failed(res)) router.push(`/enquiries/${encodeURIComponent(res.data!.docketNo)}/edit`);
      } else if (target.op === "addItem") {
        if (failed(await addItemAction(target.docketNo, dirty))) return;
        router.push(window.location.pathname); // back to the item list, which now shows the new line
        router.refresh();
      } else {
        const res = target.op === "updateEnquiry" ? await updateEnquiryAction(target.docketNo, dirty) : await updateItemAction(target.id, dirty);
        if (failed(res)) return;
        const n = res.data!.changed.length;
        setSaved(n ? `Saved (${n} field${n === 1 ? "" : "s"} changed).` : "Already up to date: nothing changed.");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const groups = [...new Set(fields.map(f => f.group))];
  const lists = [...new Set(fields.filter(f => f.picklist && !asSelect(f, options[f.picklist] ?? [])).map(f => f.picklist as string))].filter(k => options[k]?.length);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {groups.map(g => (
        <fieldset key={g} className="tender-detail-section">
          <legend className="tender-detail-section-title px-1">{g}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fields.filter(f => f.group === g).map(f => {
              const id = `${uid}-${f.name}`;
              const v = values[f.name];
              const opts = f.picklist ? options[f.picklist] ?? [] : [];
              const hintId = f.hint ? `${id}-hint` : undefined;
              if (f.type === "checkbox") {
                return (
                  <div key={f.name} className="flex items-center gap-2 self-end py-2">
                    <input id={id} type="checkbox" checked={v === true} onChange={e => set(f.name, e.target.checked)} />
                    <label htmlFor={id} className="tender-detail-label">{f.label}</label>
                  </div>
                );
              }
              return (
                <div key={f.name} className="tender-detail-field">
                  <label htmlFor={id} className="tender-detail-label">{f.label}</label>
                  {asSelect(f, opts) ? (
                    <select id={id} className="tender-detail-input" value={v as string} onChange={e => set(f.name, e.target.value)}>
                      <option value="">(blank)</option>
                      {/* keep a stored value that is no longer in the list instead of silently dropping it */}
                      {v && !opts.includes(v as string) && <option value={v as string}>{v as string}</option>}
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      id={id}
                      className="tender-detail-input"
                      type={f.type}
                      step={f.type === "number" ? "any" : undefined}
                      list={f.picklist && opts.length ? `${uid}-list-${f.picklist}` : undefined}
                      placeholder={f.picklist && opts.length ? "Type to search" : undefined}
                      autoComplete="off"
                      aria-describedby={hintId}
                      value={v as string}
                      onChange={e => set(f.name, e.target.value)}
                    />
                  )}
                  {f.hint && <span id={hintId} className="text-[11px] text-[#5f6368]">{f.hint}</span>}
                  <SourceTag s={sources?.[f.name]} blank={v === ""} />
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      {lists.map(k => (
        <datalist key={k} id={`${uid}-list-${k}`}>
          {options[k].map(o => <option key={o} value={o} />)}
        </datalist>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="smartsheet-retry-btn" disabled={busy}>{busy ? "Saving..." : submitLabel}</button>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-semibold text-[#c5221f]">
            {error}{" "}
            {signInHref && <a href={signInHref} className="underline">Sign in</a>}
          </p>
        )}
        {saved && <p role="status" className="m-0 text-[13px] font-semibold text-excel">{saved}</p>}
      </div>
    </form>
  );
}
