#!/usr/bin/env node
/**
 * costingJobReport.mjs
 *
 * Nightly costing-job breakdown. Queries the DB after steps 1-3 of the
 * scheduled job and records a "nightly" row in the CostingScanRun table:
 * total tenders, network attachments (ENC1.), AppSheet/Drive URLs (http),
 * dockets with no attachment, and dockets already parsed.
 *
 * The breakdown is also printed to the console (appended by
 * run-costing-scan.cmd to logs\costing-scan-console.log).
 *
 * Usage:
 *   node scripts/costingJobReport.mjs
 */
import fs from "fs";
import path from "path";

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

async function createRun(prisma) {
  try {
    const rec = await prisma.costingScanRun.create({
      data: {
        startedAt: new Date(),
        status: "running",
        source: "nightly",
      },
    });
    return rec.id;
  } catch (err) {
    console.warn(`[JobReport] Could not create run log: ${err.message}`);
    return null;
  }
}

/**
 * Reads the queue-push summary written by pushCostingToQueue.mjs (step 3).
 * Returns zeros if the file is missing (step not run).
 */
function readQueuePush() {
  const file = path.resolve(process.cwd(), "logs", "last-queue-push.json");
  try {
    if (!fs.existsSync(file)) return { published: 0, failed: 0, skippedNoUrl: 0, skippedParsed: 0 };
    const text = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
    const data = JSON.parse(text);
    return {
      published: Number(data.published || 0),
      failed: Number(data.failed || 0),
      skippedNoUrl: Number(data.skippedNoUrl || 0),
      skippedParsed: Number(data.skippedParsed || 0),
    };
  } catch (err) {
    console.warn(`[JobReport] Could not read last-queue-push.json: ${err.message}`);
    return { published: 0, failed: 0, skippedNoUrl: 0, skippedParsed: 0 };
  }
}

async function finishRun(prisma, runId, counts, durationMs, errorMsg) {
  if (!runId) return;
  try {
    await prisma.costingScanRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        durationMs,
        total: counts.total,
        networkCount: counts.networkCount,
        appsheetCount: counts.appsheetCount,
        noAttachment: counts.noAttachment,
        parsedCount: counts.parsedCount,
        queuePublished: counts.queuePublished,
        queueFailed: counts.queueFailed,
        queueSkippedNoUrl: counts.queueSkippedNoUrl,
        queueSkippedParsed: counts.queueSkippedParsed,
        status: errorMsg ? "error" : "success",
        error: errorMsg ? String(errorMsg).slice(0, 2000) : null,
      },
    });
  } catch (err) {
    console.warn(`[JobReport] Could not finalize run log: ${err.message}`);
  }
}

async function main() {
  loadEnv();
  const prisma = await createPrisma();
  const runStartedAt = Date.now();
  let runId = null;
  let runError = null;
  const counts = {
    total: 0,
    networkCount: 0,
    appsheetCount: 0,
    noAttachment: 0,
    parsedCount: 0,
    queuePublished: 0,
    queueFailed: 0,
    queueSkippedNoUrl: 0,
    queueSkippedParsed: 0,
  };

  try {
    const rows = await prisma.$queryRaw`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE "attachmentUrl" LIKE 'ENC1.%')::int AS network_count,
        count(*) FILTER (WHERE "attachmentUrl" LIKE 'http%')::int AS appsheet_count,
        count(*) FILTER (WHERE "attachmentUrl" IS NULL OR "attachmentUrl" = '' OR "attachmentUrl" = '-')::int AS no_attachment,
        count(*) FILTER (
          WHERE BTRIM(COALESCE("cvaValue",'')) NOT IN ('','-')
             OR BTRIM(COALESCE("proposedQty",'')) NOT IN ('','-')
        )::int AS parsed_count
      FROM "SmartsheetTender"
    `;
    const row = rows && rows[0] ? rows[0] : {};
    counts.total = Number(row.total || 0);
    counts.networkCount = Number(row.network_count || 0);
    counts.appsheetCount = Number(row.appsheet_count || 0);
    counts.noAttachment = Number(row.no_attachment || 0);
    counts.parsedCount = Number(row.parsed_count || 0);

    const queue = readQueuePush();
    counts.queuePublished = queue.published;
    counts.queueFailed = queue.failed;
    counts.queueSkippedNoUrl = queue.skippedNoUrl;
    counts.queueSkippedParsed = queue.skippedParsed;

    runId = await createRun(prisma);

    console.log("[JobReport] ── NIGHTLY COSTING BREAKDOWN ──");
    console.log(`Total tenders        : ${counts.total}`);
    console.log(`Network attachments  : ${counts.networkCount}`);
    console.log(`AppSheet/Drive URLs  : ${counts.appsheetCount}`);
    console.log(`No attachment        : ${counts.noAttachment}`);
    console.log(`Parsed costing       : ${counts.parsedCount}`);
    console.log(`Queue published      : ${counts.queuePublished}${counts.queueFailed ? ` (failed ${counts.queueFailed})` : ""}`);
  } catch (err) {
    runError = err.message || String(err);
    console.error("[JobReport] Error:", runError);
  } finally {
    await finishRun(prisma, runId, counts, Date.now() - runStartedAt, runError).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }

  if (runError) process.exit(1);
}

main().catch((err) => {
  console.error("[JobReport] Fatal:", err.message || err);
  process.exit(1);
});