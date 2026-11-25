#!/usr/bin/env node
// READ-ONLY: reports SmartsheetTender dockets whose financial-year suffix does not
// match the enquiryDate. Writes scripts/output/docket-fy-mismatch.csv. Never modifies data.
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

const pg = (await import("pg")).default;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const outputPath = path.join(projectRoot, "scripts", "output", "docket-fy-mismatch.csv");

// Indian financial year (Apr-Mar): FY starts in the year if month >= April, else the year before.
const expectedSuffixFor = (year, month) => {
  const fyStart = month >= 4 ? year : year - 1;
  const yy = String(fyStart % 100).padStart(2, "0");
  const next = String((fyStart + 1) % 100).padStart(2, "0");
  return `${yy}-${next}`;
};

// Strict YYYY-MM-DD only; anything else (null, DD/MM/YYYY, impossible dates) is unparseable.
const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month };
};

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });

try {
  await client.connect();
  const { rows } = await client.query(
    'SELECT "docketNumber", "enquiryDate", "partyName", "accountHolder" FROM "SmartsheetTender"',
  );

  let noSuffix = 0;
  let unparseableDate = 0;
  let checked = 0;
  const mismatches = [];
  const groups = new Map();

  for (const row of rows) {
    const docket = row.docketNumber ?? "";
    const suffixMatch = /-(\d{2})-(\d{2})$/.exec(docket);
    if (!suffixMatch) {
      noSuffix += 1;
      continue;
    }
    const parsed = parseIsoDate(row.enquiryDate);
    if (!parsed) {
      unparseableDate += 1;
      continue;
    }
    checked += 1;
    const actualSuffix = `${suffixMatch[1]}-${suffixMatch[2]}`;
    const expectedSuffix = expectedSuffixFor(parsed.year, parsed.month);
    if (actualSuffix === expectedSuffix) continue;

    const expectedDocket = docket.slice(0, docket.length - actualSuffix.length) + expectedSuffix;
    mismatches.push({
      docketNumber: docket,
      enquiryDate: row.enquiryDate ?? "",
      actualSuffix,
      expectedSuffix,
      expectedDocket,
      partyName: row.partyName ?? "",
      accountHolder: row.accountHolder ?? "",
    });
    const key = `${actualSuffix} -> ${expectedSuffix}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  mismatches.sort((a, b) => a.docketNumber.localeCompare(b.docketNumber, undefined, { numeric: true, sensitivity: "base" }));

  const header = ["docketNumber", "enquiryDate", "actualSuffix", "expectedSuffix", "expectedDocket", "partyName", "accountHolder"];
  const csv = [header.join(","), ...mismatches.map((m) => header.map((h) => csvEscape(m[h])).join(","))].join("\n") + "\n";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf8");

  console.log("[DocketFY] Read-only check complete. No data was modified.");
  console.log(`Total rows: ${rows.length}`);
  console.log(`Checked (valid suffix and date): ${checked}`);
  console.log(`Mismatches: ${mismatches.length}`);
  console.log(`noSuffix: ${noSuffix}`);
  console.log(`unparseableDate: ${unparseableDate}`);
  console.log("Mismatches by actual -> expected suffix:");
  for (const [key, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }
  console.log(`CSV written to ${outputPath}`);
} catch (error) {
  console.error(`[DocketFY] Failed: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
