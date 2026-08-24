"use client";
import React, { useEffect, useState } from "react";
import { SmartsheetTender } from "@/types/smartsheetTender";

function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

interface Props {
  open: boolean;
  tender: SmartsheetTender | null;
  onClose: () => void;
  // effective values derived from overrides
  effectiveAllocatedTo: string | null;
  effectiveStatus: string | null;
  effectiveContactNo: string | null;
  effectiveReverseAuction: string | null;
  // draft handlers
  savingAllocated: boolean;
  savingStatus: boolean;
  savingContact: boolean;
  savingReverseAuction: boolean;
  onSaveAllocatedTo: (val: string) => void;
  onSaveStatus: (val: string) => void;
  onSaveContactNo: (val: string) => void;
  onSaveReverseAuction: (val: string) => void;
}

export default function TenderDetailSheet({
  open,
  tender,
  onClose,
  effectiveAllocatedTo,
  effectiveStatus,
  effectiveContactNo,
  effectiveReverseAuction,
  savingAllocated,
  savingStatus,
  savingContact,
  savingReverseAuction,
  onSaveAllocatedTo,
  onSaveStatus,
  onSaveContactNo,
  onSaveReverseAuction,
}: Props) {
  const [draftAllocated, setDraftAllocated] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [draftContact, setDraftContact] = useState("");

  useEffect(() => {
    if (tender) {
      setDraftAllocated(effectiveAllocatedTo ?? "");
      setDraftStatus(effectiveStatus ?? "");
      setDraftContact(effectiveContactNo ?? "");
    }
  }, [tender, effectiveAllocatedTo, effectiveStatus, effectiveContactNo]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!tender) return null;

  const NullCell = () => <span className="smartsheet-null-cell">—</span>;

  const purchaseBadgeClass = (val: string) => {
    const v = val.toLowerCase();
    if (v.includes("tender")) return "tender";
    if (v.includes("purchase")) return "purchase";
    if (v.includes("budgetary") || v.includes("bugetary")) return "budgetary";
    if (v.includes("laser")) return "laser";
    return "purchase";
  };

  const activeRates = [
    { label: "Al", price: tender.aluminiumPrice },
    { label: "Al Alloy", price: tender.aluminiumAlloyPrice },
    { label: "Cu", price: tender.copperTapePrice },
    { label: "Semicon", price: tender.extrudedSemiconductivePrice },
    { label: "XLPE", price: tender.htXlpePrice },
    { label: "ST-2", price: tender.pvcTypeSt2Price },
    { label: "Steel", price: tender.galvanisedSteelFlatStripPrice },
    { label: "Filler", price: tender.fillerPrice },
  ].filter(m => m.price !== null && m.price !== undefined && m.price !== 0);

  return (
    <>
      {/* Overlay */}
      <div
        className={`tender-detail-overlay ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      {/* Panel */}
      <aside className={`tender-detail-sheet ${open ? "open" : ""}`} role="dialog" aria-modal="true">
        <div className="tender-detail-header">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#5f6368", letterSpacing: 0.6, textTransform: "uppercase" }}>
              {tender.docketNumber || "—"} {tender.partyName ? `· ${tender.partyName}` : ""}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0a2540", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {tender.partyName || "Tender Details"}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tender.enquiryDate ? <span className="enquiry-date-badge">{formatDate(tender.enquiryDate)}</span> : null}
              {tender.tenderPurchase ? <span className={`purchase-type-badge ${purchaseBadgeClass(tender.tenderPurchase)}`}>{tender.tenderPurchase}</span> : null}
              {tender.quotationNumber ? <span style={{ fontFamily: "monospace", fontSize: 11, background: "#f1f3f4", padding: "2px 6px", borderRadius: 4, border: "1px solid #dadce0" }}>{tender.quotationNumber}</span> : null}
            </div>
          </div>
          <button onClick={onClose} className="tender-detail-close" aria-label="Close">✕</button>
        </div>

        <div className="tender-detail-body">
          {/* Editable fields — same autosave as table (blur / Enter) */}
          <div className="tender-detail-section">
            <div className="tender-detail-section-title">Editable Fields</div>

            <label className="tender-detail-field">
              <span className="tender-detail-label">Allocated To {savingAllocated && <span style={{ fontWeight: 400, fontSize: 11, color: "#999" }}>Saving...</span>}</span>
              <input
                className="tender-detail-input"
                value={draftAllocated}
                onChange={e => setDraftAllocated(e.target.value)}
                onBlur={() => onSaveAllocatedTo(draftAllocated)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === "Escape") { setDraftAllocated(effectiveAllocatedTo ?? ""); (e.target as HTMLInputElement).blur(); }
                }}
                placeholder="—"
              />
            </label>

            <label className="tender-detail-field">
              <span className="tender-detail-label">Status {savingStatus && <span style={{ fontWeight: 400, fontSize: 11, color: "#999" }}>Saving...</span>}</span>
              <textarea
                className="tender-detail-textarea"
                value={draftStatus}
                onChange={e => setDraftStatus(e.target.value)}
                onBlur={() => onSaveStatus(draftStatus)}
                onKeyDown={e => {
                  if (e.key === "Escape") { setDraftStatus(effectiveStatus ?? ""); (e.target as HTMLTextAreaElement).blur(); }
                }}
                rows={3}
                placeholder="—"
              />
            </label>

            <label className="tender-detail-field">
              <span className="tender-detail-label">Contact No {savingContact && <span style={{ fontWeight: 400, fontSize: 11, color: "#999" }}>Saving...</span>}</span>
              <input
                className="tender-detail-input"
                value={draftContact}
                onChange={e => setDraftContact(e.target.value)}
                onBlur={() => onSaveContactNo(draftContact)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === "Escape") { setDraftContact(effectiveContactNo ?? ""); (e.target as HTMLInputElement).blur(); }
                }}
                placeholder="—"
              />
            </label>

            <div className="tender-detail-field">
              <span className="tender-detail-label">Reverse Auction {savingReverseAuction && <span style={{ fontWeight: 400, fontSize: 11, color: "#999" }}>Saving...</span>}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`ra-toggle-btn ${effectiveReverseAuction === "yes" ? "ra-yes" : "ra-inactive"}`}
                  disabled={savingReverseAuction}
                  onClick={() => onSaveReverseAuction("yes")}
                >Yes</button>
                <button
                  className={`ra-toggle-btn ${effectiveReverseAuction === "no" ? "ra-no" : "ra-inactive"}`}
                  disabled={savingReverseAuction}
                  onClick={() => onSaveReverseAuction("no")}
                >No</button>
              </div>
            </div>
          </div>

          {/* Read-only fields */}
          <div className="tender-detail-section">
            <div className="tender-detail-section-title">Details</div>
            <div className="tender-detail-grid">
              <div className="tender-detail-item"><span className="tender-detail-k">Enquiry Date</span><span className="tender-detail-v">{tender.enquiryDate ? formatDate(tender.enquiryDate) : <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Docket Number</span><span className="tender-detail-v" style={{ fontFamily: "monospace", fontWeight: 600 }}>{tender.docketNumber ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Party Name</span><span className="tender-detail-v">{tender.partyName ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Utility</span><span className="tender-detail-v">{tender.utility ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Quotation Number</span><span className="tender-detail-v" style={{ fontFamily: "monospace" }}>{tender.quotationNumber ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Contract Number</span><span className="tender-detail-v" style={{ fontFamily: "monospace", fontWeight: 600 }}>{tender.contractNo ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Quotation Date</span><span className="tender-detail-v">{tender.quotationDate ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Account Holder</span><span className="tender-detail-v">{tender.accountHolder ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Email Id</span><span className="tender-detail-v" style={{ wordBreak: "break-all" }}>{tender.emailId ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Email Subject Line</span><span className="tender-detail-v" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{tender.emailSubjectLine ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Tender / Purchase</span><span className="tender-detail-v">{tender.tenderPurchase ? <span className={`purchase-type-badge ${purchaseBadgeClass(tender.tenderPurchase)}`}>{tender.tenderPurchase}</span> : <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">CVA Value</span><span className="tender-detail-v">{tender.cvaValue ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Item Name</span><span className="tender-detail-v" style={{ whiteSpace: "pre-wrap" }}>{tender.proposedErpItemName ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Tender Qty</span><span className="tender-detail-v" style={{ whiteSpace: "pre-wrap" }}>{tender.proposedQty ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Price Basis</span><span className="tender-detail-v">{tender.priceBasis ?? <NullCell />}</span></div>
              <div className="tender-detail-item"><span className="tender-detail-k">Attachment</span><span className="tender-detail-v">{tender.attachmentUrl ? <a href={`/api/costing/download?docket=${encodeURIComponent(tender.docketNumber || "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "#1a73e8", textDecoration: "underline", fontWeight: 600 }}>{tender.attachmentUrl.slice(0, 48)}</a> : <NullCell />}</span></div>
            </div>
            {activeRates.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="tender-detail-k" style={{ marginBottom: 6 }}>Raw Materials</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                  {activeRates.map(m => (
                    <div key={m.label} style={{ background: "#f1f3f4", padding: "6px 8px", borderRadius: 6, border: "1px solid #dadce0", fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: "#5f6368" }}>{m.label}:</span> <span style={{ color: "#202124" }}>₹{m.price}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="tender-detail-footer">
          <button className="clear-filters-btn" onClick={onClose}>Close</button>
        </div>
      </aside>
    </>
  );
}
