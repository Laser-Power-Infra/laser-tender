#!/usr/bin/env node
/**
 * scanCostingFiles.mjs
 *
 * Recursively searches the costing network folder (Z:\COSTING & INVOLVEMENT)
 * for each docket number that does not yet have an attachmentUrl, and stores
 * the matching Excel file as an encrypted "ENC1." value wrapping
 * "network|<relative-path>". Plain URLs (Drive/AppSheet) are never touched.
 *
 * Usage:
 *   node scripts/scanCostingFiles.mjs             # scan all missing dockets
 *   node scripts/scanCostingFiles.mjs --limit 50  # only process the first 50
 *   node scripts/scanCostingFiles.mjs --docket ENQ-19829-25-26  # single docket
 */
import fs from "fs";
import path from "path";
import { findCostingFileRecursive, extractNumericDocket, encryptStoredPath, buildStoredPath } from "../services/costingFileFinder.mjs";

// ── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
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

const WRITE_BATCH = 50;

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

async function main() {
  loadEnv();

  const limitIdx = process.argv.indexOf("--limit");
  const LIMIT = limitIdx !== -1 && process.argv[limitIdx + 1]
    ? Number(process.argv[limitIdx + 1])
    : null;
  const docketIdx = process.argv.indexOf("--docket");
  const SINGLE_DOCKET = docketIdx !== -1 && process.argv[docketIdx + 1]
    ? String(process.argv[docketIdx + 1]).trim()
    : null;

  const prisma = await createPrisma();

  try {
    let dockets = [];
    if (SINGLE_DOCKET) {
      dockets = [SINGLE_DOCKET];
    } else {
      console.log("[ScanCosting] Reading dockets without attachmentUrl from DB...");
      const rows = await prisma.smartsheetTender.findMany({
        where: { attachmentUrl: null },
        select: { docketNumber: true },
      });
      dockets = rows
        .map((r) => (r.docketNumber || "").trim())
        .filter((d) => d && d !== "-");
    }

    if (LIMIT && LIMIT > 0) dockets = dockets.slice(0, LIMIT);
    console.log(`[ScanCosting] Processing ${dockets.length} dockets...`);

    let matched = 0;
    let notFound = 0;
    let failed = 0;

    const updates = [];
    for (let i = 0; i < dockets.length; i++) {
      const docket = dockets[i];
      const numeric = extractNumericDocket(docket);
      if (!numeric) {
        notFound++;
        continue;
      }

      let filePath = null;
      try {
        filePath = findCostingFileRecursive(docket);
      } catch (err) {
        console.warn(`[ScanCosting] Search error for ${docket}: ${err.message}`);
        failed++;
        continue;
      }

      if (filePath) {
        updates.push({ docket, path: encryptStoredPath(buildStoredPath(filePath)) });
        matched++;
      } else {
        notFound++;
      }

      if (updates.length >= WRITE_BATCH) {
        await flush(prisma, updates);
        updates.length = 0;
      }

      const done = i + 1;
      process.stdout.write(
        `\r[ScanCosting] ${done}/${dockets.length}  matched=${matched} notFound=${notFound} failed=${failed}`
      );
    }

    if (updates.length > 0) {
      await flush(prisma, updates);
    }

    console.log("");
    console.log("[ScanCosting] ── SUMMARY ──");
    console.log(`Processed  : ${dockets.length}`);
    console.log(`Matched    : ${matched}`);
    console.log(`Not found  : ${notFound}`);
    console.log(`Failed     : ${failed}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function flush(prisma, updates) {
  const ops = updates.map((u) =>
    prisma.smartsheetTender.update({
      where: { docketNumber: u.docket },
      data: { attachmentUrl: u.path, lastSyncedAt: new Date() },
    })
  );
  try {
    await prisma.$transaction(ops, { maxWait: 5000, timeout: 60000 });
  } catch (err) {
    for (const u of updates) {
      try {
        await prisma.smartsheetTender.update({
          where: { docketNumber: u.docket },
          data: { attachmentUrl: u.path, lastSyncedAt: new Date() },
        });
      } catch (rowErr) {
        console.warn(`[ScanCosting] FAILED ${u.docket}: ${rowErr.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[ScanCosting] Fatal:", err.message || err);
  process.exit(1);
});