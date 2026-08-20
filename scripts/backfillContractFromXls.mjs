#!/usr/bin/env node
/**
 * One-time backfill: match QUOTATION_VRNO (Sales_Contract sheet) with
 * SmartsheetTender.quotationNumber / SalesContract.quotationNumber
 * and fill contractNo / contractNumber with comma-separated VRNO_Sales_Contract
 * ordered by VRDATE.
 *
 * Usage:
 *   node scripts/backfillContractFromXls.mjs --dry-run
 *   node scripts/backfillContractFromXls.mjs --force
 *   node scripts/backfillContractFromXls.mjs --xls="Tenders Details - Puja (1).xls"
 */

import fs from "fs";
import path from "path";
import pkg from "xlsx";
const XLSX = pkg.default ?? pkg;
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// auto-load .env if present (simple parser, no dotenv dep)
try {
  const envPath = path.join(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, "utf8");
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.replace(/\\n/g, "\n");
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {}

// --- args ---
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");
const xlsArg = args.find((a) => a.startsWith("--xls="));
const xlsFileName = xlsArg ? xlsArg.split("=").slice(1).join("=") : "Tenders Details - Puja (1).xls";
const xlsPath = path.isAbsolute(xlsFileName) ? xlsFileName : path.join(projectRoot, xlsFileName);

// --- helpers ---
const normQ = (s) => String(s ?? "").trim().toUpperCase();
const normC = (s) => String(s ?? "").trim();

function parseXls() {
  if (!fs.existsSync(xlsPath)) {
    throw new Error(`XLS file not found: ${xlsPath}`);
  }
  const wb = XLSX.readFile(xlsPath, { cellDates: false });
  const ws = wb.Sheets["Sales_Contract"];
  if (!ws) throw new Error(`Sheet 'Sales_Contract' not found. Sheets: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length < 2) throw new Error("Sales_Contract sheet has no data rows");
  const header = rows[0];
  // indices
  let qIdx = header.findIndex((h) => String(h).trim() === "QUOTATION_VRNO");
  let cIdx = header.findIndex((h) => String(h).trim() === "VRNO_Sales_Contract");
  let dIdx = header.findIndex((h) => String(h).trim() === "VRDATE");
  if (qIdx === -1 || cIdx === -1) {
    // fallback case-insensitive
    qIdx = header.findIndex((h) => String(h).toLowerCase().includes("quotation"));
    cIdx = header.findIndex((h) => String(h).toUpperCase().includes("VRNO") && String(h).toUpperCase().includes("SALES"));
  }
  if (qIdx === -1 || cIdx === -1) throw new Error(`Header not found: ${header}`);

  const map = new Map(); // normQ -> { byDate: [{c,d,rawQ,rawC}], set: Set }
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawQ = r[qIdx];
    const rawC = r[cIdx];
    const rawD = dIdx !== -1 ? r[dIdx] : null;
    const q = normQ(rawQ);
    if (!q || q === "-" ) continue;
    const c = normC(rawC);
    if (!c || c === "-" || c.toLowerCase() === "null") continue;
    // VRDATE may be excel serial or string; normalize to number for sorting
    let dNum = 0;
    if (rawD != null && rawD !== "") {
      if (typeof rawD === "number") dNum = rawD;
      else {
        const n = Number(String(rawD).trim());
        if (!isNaN(n)) dNum = n;
        else {
          const parsed = Date.parse(String(rawD));
          dNum = isNaN(parsed) ? 0 : parsed;
        }
      }
    }
    if (!map.has(q)) map.set(q, { byDate: [], seen: new Set() });
    const entry = map.get(q);
    // dedup identical contract strings for same Q
    const cNorm = c.toUpperCase();
    if (entry.seen.has(cNorm)) continue;
    entry.seen.add(cNorm);
    entry.byDate.push({ c, d: dNum });
  }

  // resolve to comma-separated ordered by date ASC (stable)
  const resolved = new Map(); // normQ -> csv
  for (const [q, entry] of map.entries()) {
    entry.byDate.sort((a, b) => a.d - b.d);
    const csv = entry.byDate.map((x) => x.c).join(", ");
    resolved.set(q, csv);
  }

  // stats
  const totalDistinctQ = resolved.size;
  // count raw distinct Q total from sheet (including those with no contract)
  const allQSet = new Set();
  for (let i = 1; i < rows.length; i++) {
    const q = normQ(rows[i][qIdx]);
    if (q && q !== "-") allQSet.add(q);
  }
  const multiCount = [...resolved.values()].filter((v) => v.includes(",")).length;
  const singleCount = totalDistinctQ - multiCount;
  const noContract = allQSet.size - totalDistinctQ;

  return {
    header,
    qIdx,
    cIdx,
    dIdx,
    resolved,
    stats: {
      totalRows: rows.length - 1,
      allDistinctQ: allQSet.size,
      withContract: totalDistinctQ,
      single: singleCount,
      multi: multiCount,
      noContract,
    },
    rawMap: map,
  };
}

async function getPrismaClient() {
  // Replicate lib/prisma.ts without alias, for plain node ESM execution
  const { PrismaClient } = await import("../generated/prisma/client.js");
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

async function backfillDb(resolved, stats) {
  const client = await getPrismaClient();

  // --- SmartsheetTender ---
  console.log("[Backfill] Fetching SmartsheetTender...");
  const tenders = await client.smartsheetTender.findMany({
    select: { id: true, quotationNumber: true, contractNo: true, docketNumber: true },
  });
  console.log(`[Backfill] SmartsheetTender rows: ${tenders.length}`);

  let tenderMatched = 0;
  let tenderToUpdate = [];
  let tenderSkippedAlreadyCorrect = 0;
  let tenderSkippedHasValue = 0;
  let tenderNoMatch = 0;

  for (const t of tenders) {
    const q = normQ(t.quotationNumber);
    if (!q) { tenderNoMatch++; continue; }
    const csv = resolved.get(q);
    if (!csv) { tenderNoMatch++; continue; }
    tenderMatched++;
    const existing = t.contractNo ? normC(t.contractNo) : "";
    if (existing === csv) {
      tenderSkippedAlreadyCorrect++;
      continue;
    }
    if (existing !== "" && !isForce) {
      tenderSkippedHasValue++;
      continue;
    }
    tenderToUpdate.push({ id: t.id, quotationNumber: t.quotationNumber, docketNumber: t.docketNumber, from: t.contractNo, to: csv });
  }

  console.log(`[Backfill] SmartsheetTender matched quotations: ${tenderMatched}, toUpdate: ${tenderToUpdate.length}, alreadyCorrect: ${tenderSkippedAlreadyCorrect}, skippedHasValue(no --force): ${tenderSkippedHasValue}, noMatch: ${tenderNoMatch}`);
  if (tenderToUpdate.length > 0) {
    console.log("[Backfill] Sample SmartsheetTender updates (first 10):");
    tenderToUpdate.slice(0, 10).forEach((u) => console.log(`  ${u.quotationNumber} (${u.docketNumber}) "${u.from ?? ""}" -> "${u.to}"`));
  }

  // --- SalesContract ---
  console.log("[Backfill] Fetching SalesContract...");
  const contracts = await client.salesContract.findMany({
    select: { id: true, quotationNumber: true, contractNumber: true, itemCode: true },
  });
  console.log(`[Backfill] SalesContract rows: ${contracts.length}`);

  let salesMatched = 0;
  let salesToUpdate = [];
  let salesSkippedAlreadyCorrect = 0;
  let salesSkippedHasValue = 0;
  let salesNoMatch = 0;

  for (const s of contracts) {
    const q = normQ(s.quotationNumber);
    if (!q) { salesNoMatch++; continue; }
    const csv = resolved.get(q);
    if (!csv) { salesNoMatch++; continue; }
    salesMatched++;
    const existing = s.contractNumber ? normC(s.contractNumber) : "";
    if (existing === csv) {
      salesSkippedAlreadyCorrect++;
      continue;
    }
    if (existing !== "" && !isForce) {
      salesSkippedHasValue++;
      continue;
    }
    salesToUpdate.push({ id: s.id, quotationNumber: s.quotationNumber, itemCode: s.itemCode, from: s.contractNumber, to: csv });
  }

  console.log(`[Backfill] SalesContract matched: ${salesMatched}, toUpdate: ${salesToUpdate.length}, alreadyCorrect: ${salesSkippedAlreadyCorrect}, skippedHasValue: ${salesSkippedHasValue}, noMatch: ${salesNoMatch}`);
  if (salesToUpdate.length > 0) {
    console.log("[Backfill] Sample SalesContract updates (first 10):");
    salesToUpdate.slice(0, 10).forEach((u) => console.log(`  ${u.quotationNumber} | ${u.itemCode} "${u.from ?? ""}" -> "${u.to}"`));
  }

  if (isDryRun) {
    console.log("[Backfill] DRY RUN — no DB writes.");
    return { tenderToUpdate, salesToUpdate, tenderMatched, salesMatched };
  }

  const BATCH = 100;
  let tenderUpdated = 0;
  for (let i = 0; i < tenderToUpdate.length; i += BATCH) {
    const batch = tenderToUpdate.slice(i, i + BATCH);
    const ops = batch.map((u) => client.smartsheetTender.update({ where: { id: u.id }, data: { contractNo: u.to } }));
    const res = await client.$transaction(ops);
    tenderUpdated += res.length;
    console.log(`[Backfill] SmartsheetTender batch ${Math.floor(i / BATCH) + 1}: ${res.length} updated`);
  }

  let salesUpdated = 0;
  for (let i = 0; i < salesToUpdate.length; i += BATCH) {
    const batch = salesToUpdate.slice(i, i + BATCH);
    const ops = batch.map((u) => client.salesContract.update({ where: { id: u.id }, data: { contractNumber: u.to } }));
    const res = await client.$transaction(ops);
    salesUpdated += res.length;
    console.log(`[Backfill] SalesContract batch ${Math.floor(i / BATCH) + 1}: ${res.length} updated`);
  }

  console.log(`[Backfill] DONE: SmartsheetTender ${tenderUpdated}/${tenderToUpdate.length} updated, SalesContract ${salesUpdated}/${salesToUpdate.length} updated.`);
  return { tenderUpdated, salesUpdated };
}

async function main() {
  console.log(`[Backfill] XLS path: ${xlsPath}`);
  console.log(`[Backfill] Flags: dryRun=${isDryRun} force=${isForce}`);
  const { resolved, stats } = parseXls();
  console.log(`[Backfill] XLS stats: totalRows=${stats.totalRows}, allDistinctQ=${stats.allDistinctQ}, withContract=${stats.withContract} (single=${stats.single}, multi=${stats.multi}), noContract=${stats.noContract}`);
  console.log(`[Backfill] Resolved map size: ${resolved.size}`);
  // sample multi
  const multiSamples = [...resolved.entries()].filter(([_, v]) => v.includes(",")).slice(0, 3);
  if (multiSamples.length) {
    console.log("[Backfill] Multi-contract samples (comma-separated, ordered by VRDATE):");
    multiSamples.forEach(([q, csv]) => console.log(`  ${q} -> ${csv}`));
  }
  const singleSample = [...resolved.entries()].find(([_, v]) => !v.includes(","));
  if (singleSample) console.log(`[Backfill] Single sample: ${singleSample[0]} -> ${singleSample[1]}`);

  // If dry-run and no DB needed, we can exit early if --xls-only, but we proceed to DB mock if possible
  // Try DB backfill; if DATABASE_URL missing, just show XLS parsing result
  const hasDbEnv = !!(process.env.DATABASE_URL || process.env.DATABASE_URL_DEV);
  if (!hasDbEnv) {
    console.warn("[Backfill] No DATABASE_URL / DATABASE_URL_DEV env — skipping DB phase. Set env and re-run without --dry-run to write.");
    console.log("[Backfill] Dry-run XLS parsing complete (no DB).");
    return;
  }

  try {
    await backfillDb(resolved, stats);
  } catch (err) {
    console.error("[Backfill] DB error:", err?.message ?? err);
    console.error(err?.stack);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
