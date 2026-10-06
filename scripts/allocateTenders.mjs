#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const envText = await fs.readFile(path.join(projectRoot, ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value.replace(/\\n/g, "\n");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const isDryRun = process.argv.slice(2).includes("--dry-run");
const outputArg = process.argv.slice(2).find((arg) => arg.startsWith("--out="));
const outputPath = outputArg
  ? path.resolve(projectRoot, outputArg.slice("--out=".length))
  : path.join(projectRoot, "scripts", "output", "allocation-dry-run.json");

const { PrismaClient } = await import("../generated/prisma/client.js");
const { PrismaPg } = await import("@prisma/adapter-pg");
const pg = (await import("pg")).default;
const connectionString = process.env.ENVIRONMENT === "PROD"
  ? process.env.DATABASE_URL
  : process.env.DATABASE_URL_DEV;
if (!connectionString) throw new Error("Database connection string is not configured.");

const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 15000 });
const client = new PrismaClient({ adapter: new PrismaPg(pool) });

const categories = ["null", "tender", "budgetary", "purchase"];
const assignees = ["PRITIKANA", "RITWICK"];
const accountHolders = ["PUJA AGARWAL", "SK TOUHID ALAM"];
const classify = (value) => {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "null";
  if (normalized.includes("budgetary") || normalized.includes("bugetary")) return "budgetary";
  if (normalized.includes("tender")) return "tender";
  if (normalized.includes("purchase")) return "purchase";
  return "null";
};

try {
  const records = await client.smartsheetTender.findMany({
    where: { allocatedTo: null, accountHolder: { in: accountHolders } },
    select: { id: true, docketNumber: true, accountHolder: true, tenderPurchase: true, allocatedTo: true },
  });
  const grouped = new Map(categories.map((category) => [category, []]));
  for (const row of records) grouped.get(classify(row.tenderPurchase)).push(row);
  for (const rows of grouped.values()) {
    rows.sort((a, b) => (a.docketNumber ?? "").localeCompare(b.docketNumber ?? "", undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id));
  }

  const byCategory = Object.fromEntries(categories.map((category) => [category, {
    total: 0, PRITIKANA: 0, RITWICK: 0, skipped: 0,
  }]));
  const assignments = [];
  let index = 0;
  for (const category of categories) {
    for (const row of grouped.get(category)) {
      const assignee = assignees[index++ % assignees.length];
      byCategory[category].total += 1;
      byCategory[category][assignee] += 1;
      assignments.push({
        id: row.id,
        docketNumber: row.docketNumber,
        accountHolder: row.accountHolder,
        tenderPurchase: row.tenderPurchase,
        category,
        before: { allocatedTo: row.allocatedTo },
        after: { allocatedTo: assignee },
      });
    }
  }

  let updatedIds = new Set();
  if (!isDryRun && assignments.length) {
    const now = new Date();
    await client.$transaction(async (tx) => {
      for (const assignee of assignees) {
        const ids = assignments.filter((row) => row.after.allocatedTo === assignee).map((row) => row.id);
        for (let offset = 0; offset < ids.length; offset += 100) {
          await tx.smartsheetTender.updateMany({
            where: { id: { in: ids.slice(offset, offset + 100) }, allocatedTo: null, accountHolder: { in: accountHolders } },
            data: { allocatedTo: assignee, lastSyncedAt: now },
          });
        }
      }
    }, { maxWait: 5000, timeout: 30000 });

    const updatedRows = await client.smartsheetTender.findMany({
      where: {
        OR: assignees.map((assignee) => ({
          id: { in: assignments.filter((row) => row.after.allocatedTo === assignee).map((row) => row.id) },
          allocatedTo: assignee,
          lastSyncedAt: now,
        })),
      },
      select: { id: true },
    });
    updatedIds = new Set(updatedRows.map((row) => row.id));
    for (const assignment of assignments) {
      if (updatedIds.has(assignment.id)) continue;
      const category = byCategory[assignment.category];
      category.skipped += 1;
      category[assignment.after.allocatedTo] -= 1;
      category.total -= 1;
      assignment.after.allocatedTo = assignment.before.allocatedTo;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    mode: isDryRun ? "dry-run" : "live",
    filters: { allocatedTo: null, accountHolders },
    assignees,
    summary: {
      totalMatched: records.length,
      totalUpdated: isDryRun ? 0 : updatedIds.size,
      byCategory,
    },
    rows: assignments,
  };

  if (isDryRun) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`[Allocation] Dry run: ${records.length} rows; JSON written to ${outputPath}`);
  } else {
    console.log(`[Allocation] Updated ${updatedIds.size}/${records.length} rows.`);
    console.log(JSON.stringify(byCategory, null, 2));
  }
} finally {
  await client.$disconnect();
  await pool.end();
}
