#!/usr/bin/env node
// One-off: every tender held by PRITIKANA or RITWICK keeps that name and gets
// TASHMITA or AKASH added next to it ("PRITIKANA, TASHMITA"), split half and half.
// Safe to re-run: rows that already carry two names no longer match.
// Usage: node scripts/redistributeAllocations.mjs [--dry-run]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(projectRoot, ".env")); } catch (error) { if (error?.code !== "ENOENT") throw error; }

const HOLDERS = ["PRITIKANA", "RITWICK"];
const NEWCOMERS = ["TASHMITA", "AKASH"];
const isDryRun = process.argv.includes("--dry-run");

const connectionString = process.env.ENVIRONMENT === "PROD" ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEV;
if (!connectionString) throw new Error("Database connection string is not configured.");
const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 15000 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  // Alternating by docket within each holder gives both newcomers an even mix of old and new work.
  const { rows } = await client.query(
    `SELECT id, "docketNumber", "allocatedTo" AS before FROM "SmartsheetTender"
     WHERE trim("allocatedTo") = ANY($1) ORDER BY trim("allocatedTo"), "docketNumber", id FOR UPDATE`, [HOLDERS]);
  const moves = rows.map((row, i) => ({ ...row, after: `${row.before.trim()}, ${NEWCOMERS[i % 2]}` }));

  const outputPath = path.join(projectRoot, "scripts", "output", `allocation-add-names-${isDryRun ? "dry-run" : Date.now()}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(moves, null, 2)}\n`, "utf8");

  const counts = {};
  for (const move of moves) counts[move.after] = (counts[move.after] ?? 0) + 1;
  if (!isDryRun) {
    for (const after of Object.keys(counts)) {
      await client.query(
        `UPDATE "SmartsheetTender" SET "allocatedTo" = $1, "lastSyncedAt" = now(), "updatedAt" = now() WHERE id = ANY($2)`,
        [after, moves.filter((move) => move.after === after).map((move) => move.id)]);
    }
  }
  await client.query(isDryRun ? "ROLLBACK" : "COMMIT");

  console.log(`[AddNames] ${isDryRun ? "Dry run" : "Applied"} on ${new URL(connectionString).pathname.slice(1)}: ${moves.length} rows.`);
  console.log("[AddNames] Resulting values:", counts);
  console.log(`[AddNames] Before/after list: ${outputPath}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
