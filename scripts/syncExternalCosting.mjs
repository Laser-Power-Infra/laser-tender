#!/usr/bin/env node
/**
 * syncExternalCosting.mjs
 *
 * Reads docket numbers from the `smartsheetTender` table, calls an external
 * `/api/external` endpoint with them, and updates costing fields in the DB
 * against each docket number.
 *
 * Usage:
 *   node scripts/syncExternalCosting.mjs             # real run (writes DB)
 *   node scripts/syncExternalCosting.mjs --inspect   # preview API response + mapping, NO DB writes
 *   node scripts/syncExternalCosting.mjs --limit 10  # only process the first 10 dockets
 *   node scripts/syncExternalCosting.mjs --inspect --limit 3
 *
 * To test with your own docket numbers, fill CUSTOM_DOCKETS below
 * (overrides the DB list).
 *
 * Env (next-app/.env):
 *   EXTERNAL_API_URL        (required) full URL of the external API
 *   EXTERNAL_API_KEY        (optional) sent as `Authorization: Bearer <key>`
 *   EXTERNAL_API_BATCH_SIZE (optional, default 500) dockets per API request
 */
import fs from "fs";
import path from "path";
import {
  mapRecord,
  extractDocket,
  extractRecords,
  parseJsonish,
  cleanFloat,
  normalizeKey,
} from "../lib/costingMapping.mjs";

// ── Config ──────────────────────────────────────────────────────────────────
const inspectMode = process.argv.includes("--inspect");
const BATCH_SIZE = Number(
  process.env.EXTERNAL_API_BATCH_SIZE || process.env.API_BATCH_SIZE || 500,
);
const WRITE_BATCH = 100;
const limitIdx = process.argv.indexOf("--limit");
const LIMIT =
  limitIdx !== -1 && process.argv[limitIdx + 1]
    ? Number(process.argv[limitIdx + 1])
    : null;

// ── Custom dockets ──────────────────────────────────────────────────────────
// Put your own docket/reference numbers here to test the API with them.
// When non-empty, this list is used INSTEAD of reading dockets from the DB.
const CUSTOM_DOCKETS = [
  // "L7265312C",
  // "20275",
  // "19976",
  // "ENQ-20581-25-26",
  // "ENQ-20454-25-26",
  // "ENQ-20690-25-26",
  // "ENQ-19963-25-26",
];

// ── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  let envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    envPath = path.resolve("d:/tender-execuutive-dashboard", ".env");
  }
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const regex = /^\s*([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\n\r]*))/gm;
    let match;
    while ((match = regex.exec(envContent)) !== null) {
      const key = match[1];
      const value = match[2] || match[3] || match[4] || "";
      if (!(key in process.env)) {
        process.env[key] = value.trim();
      }
    }
  }
}

// ?? Inspect-mode display helpers (kept locally) ????????????????????????
function matchMaterialField(materialName) {
  const name = String(materialName || "").trim();
  if (!name) return null;
  if (/round\s+wire/i.test(name)) return null; // no DB column for round wire
  for (const { field, re } of MATERIAL_PATTERNS_LOCAL) {
    if (re.test(name)) return field;
  }
  return null;
}

const MATERIAL_PATTERNS_LOCAL = [
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

function analyzeRawMaterials(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const out = [];
  for (const [matName, matVal] of Object.entries(parsed)) {
    const column = matchMaterialField(matName);
    out.push({
      material: matName,
      column,
      value: cleanFloat(matVal),
      matched: column !== null,
    });
  }
  return out;
}

function findRawMaterials(record) {
  for (const [k, v] of Object.entries(record)) {
    const nk = normalizeKey(k);
    if (nk === "rawmaterials" || nk === "rawmaterial") return parseJsonish(v);
  }
  return null;
}


// ── Prisma client (mirrors prisma/prismaClient.js setup) ─────────────────────
async function createPrisma() {
  const { PrismaClient } = await import("../generated/prisma/index.js");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pg = (await import("pg")).default;

  const pool = new pg.Pool({
    connectionString:
      process.env.ENVIRONMENT === "PROD"
        ? process.env.DATABASE_URL
        : process.env.DATABASE_URL_DEV,
    max: 5,
    connectionTimeoutMillis: 15000,
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// ── Inspect-mode display helpers ─────────────────────────────────────────────
function buildUpsertPayload(docket, fields) {
  const data = { ...fields, lastSyncedAt: new Date() };
  const keys = Object.keys(data);
  const width = Math.max(...keys.map((k) => k.length));
  const fmtVal = (v) => {
    if (v === null || v === undefined) return "null";
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    return typeof v === "string" ? JSON.stringify(v) : String(v);
  };
  const lines = keys.map(
    (k) => `      ${k.padEnd(width)}: ${fmtVal(data[k])},`,
  );
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
  return `  prisma.smartsheetTender.update({\n    where: { docketNumber: ${JSON.stringify(docket ?? null)} },\n    data: {\n${lines.join("\n")}\n    }\n  })`;
}

function logRawMaterials(parsed) {
  const entries = analyzeRawMaterials(parsed);
  if (entries.length === 0) {
    console.log("    (no raw materials)");
    return;
  }
  const colWidth = Math.max(...entries.map((e) => (e.column || "").length));
  for (const e of entries) {
    if (e.matched) {
      console.log(
        `    ${e.material.padEnd(30)} -> ${e.column.padEnd(colWidth)} = ${e.value}`,
      );
    } else {
      console.log(`    ${e.material.padEnd(30)} -> (UNMATCHED, skipped)`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();

  const apiUrl = process.env.EXTERNAL_API_URL;
  if (!apiUrl) {
    console.error("ERROR: EXTERNAL_API_URL is not set in .env");
    process.exit(1);
  }

  const apiKey = process.env.EXTERNAL_API_KEY || null;

  console.log(`[SyncCosting] API: ${apiUrl}`);
  console.log(
    `[SyncCosting] Mode: ${inspectMode ? "INSPECT (no DB writes)" : "LIVE"}`,
  );
  console.log(`[SyncCosting] Batch size: ${BATCH_SIZE} dockets/request`);

  const prisma = await createPrisma();

  try {
    // 1. Load docket numbers (custom array overrides the DB query)
    let dockets;
    if (CUSTOM_DOCKETS.length > 0) {
      dockets = CUSTOM_DOCKETS.map((d) => String(d || "").trim()).filter(
        (d) => d && d !== "-",
      );
      console.log(
        `[SyncCosting] Using ${dockets.length} custom dockets from CUSTOM_DOCKETS`,
      );
    } else {
      console.log("[SyncCosting] Reading docket numbers from DB...");
      const rows = await prisma.smartsheetTender.findMany({
        select: { docketNumber: true },
        where: { docketNumber: { not: null } },
      });
      dockets = rows
        .map((r) => (r.docketNumber || "").trim())
        .filter((d) => d && d !== "-");
    }
    if (LIMIT && LIMIT > 0) dockets.length = Math.min(dockets.length, LIMIT);
    console.log(
      `[SyncCosting] ${dockets.length} dockets loaded${LIMIT ? ` (limited to ${LIMIT})` : ""}`,
    );
    console.log(`[SyncCosting] Dockets: ${dockets.join(", ")}`);

    if (dockets.length === 0) {
      console.log("[SyncCosting] No dockets to process.");
      return;
    }

    // 2. Call the external API in batches
    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["x-api-key"] = apiKey;
    }

    const pairs = [];
    const noDataDockets = [];
    const allEchoed = [];
    let apiRecordCount = 0;
    const totalBatches = Math.ceil(dockets.length / BATCH_SIZE);

    for (let i = 0; i < dockets.length; i += BATCH_SIZE) {
      const batch = dockets.slice(i, i + BATCH_SIZE);
      const batchNo = Math.floor(i / BATCH_SIZE) + 1;
      const body = JSON.stringify({ referenceNos: batch });

      console.log(
        `[SyncCosting] Calling API (batch ${batchNo}/${totalBatches}, ${batch.length} dockets)...`,
      );
      let response;
      try {
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body,
        });
      } catch (err) {
        console.error(
          `[SyncCosting] API request failed (batch ${batchNo}): ${err.message}`,
        );
        if (inspectMode) throw err;
        continue;
      }
      // console.dir(await response.json(), { depth: 5, colors: true });
      if (!response.ok) {
        let text = "";
        try {
          text = await response.text();
        } catch (_) {
          // ignore
        }
        console.error(
          `[SyncCosting] API returned ${response.status} (batch ${batchNo}): ${text.slice(0, 300)}`,
        );
        if (inspectMode) throw new Error(`API status ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const { records, echoed, notFound } = extractRecords(payload);
      allEchoed.push(...echoed);
      apiRecordCount += records.length;

      // ── Match each record to our sent dockets by docketNo (not position!) ──
      const batchMatched = new Set();
      for (const record of records) {
        const recordDocket = extractDocket(record);
        if (!recordDocket) {
          console.warn(`[SyncCosting]   Record has no docketNo — skipping.`);
          continue;
        }
        const match = batch.find(
          (d) =>
            d.toLowerCase() === recordDocket.toLowerCase() &&
            !batchMatched.has(d),
        );
        if (match) {
          batchMatched.add(match);
          pairs.push({ docket: match, record });
        } else {
          console.warn(
            `[SyncCosting]   Record docketNo "${recordDocket}" not in this batch — skipping.`,
          );
        }
      }

      // Mark unmatched batch dockets as no-data
      for (const d of batch) {
        if (!batchMatched.has(d)) noDataDockets.push(d);
      }

      // Cross-check: if a record matched a docket that the API also listed as notFound, warn
      for (const d of notFound) {
        if (batchMatched.has(d)) {
          console.warn(
            `[SyncCosting]   API notFound includes "${d}" but we matched a record — verify data.`,
          );
        }
      }

      // Safety: records returned but none matched by docketNo
      if (records.length > 0 && batchMatched.size === 0) {
        console.warn(
          `[SyncCosting] WARNING: API returned ${records.length} record(s) but none matched our docket numbers. No data written for this batch.`,
        );
      }

      console.log(
        `[SyncCosting]   -> ${batchMatched.size} records matched by docketNo` +
          (batchMatched.size < batch.length
            ? `, ${batch.length - batchMatched.size} docket(s) had no data`
            : "") +
          (notFound.length ? `, ${notFound.length} API notFound` : ""),
      );

      if (inspectMode) break; // only inspect the first batch
    }

    console.log(`[SyncCosting] Total API records received: ${apiRecordCount}`);
    if (noDataDockets.length) {
      console.log(
        `[SyncCosting] No data returned for: ${noDataDockets.join(", ")}`,
      );
    }

    // 3. Map records (fields keyed by OUR docket number)
    const mapped = [];
    for (const p of pairs) {
      mapped.push({
        docket: p.docket,
        record: p.record,
        fields: mapRecord(p.record),
      });
    }

    if (inspectMode) {
      console.log("\n[SyncCosting] ── INSPECT PREVIEW ──");
      console.log(`Sent ${dockets.length} docket(s): ${dockets.join(", ")}`);
      console.log(`Received ${apiRecordCount} record(s) from the API.\n`);

      for (let idx = 0; idx < pairs.length; idx++) {
        const { docket, record } = pairs[idx];
        const fields = mapRecord(record);

        console.log(
          `[${idx + 1}] ── DOCKET: ${docket} (matched via docketNo) ──`,
        );
        console.log(`  DB row: ${docket} (we sent it → will update this row)`);

        console.log("\n  ── RAW RECORD ──");
        console.log(JSON.stringify(record, null, 2));

        console.log("\n  ── UPSERT PAYLOAD (final data after separation) ──");
        console.log(buildUpsertPayload(docket, fields));

        console.log("\n  ── RAW MATERIALS → COLUMNS ──");
        logRawMaterials(findRawMaterials(record));

        console.log("");
      }

      console.log(`Matched ${pairs.length} of ${dockets.length} sent.`);
      if (noDataDockets.length) {
        console.log(`No data returned for: ${noDataDockets.join(", ")}`);
      }
      if (allEchoed.length) {
        console.log(`API echoed (no data): ${allEchoed.join(", ")}`);
      }
      console.log("No DB writes performed (inspect mode).");
      return;
    }

    // 4. Update DB (only dockets that exist in the table)
    let updated = 0;
    let skipped = 0;
    let missing = 0;
    let failed = 0;

    const toWrite = mapped.filter((m) =>
      Object.values(m.fields).some((v) => v !== null && v !== undefined),
    );
    missing = dockets.length - toWrite.length;

    for (let i = 0; i < toWrite.length; i += WRITE_BATCH) {
      const batch = toWrite.slice(i, i + WRITE_BATCH);
      const ops = batch.map((m) =>
        prisma.smartsheetTender.update({
          where: { docketNumber: m.docket },
          data: { ...m.fields, lastSyncedAt: new Date() },
        }),
      );
      try {
        await prisma.$transaction(ops, { maxWait: 5000, timeout: 30000 });
        updated += ops.length;
      } catch (err) {
        // fall back to per-row updates to isolate failures
        for (const m of batch) {
          try {
            await prisma.smartsheetTender.update({
              where: { docketNumber: m.docket },
              data: { ...m.fields, lastSyncedAt: new Date() },
            });
            updated++;
          } catch (rowErr) {
            failed++;
            console.warn(
              `[SyncCosting] FAILED docket ${m.docket}: ${rowErr.message}`,
            );
          }
        }
      }
      const done = Math.min(i + WRITE_BATCH, toWrite.length);
      console.log(`[SyncCosting] Wrote ${done}/${toWrite.length}`);
    }

    console.log("\n[SyncCosting] ── SUMMARY ──");
    console.log(`API records received : ${apiRecordCount}`);
    console.log(`No data for          : ${noDataDockets.length}`);
    console.log(`Echoed (no data)     : ${allEchoed.length}`);
    console.log(`Mapped               : ${mapped.length}`);
    console.log(`Not written (skipped): ${missing}`);
    console.log(`Updated              : ${updated}`);
    console.log(`Failed               : ${failed}`);
    console.log(
      `DB dockets untouched : ${dockets.length - (updated + missing + failed) >= 0 ? dockets.length - updated - missing - failed : 0}`,
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[SyncCosting] Fatal:", err.message || err);
  process.exit(1);
});
