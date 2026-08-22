// lib/costingMapping.mjs
// Shared mapping engine for worker-parsed costing data.
// Single source of truth consumed by both the /api/costing/parsed route and
// scripts/syncExternalCosting.mjs.

// DB field -> accepted aliases. Aliases are normalized (lowercase,
// non-alphanumeric stripped) before matching.
const FIELD_ALIASES = {
  cvaValue: ["cvaValue", "cva", "cva_value", "CVA Value", "cvavalue"],
  priceBasis: [
    "priceBasis",
    "Price Basis",
    "price_basis",
    "pricebasis",
    "price",
  ],
  proposedErpItemName: [
    "proposedErpItemName",
    "Proposed ERP Item Name",
    "proposed_erp_item_name",
    "erpItemName",
    "proposederpitemname",
  ],
  proposedQty: [
    "proposedQty",
    "Proposed Qty",
    "proposed_qty",
    "proposedqty",
    "proposedErpQuantity",
    "proposed_erp_quantity",
    "proposederpquantity",
  ],
  aluminiumPrice: [
    "aluminiumPrice",
    "Aluminium Price",
    "aluminium_price",
    "al_price",
    "aluminiumprice",
  ],
  aluminiumAlloyPrice: [
    "aluminiumAlloyPrice",
    "Aluminium Alloy Price",
    "aluminium_alloy_price",
    "al_alloy_price",
    "aluminiumalloyprice",
  ],
  copperTapePrice: [
    "copperTapePrice",
    "Copper Tape Price",
    "copper_tape_price",
    "cu_price",
    "coppertapeprice",
  ],
  extrudedSemiconductivePrice: [
    "extrudedSemiconductivePrice",
    "Extruded Semiconductive Price",
    "extruded_semiconductive_price",
    "semicon_price",
    "extrudedsemiconductiveprice",
  ],
  htXlpePrice: [
    "htXlpePrice",
    "HT XLPE Price",
    "ht_xlpe_price",
    "xlpe_price",
    "htxlpeprice",
  ],
  pvcTypeSt2Price: [
    "pvcTypeSt2Price",
    "PVC Type ST-2 Price",
    "pvc_type_st2_price",
    "st2_price",
    "pvctypest2price",
  ],
  galvanisedSteelFlatStripPrice: [
    "galvanisedSteelFlatStripPrice",
    "Galvanised Steel Flat Strip Price",
    "galvanised_steel_flat_strip_price",
    "steel_price",
    "galvanisedsteelflatstripprice",
  ],
  fillerPrice: ["fillerPrice", "Filler Price", "filler_price", "fillerprice"],
};

const DOCKET_ALIASES = [
  "docketNo",
  "docketNumber",
  "docketno",
  "docket_number",
  "docket",
  "referenceNo",
  "reference_number",
  "reference",
];

const FLOAT_FIELDS = new Set([
  "aluminiumPrice",
  "aluminiumAlloyPrice",
  "copperTapePrice",
  "extrudedSemiconductivePrice",
  "htXlpePrice",
  "pvcTypeSt2Price",
  "galvanisedSteelFlatStripPrice",
  "fillerPrice",
]);

export const normalizeKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizedFieldMap = new Map();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    normalizedFieldMap.set(normalizeKey(alias), field);
  }
}

const DOCKET_KEY_SET = new Set(DOCKET_ALIASES.map((d) => normalizeKey(d)));

export function cleanFloat(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : num;
}

export function cleanString(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

// JSON-tolerant parsing (payload may return stringified JSON).
export function parseJsonish(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") return val;
  const t = val.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

// array/object -> values joined with "\n"; plain -> trimmed string; empty -> null
export function toJoinedString(parsed) {
  if (parsed === null || parsed === undefined) return null;
  if (Array.isArray(parsed)) {
    const arr = parsed
      .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
      .filter((x) => x !== "");
    return arr.length ? arr.join("\n") : null;
  }
  if (typeof parsed === "object") {
    const vals = Object.values(parsed)
      .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
      .filter((x) => x !== "");
    return vals.length ? vals.join("\n") : null;
  }
  const s = String(parsed).trim();
  return s === "" ? null : s;
}

// rawMaterials -> the price fields.
const MATERIAL_PATTERNS = [
  { field: "aluminiumAlloyPrice", re: /^alumi[mn]i?um\s+alloy/i },
  { field: "aluminiumAlloyPrice", re: /^al\.?\s*alloy/i },
  { field: "aluminiumPrice", re: /^alumi[mn]i?um$/i },
  { field: "aluminiumPrice", re: /^al\b|^al\.?$/i },
  { field: "copperTapePrice", re: /^copper/i },
  { field: "extrudedSemiconductivePrice", re: /^extruded\s+semiconductive/i },
  { field: "extrudedSemiconductivePrice", re: /^semicon/i },
  { field: "htXlpePrice", re: /^(ht|lt|tr)[\s-]?xlpe/i },
  { field: "htXlpePrice", re: /^xlpe/i },
  { field: "pvcTypeSt2Price", re: /pvc.*st[\s-]?2/i },
  { field: "pvcTypeSt2Price", re: /(^|\s)st[\s-]?2/i },
  { field: "galvanisedSteelFlatStripPrice", re: /^galvanis/i },
  { field: "fillerPrice", re: /^filler/i },
];

function matchMaterialField(materialName) {
  const name = String(materialName || "").trim();
  if (!name) return null;
  if (/round\s+wire/i.test(name)) return null; // no DB column for round wire
  for (const { field, re } of MATERIAL_PATTERNS) {
    if (re.test(name)) return field;
  }
  return null;
}

function applyRawMaterials(mapped, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const [matName, matVal] of Object.entries(parsed)) {
    const column = matchMaterialField(matName);
    if (column) mapped[column] = cleanFloat(matVal);
  }
}

export function mapRecord(record) {
  const mapped = {};
  for (const [rawKey, rawVal] of Object.entries(record)) {
    const nk = normalizeKey(rawKey);
    if (DOCKET_KEY_SET.has(nk)) continue;

    switch (nk) {
      case "proposederpitemname":
      case "proposederpitemnamejson":
        mapped.proposedErpItemName = toJoinedString(parseJsonish(rawVal));
        break;
      case "proposedqty":
      case "proposederpquantity":
        mapped.proposedQty = toJoinedString(parseJsonish(rawVal));
        break;
      case "cva":
      case "cvavalue":
        mapped.cvaValue = toJoinedString(parseJsonish(rawVal));
        break;
      case "rawmaterials":
      case "rawmaterial":
        applyRawMaterials(mapped, parseJsonish(rawVal));
        break;
      case "costingsheetdetails":
      case "costingsheetdetail": {
        const details = parseJsonish(rawVal);
        if (Array.isArray(details)) {
          const names = [];
          const qtys = [];
          const cvas = [];
          for (const d of details) {
            if (!d || typeof d !== "object") continue;
            for (const [dk, dv] of Object.entries(d)) {
              const dnk = normalizeKey(dk);
              const val =
                dv === null || dv === undefined ? "" : String(dv).trim();
              if (!val) continue;
              if (dnk === "proposederpitemname") names.push(val);
              else if (dnk === "proposedqty" || dnk === "proposederpquantity")
                qtys.push(val);
              else if (dnk === "cva" || dnk === "cvavalue") cvas.push(val);
            }
          }
          if (names.length) mapped.proposedErpItemName = names.join("\n");
          if (qtys.length) mapped.proposedQty = qtys.join("\n");
          if (cvas.length) mapped.cvaValue = cvas.join("\n");
        }
        break;
      }
      default: {
        const field = normalizedFieldMap.get(nk);
        if (field) {
          mapped[field] = FLOAT_FIELDS.has(field)
            ? cleanFloat(rawVal)
            : cleanString(rawVal);
        }
      }
    }
  }
  return mapped;
}

export function extractDocket(record) {
  for (const [key, rawVal] of Object.entries(record)) {
    const nk = normalizeKey(key);
    if (DOCKET_ALIASES.some((d) => normalizeKey(d) === nk)) {
      const val = String(rawVal ?? "").trim();
      if (val && val !== "-") return val;
    }
  }
  return null;
}

function collectRecordObjects(value, out, echoed) {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") {
        const t = v.trim();
        if (t && t !== "-") echoed.push(t);
      } else {
        collectRecordObjects(v, out, echoed);
      }
    }
  } else if (value && typeof value === "object") {
    if (extractDocket(value)) {
      out.push(value);
    } else {
      for (const v of Object.values(value)) {
        collectRecordObjects(v, out, echoed);
      }
    }
  }
  return out;
}

export function extractRecords(payload) {
  // Fast path: { tenders: [...], notFound: [...] }
  if (payload && !Array.isArray(payload) && Array.isArray(payload.tenders)) {
    const records = payload.tenders.filter((t) => t && typeof t === "object");
    const echoed = Array.isArray(payload.notFound)
      ? payload.notFound.filter((d) => typeof d === "string")
      : [];
    return { records, echoed };
  }

  // Fallback: {data:[...]}, {records:[...]}, single object, or nested arrays.
  let root = payload;
  if (payload && !Array.isArray(payload) && Array.isArray(payload.data))
    root = payload.data;
  else if (payload && !Array.isArray(payload) && Array.isArray(payload.records))
    root = payload.records;
  const echoed = [];
  const records = collectRecordObjects(root, [], echoed);
  return { records, echoed };
}
