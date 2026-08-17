import * as XLSX from "xlsx";
import { DatabaseSmartsheetService } from "@/services/databaseSmartsheetService";
import { findCostingSheet } from "@/services/costingSheetAnalyzer";
import { getAccessToken } from "@/lib/google-auth";

const COSTING_SPREADSHEET_ID = "1m1ECaxiGYmQrvSPYOBov5YYFq8G-mVNMdPWvGcSfoHs";
const COSTING_WORKSHEET_NAME = "TENDER COSTING ATTACHMENT";

const UPLOAD_COSTING_SPREADSHEET_ID = "1FK1t7FeAjQ3v4saIxJUS-5KbE6YlQv-8WFQCBRuaxDQ";
const UPLOAD_COSTING_WORKSHEET_NAME = "Cost";

export const extractNumericDocket = (docketStr: string | null | undefined): string | null => {
  if (!docketStr || docketStr.trim() === "" || docketStr.trim() === "-") return null;
  const prefixMatch = docketStr.match(/(?:ENQ|ENG|ENC|FNO)[-_](\d+)/i);
  if (prefixMatch) return prefixMatch[1];
  const pureNum = docketStr.trim();
  if (/^\d+$/.test(pureNum)) return pureNum;
  const looseMatch = docketStr.match(/(\d{4,6})/);
  return looseMatch ? looseMatch[1] : null;
};

export const getGoogleDriveFileId = (url: string | null | undefined): string | null => {
  if (!url) return null;
  let match = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return null;
};

export const getGoogleDriveDownloadUrl = (url: string): string => {
  const fileId = getGoogleDriveFileId(url);
  if (fileId) {
    return `https://docs.google.com/uc?export=download&id=${fileId}`;
  }
  return url;
};

export interface CostingDetails {
  priceBasis: string;
  prices: Record<string, number | null>;
  proposedErpItemName: string;
  proposedQty: string;
}

async function getCostingDetails(
  attachmentUrl: string,
  docketNo: string,
  driveAccessToken: string | null
): Promise<CostingDetails | null> {
  if (!attachmentUrl) return null;

  let downloadUrl = attachmentUrl;
  let headers: Record<string, string> = {};

  const fileId = getGoogleDriveFileId(attachmentUrl);
  if (fileId) {
    if (!driveAccessToken) {
      console.warn(`[Cache] No Drive access token available, skipping Drive download for docket "${docketNo}"`);
      return null;
    }
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    headers["Authorization"] = `Bearer ${driveAccessToken}`;
  }

  let workbook: XLSX.WorkBook;
  try {
    console.log(`[Costing] Downloading costing Excel for docket "${docketNo}"...`);
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) {
      console.warn(`[Costing] Failed to download Excel for docket "${docketNo}": ${response.statusText}`);
      return null;
    }
    const buf = await response.arrayBuffer();
    workbook = XLSX.read(Buffer.from(buf), { type: "buffer" });
  } catch (err) {
    console.warn(`[Costing] Error downloading Excel for docket "${docketNo}": ${err instanceof Error ? err.message : err}`);
    return null;
  }

  try {
    const sheetName = findCostingSheet(workbook);
      const sheet: Record<string, unknown> | null = sheetName ? workbook.Sheets[sheetName] : null;
      if (!sheet) {
        console.warn(`[Cache] Costing sheet could not be resolved for docket "${docketNo}"`);
        return null;
      }

      let priceBasis = "Firm";
      for (let c = 0; c < 5; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 7, c });
        const cell = sheet[cellRef] as { v?: unknown } | undefined;
        if (cell && cell.v) {
          const valStr = String(cell.v);
          if (valStr.toLowerCase().includes("variable")) {
            priceBasis = "Variable";
          }
        }
      }

      const prices: Record<string, number | null> = {
        aluminium: null,
        aluminiumAlloy: null,
        copperTape: null,
        extrudedSemiconductive: null,
        htXlpe: null,
        pvcTypeSt2: null,
        galvanisedSteelFlatStrip: null,
        filler: null,
      };

      const range = XLSX.utils.decode_range((sheet["!ref"] as string) || "A1:ZZ100");

      const patterns: Record<string, RegExp> = {
        aluminium: /^(aluminium|alumimium)$/i,
        aluminiumAlloy: /^(aluminium alloy|alumimium alloy)$/i,
        copperTape:
          /^(copper tape - 0\.060? mm|copper tape - 0\.06 mm|coper tape - 0\.1 mm|copper tape - 0\.03 mm|copper tape - 0\.035 mm|copper tape - 0\.04 mm|copper tape - 0\.045 mm|copper tape - 0\.050? mm|copper tape)$/i,
        extrudedSemiconductive: /^(extruded semiconductive|extruded semiconductive\(stripable\))$/i,
        htXlpe: /^(ht-xlpe|lt-xlpe|tr xlpe|xlpe)$/i,
        pvcTypeSt2: /^(pvc type st-2|fr pvc type st-2|frlsh pvc type st-2|pvc type st-2-pressure extruded)$/i,
        galvanisedSteelFlatStrip:
          /^(galvanised steel flat strip|galvanised steel flat strip \(double\)|galvanised steel flat strip-b|galvanised steel round wire|galvanised steel round wire \(double\))$/i,
        filler: /^filler$/i,
      };

      let bestRowIdx = -1;
      let maxMatchCount = 0;
      const maxSearchRow = Math.min(range.e.r, 40);

      for (let r = 0; r <= maxSearchRow; r++) {
        let matchCount = 0;
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[cellRef] as { v?: unknown } | undefined;
          if (cell && cell.v !== undefined) {
            const valStr = String(cell.v).trim().toLowerCase();
            const matchesAny = Object.values(patterns).some((regex) => regex.test(valStr));
            if (matchesAny) {
              matchCount++;
            }
          }
        }
        if (matchCount > maxMatchCount) {
          maxMatchCount = matchCount;
          bestRowIdx = r;
        }
      }

      if (bestRowIdx !== -1 && maxMatchCount > 0) {
        const rowHeaderIdx = bestRowIdx;
        const rowRateIdx = bestRowIdx + 1;

        if (rowRateIdx <= range.e.r) {
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cellHeaderRef = XLSX.utils.encode_cell({ r: rowHeaderIdx, c });
            const cellRateRef = XLSX.utils.encode_cell({ r: rowRateIdx, c });

            const headerCell = sheet[cellHeaderRef] as { v?: unknown } | undefined;
            const rateCell = sheet[cellRateRef] as { v?: unknown } | undefined;

            if (!headerCell) continue;

            const header = String(headerCell.v).trim().toLowerCase();
            const rateVal =
              rateCell && rateCell.v !== undefined && rateCell.v !== "" ? Number(rateCell.v) : null;

            if (rateVal === null || isNaN(rateVal)) continue;

            if (patterns.aluminium.test(header)) {
              if (prices.aluminium === null || prices.aluminium === 0) prices.aluminium = rateVal;
            } else if (patterns.aluminiumAlloy.test(header)) {
              if (prices.aluminiumAlloy === null || prices.aluminiumAlloy === 0) prices.aluminiumAlloy = rateVal;
            } else if (patterns.copperTape.test(header)) {
              if (prices.copperTape === null || prices.copperTape === 0) prices.copperTape = rateVal;
            } else if (patterns.extrudedSemiconductive.test(header)) {
              if (prices.extrudedSemiconductive === null || prices.extrudedSemiconductive === 0)
                prices.extrudedSemiconductive = rateVal;
            } else if (patterns.htXlpe.test(header)) {
              if (prices.htXlpe === null || prices.htXlpe === 0) prices.htXlpe = rateVal;
            } else if (patterns.pvcTypeSt2.test(header)) {
              if (prices.pvcTypeSt2 === null || prices.pvcTypeSt2 === 0) prices.pvcTypeSt2 = rateVal;
            } else if (patterns.galvanisedSteelFlatStrip.test(header)) {
              if (prices.galvanisedSteelFlatStrip === null || prices.galvanisedSteelFlatStrip === 0)
                prices.galvanisedSteelFlatStrip = rateVal;
            } else if (patterns.filler.test(header)) {
              if (prices.filler === null || prices.filler === 0) prices.filler = rateVal;
            }
          }
        }
      }

      const erpItems: string[] = [];
      const qtyItems: string[] = [];

      let erpHeaderRowIdx = -1;
      let erpColIdx = -1;
      let qtyColIdx = -1;
      let unitColIdx = -1;

      const normalizeCellHeader = (s: unknown): string =>
        String(s || "")
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9 ]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[cellRef] as { v?: unknown } | undefined;
          if (cell && cell.v !== undefined) {
            const norm = normalizeCellHeader(cell.v);
            if (norm.includes("PROPOSE ERP ITEM") || norm.includes("PROPOSED ERP ITEM")) {
              erpHeaderRowIdx = r;
              erpColIdx = c;
            } else if (norm === "QTY" || norm.startsWith("QTY ") || norm === "QUANTITY") {
              qtyColIdx = c;
            } else if (norm === "UNIT") {
              unitColIdx = c;
            }
          }
        }
        if (erpHeaderRowIdx !== -1) break;
      }

      if (erpHeaderRowIdx !== -1 && erpColIdx !== -1) {
        const seenItems = new Set<string>();

        for (let r = erpHeaderRowIdx + 1; r <= range.e.r; r++) {
          const docketCellRef = XLSX.utils.encode_cell({ r, c: 0 });
          const docketCell = sheet[docketCellRef] as { v?: unknown } | undefined;
          if (!docketCell || docketCell.v === undefined) continue;
          const docketStr = String(docketCell.v).trim();
          const normalizeAlphaNum = (s: string): string => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
          const sheetDocketNorm = normalizeAlphaNum(docketStr);
          const paramDocketNorm = normalizeAlphaNum(docketNo);
          if (!paramDocketNorm || (!sheetDocketNorm.includes(paramDocketNorm) && !paramDocketNorm.includes(sheetDocketNorm)))
            continue;

          const erpCellRef = XLSX.utils.encode_cell({ r, c: erpColIdx });
          const erpCell = sheet[erpCellRef] as { v?: unknown } | undefined;
          if (erpCell && erpCell.v !== undefined && String(erpCell.v).trim() !== "") {
            const erpVal = String(erpCell.v).trim();
            if (erpVal.toUpperCase().includes("PROPOSE") || erpVal.toLowerCase().includes("total") || erpVal.toLowerCase().includes("sum"))
              continue;

            let qtyVal = "";
            let qtyNum: number | null = null;
            if (qtyColIdx !== -1) {
              const qtyCellRef = XLSX.utils.encode_cell({ r, c: qtyColIdx });
              const qtyCell = sheet[qtyCellRef] as { v?: unknown } | undefined;
              if (qtyCell && qtyCell.v !== undefined) {
                qtyVal = String(qtyCell.v).trim();
                qtyNum = Number(qtyVal.replace(/[^\d.-]/g, ""));
              }
            }

            let unitVal = "";
            if (unitColIdx !== -1) {
              const unitCellRef = XLSX.utils.encode_cell({ r, c: unitColIdx });
              const unitCell = sheet[unitCellRef] as { v?: unknown } | undefined;
              if (unitCell && unitCell.v !== undefined) unitVal = String(unitCell.v).trim();
            }

            if (qtyNum !== null && !isNaN(qtyNum)) {
              qtyVal = unitVal.toUpperCase().includes("KM") ? String(Math.round(qtyNum * 1000)) : String(Math.round(qtyNum));
            }

            const itemKey = `${erpVal}::${qtyVal}`;
            if (!seenItems.has(itemKey)) {
              seenItems.add(itemKey);
              erpItems.push(erpVal);
              qtyItems.push(qtyVal);
            }
          }
        }
      }

      return {
        priceBasis,
        prices,
        proposedErpItemName: erpItems.join("\n"),
        proposedQty: qtyItems.join("\n"),
      };
    } catch (err) {
      console.warn(`[Costing] Error parsing Excel for docket "${docketNo}": ${err instanceof Error ? err.message : err}`);
      return null;
    }
  return null;
}

type EnrichedRecord = Record<string, unknown> & { docketNumber?: string | null };

export async function enrichWithCostingData(records: EnrichedRecord[]): Promise<EnrichedRecord[]> {
  if (!records || records.length === 0) return records;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return records;

  let cleanKey = key.trim().replace(/^["']|["']$/g, "");
  cleanKey = cleanKey.replace(/\\n/g, "\n");
  const cleanEmail = email.trim().replace(/^["']|["']$/g, "");

  try {
    const sheetsToken = await getAccessToken(cleanEmail, cleanKey);

    const costingRange = `${COSTING_WORKSHEET_NAME}!A1:ZZ`;
    const costingUrl = `https://sheets.googleapis.com/v4/spreadsheets/${COSTING_SPREADSHEET_ID}/values/${encodeURIComponent(costingRange)}`;

    const response = await fetch(costingUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sheetsToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[CostingEnrich] Failed to fetch costing sheet: ${response.status}`);
      return records;
    }

    const costingData = await response.json();
    const costingRows: unknown[][] = costingData.values || [];
    if (costingRows.length < 2) return records;

    const cHeaders = costingRows[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, ""));
    const docketNoIdx = cHeaders.indexOf("docketno");
    const attachmentUrlIdx = cHeaders.indexOf("attachmenturl");
    const tenderTypeIdx = cHeaders.indexOf("tendertypename");

    if (docketNoIdx === -1 || attachmentUrlIdx === -1) {
      console.warn(`[CostingEnrich] Costing sheet headers missing docketno/attachmenturl`);
      return records;
    }

    const costingMap = new Map<string, { url: string; itemCategory: string | null }>();
    for (let i = 1; i < costingRows.length; i++) {
      const row = costingRows[i];
      if (!row || row.length === 0) continue;
      const rawDocket = docketNoIdx < row.length ? String(row[docketNoIdx]) : "";
      const rawUrl = attachmentUrlIdx < row.length ? String(row[attachmentUrlIdx]) : "";
      if (!rawDocket || !rawUrl || rawUrl.trim() === "-" || rawUrl.trim() === "") continue;

      const numericDocket = extractNumericDocket(rawDocket);
      if (numericDocket) {
        const itemCategory = tenderTypeIdx !== -1 && tenderTypeIdx < row.length ? String(row[tenderTypeIdx]) : null;
        costingMap.set(numericDocket, {
          url: rawUrl.trim(),
          itemCategory: itemCategory ? itemCategory.trim() : null,
        });
      }
    }

    try {
      const uploadRange = `${UPLOAD_COSTING_WORKSHEET_NAME}!A1:G`;
      const uploadUrl = `https://sheets.googleapis.com/v4/spreadsheets/${UPLOAD_COSTING_SPREADSHEET_ID}/values/${encodeURIComponent(uploadRange)}`;
      const uploadResp = await fetch(uploadUrl, {
        headers: { Authorization: `Bearer ${sheetsToken}`, "Content-Type": "application/json" },
      });
      if (uploadResp.ok) {
        const uploadData = await uploadResp.json();
        const uploadRows: unknown[][] = uploadData.values || [];
        if (uploadRows.length >= 2) {
          for (let i = 1; i < uploadRows.length; i++) {
            const row = uploadRows[i];
            if (!row || row.length < 4) continue;
            const rawDocket = String(row[2] || "").trim();
            const rawUrl = String(row[3] || "").trim();
            if (!rawDocket || !rawUrl || rawUrl === "-") continue;
            const numericDocket = extractNumericDocket(rawDocket);
            if (numericDocket && !costingMap.has(numericDocket)) {
              costingMap.set(numericDocket, { url: rawUrl, itemCategory: null });
            }
          }
        }
      }
    } catch (uploadErr) {
      console.warn(`[CostingEnrich] Failed to fetch upload costing sheet: ${uploadErr instanceof Error ? uploadErr.message : uploadErr}`);
    }

    const enriched: EnrichedRecord[] = [];
    for (const record of records) {
      const docketNumber = record.docketNumber || "";
      const numericDocket = extractNumericDocket(docketNumber);
      const match = numericDocket ? costingMap.get(numericDocket) : null;

      if (match && numericDocket) {
        enriched.push({
          ...record,
          attachmentUrl: match.url,
          itemCategory: match.itemCategory || record.itemCategory || null,
        });
      } else {
        enriched.push(record);
      }
    }
    return enriched;
  } catch (err) {
    console.warn(`[CostingEnrich] Enrichment error: ${err instanceof Error ? err.message : err}`);
    return records;
  }
}

export async function refreshCostingData(): Promise<{
  data: EnrichedRecord[];
  matchedCount: number;
  totalCount: number;
}> {
  const records = await DatabaseSmartsheetService.getAllSmartsheetTenders();
  const totalCount = records.length;
  const enriched = await enrichWithCostingData(records);
  const matchedCount = enriched.filter((r) => r.attachmentUrl).length;

  if (enriched.length > 0) {
    await DatabaseSmartsheetService.bulkUpsertSmartsheetTenders(enriched);
  }

  return { data: enriched, matchedCount, totalCount };
}
