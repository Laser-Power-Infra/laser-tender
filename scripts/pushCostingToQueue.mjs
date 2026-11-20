#!/usr/bin/env node
/**
 * pushCostingToQueue.mjs
 *
 * Standalone version of the dashboard's "Push All to Queue" action
 * (pushCostingToQueue in actions/tenders.ts). Reads tenders from the DB,
 * picks those that have an attachment URL but no parsed costing yet, and
 * publishes a COSTING_ATTACHMENT_PARSING task per docket to RabbitMQ
 * (queue "automation-v2:parsing").
 *
 * Intended to run AFTER the nightly network costing-file scan so files found
 * overnight get queued for parsing.
 *
 * Usage:
 *   node scripts/pushCostingToQueue.mjs             # all eligible dockets
 *   node scripts/pushCostingToQueue.mjs --limit 10  # only the first 10
 *
 * Env (next-app/.env):
 *   RABBITMQ_URL  (required) amqp URL, e.g. amqp://guest:guest@192.168.1.190:5672
 */
import fs from "fs";
import path from "path";
import amqp from "amqplib";
import { decryptStoredPath, isPlainUrl } from "../services/costingFileFinder.mjs";

const QUEUE_TENDER_PARSING = "automation-v2:parsing";

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

const hasParsedCosting = (t) => {
  const cva = (t.cvaValue || "").trim();
  if (cva && cva !== "-") return true;
  const qty = (t.proposedQty || "").trim();
  if (qty && qty !== "-") return true;
  return false;
};

async function main() {
  loadEnv();

  const rabbitUrl = (process.env.RABBITMQ_URL || "").trim();
  if (!rabbitUrl) {
    console.error("[QueuePush] RABBITMQ_URL is not set in .env");
    process.exit(1);
  }

  const limitIdx = process.argv.indexOf("--limit");
  const LIMIT =
    limitIdx !== -1 && process.argv[limitIdx + 1]
      ? Number(process.argv[limitIdx + 1])
      : null;

  const prisma = await createPrisma();
  let connection = null;
  let channel = null;

  try {
    console.log("[QueuePush] Reading tenders from DB...");
    const tenders = await prisma.smartsheetTender.findMany();

    let skippedNoUrl = 0;
    let skippedParsed = 0;
    const eligible = [];
    for (const t of tenders) {
      const url = (t.attachmentUrl || "").trim();
      if (!url || url === "-") {
        skippedNoUrl++;
        continue;
      }
      if (hasParsedCosting(t)) {
        skippedParsed++;
        continue;
      }
      eligible.push(t);
    }

    if (LIMIT && LIMIT > 0) eligible.length = Math.min(eligible.length, LIMIT);
    const total = eligible.length;
    console.log(`[QueuePush] ${total} eligible (${skippedNoUrl} no-url, ${skippedParsed} already parsed)`);

    if (total === 0) {
      console.log("[QueuePush] Nothing to push.");
      return;
    }

    console.log(`[QueuePush] Connecting to RabbitMQ...`);
    connection = await amqp.connect(rabbitUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE_TENDER_PARSING, { durable: true });

    let published = 0;
    let failed = 0;
    const clientId = (process.env.AUTOMATION_V2_CLIENT_ID || "").trim();
    for (const tender of eligible) {
      const stored = (tender.attachmentUrl || "").trim();

      let fileLink = null;
      let fileType = "network";
      if (isPlainUrl(stored)) {
        fileLink = stored;
        fileType = "external";
      } else {
        const decrypted = decryptStoredPath(stored);
        if (decrypted) {
          fileLink = decrypted;
          fileType = "network";
        }
      }

      if (!fileLink) continue;

      // automation-v2 payload: network files use file_type:"network" +
      // decrypted_fileId ("costing|<rel>"); external files use file_link.
      const payload = {
        type: "COSTING_ATTACHMENT_PARSING",
        referenceNo: tender.docketNumber || "",
        sender: "laser_cost",
        timestamp: Date.now(),
        ...(clientId ? { client_id: clientId } : {}),
        ...(fileType === "external"
          ? { file_link: fileLink, file_type: "external" }
          : { file_type: "network", decrypted_fileId: fileLink }),
      };

      const sent = channel.sendToQueue(
        QUEUE_TENDER_PARSING,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true }
      );
      if (sent) published++;
      else failed++;
    }

    console.log("\n[QueuePush] ── SUMMARY ──");
    console.log(`Eligible         : ${total}`);
    console.log(`Published        : ${published}`);
    console.log(`Failed           : ${failed}`);
    console.log(`Skipped (no URL) : ${skippedNoUrl}`);
    console.log(`Skipped (parsed) : ${skippedParsed}`);

    // Persist the summary so costingJobReport.mjs can store it on the nightly
    // CostingScanRun row (the step runs in a separate process).
    try {
      const logsDir = path.resolve(process.cwd(), "logs");
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "last-queue-push.json"),
        JSON.stringify(
          {
            published,
            failed,
            skippedNoUrl,
            skippedParsed,
            total,
            finishedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (err) {
      console.warn(`[QueuePush] Could not write last-queue-push.json: ${err.message}`);
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
    } catch (_) {
      // ignore close errors
    }
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[QueuePush] Fatal:", err.message || err);
  process.exit(1);
});