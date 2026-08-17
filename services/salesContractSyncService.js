import crypto from "crypto";
import { prisma } from "../lib/prisma";

const SALES_CONTRACT_SPREADSHEET_ID = "1Nar-3d8BsAIBPOonX-A9-J1tRfZDED5_S1njoHRke0Y";
const SALES_CONTRACT_SHEET_NAME = "Paste daily sales contract_Tridip";

const BATCH_SIZE = 100;

const SHEET_TO_MODEL = {
  "Contract Number": "contractNumber",
  "Contract Date": "contractDate",
  "Customer Name": "customerName",
  "Party Order No": "partyOrderNo",
  "Party Order Date": "partyOrderDate",
  "Closed Flag": "closedFlag",
  "Item Schedule Name": "itemScheduleName",
  "Item Code": "itemCode",
  "Item Name": "itemName",
  "Price Basis": "priceBasis",
  "Our Staff Name": "ourStaffName",
  "Account Class": "accountClass",
  "QT NO": "quotationNumber",
  "Contract Qty": "contractQty",
  "Net Contract Qty": "netContractQty",
  "Rate": "rate",
  "Mfg Clrn Qty": "mfgClrnQty",
  "Balance Contract Qty": "balanceContractQty",
  "Pending Offer Against MC": "pendingOfferAgainstMC",
  "Pending DI Against Inspection": "pendingDIAgainstInspection",
  "Pending DI Against Contract": "pendingDIAgainstContract",
  "Balance Dispatch Qty(Contract)": "balanceDispatchQty",
  "Basic Value": "basicValue",
  "Cancelled Qty": "cancelledQty",
  "Invoice Qty": "invoiceQty",
};

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const encodedHeader = base64UrlEncode(header);
  const encodedClaimSet = base64UrlEncode(claimSet);
  const stringToSign = `${encodedHeader}.${encodedClaimSet}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(stringToSign);
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const assertion = `${stringToSign}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }

  const json = await response.json();
  return json.access_token;
}

function normalizeHeader(h) {
  return h.trim().replace(/\s+/g, " ");
}

export async function syncSalesContracts() {
  if (!prisma) {
    throw new Error("Database not available");
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    console.warn("[SalesContractSync] Missing Google credentials, skipping sync");
    return { inserted: 0, skipped: 0, total: 0 };
  }

  const cleanKey = key.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  const cleanEmail = email.trim().replace(/^["']|["']$/g, "");

  let token;
  try {
    token = await getAccessToken(cleanEmail, cleanKey);
  } catch (err) {
    console.error(`[SalesContractSync] Auth error: ${err.message}`);
    throw err;
  }

  const range = `${SALES_CONTRACT_SHEET_NAME}!A1:ZZ`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SALES_CONTRACT_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[SalesContractSync] Fetch error: ${err.message}`);
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const rows = data.values || [];
  if (rows.length < 2) {
    console.log("[SalesContractSync] No data rows found");
    return { inserted: 0, skipped: 0, total: 0 };
  }

  const headers = rows[0].map(normalizeHeader);
  const colIndex = {};
  headers.forEach((h, i) => {
    const mapped = SHEET_TO_MODEL[h];
    if (mapped) {
      colIndex[mapped] = i;
    }
  });

  if (colIndex.quotationNumber === undefined) {
    throw new Error("Required column 'QT NO' not found in sheet headers");
  }

  if (colIndex.itemCode === undefined) {
    throw new Error("Required column 'Item Code' not found in sheet headers");
  }

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const qn = (row[colIndex.quotationNumber] || "").trim();
    const ic = (row[colIndex.itemCode] || "").trim();
    if (!qn || qn === "-" || !ic || ic === "-") continue;

    const record = {};
    for (const [field, idx] of Object.entries(colIndex)) {
      const val = idx < row.length ? row[idx] : null;
      record[field] = val !== null && val !== undefined ? String(val).trim() || null : null;
    }
    records.push(record);
  }

  if (records.length === 0) {
    console.log("[SalesContractSync] No valid records to insert");
    return { inserted: 0, skipped: 0, total: 0 };
  }

  let totalInserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.salesContract.createMany({
        data: batch,
        skipDuplicates: true,
      });
      totalInserted += result.count;
    } catch (err) {
      console.error(`[SalesContractSync] Batch insert error (row ${i}): ${err.message}`);
    }
  }

  console.log(`[SalesContractSync] Done: ${totalInserted} inserted, ${records.length - totalInserted} skipped (duplicates), ${records.length} total from sheet`);
  return { inserted: totalInserted, skipped: records.length - totalInserted, total: records.length };
}
