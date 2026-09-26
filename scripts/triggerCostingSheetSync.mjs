#!/usr/bin/env node
/**
 * triggerCostingSheetSync.mjs
 *
 * Triggers the app's /api/costing/refresh endpoint — the same "Costing from
 * sheet" logic (refreshCostingData) the dashboard button runs — so the nightly
 * .cmd can run the Google Sheet costing sync BEFORE the network file scan.
 *
 * Usage:
 *   node scripts/triggerCostingSheetSync.mjs
 *
 * Env (next-app/.env):
 *   WORKER_API_KEY          (required) sent as `x-api-key`
 *   COSTING_SYNC_APP_URL    (optional, default http://localhost:4173) base URL
 *                           of the running app, e.g. http://localhost:4173
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

async function main() {
  loadEnv();

  const apiKey = (process.env.WORKER_API_KEY || "").trim().replace(/^"|"$/g, "");
  const appUrl = (process.env.COSTING_SYNC_APP_URL || "http://localhost:4173")
    .trim()
    .replace(/\/+$/, "");

  if (!apiKey) {
    console.error("[SheetSync] WORKER_API_KEY is not set in .env");
    process.exit(1);
  }

  const url = `${appUrl}/api/costing/refresh`;
  console.log(`[SheetSync] POST ${url}`);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
    });
  } catch (err) {
    console.error(`[SheetSync] Request failed: ${err.message}`);
    process.exit(1);
  }

  const text = await response.text();
  console.log(`[SheetSync] status=${response.status} body=${text.slice(0, 2000)}`);

  if (!response.ok) {
    console.error(`[SheetSync] Refresh failed (HTTP ${response.status})`);
    process.exit(1);
  }

  try {
    const json = JSON.parse(text);
    if (json && json.success === true) {
      console.log(`[SheetSync] OK — matched ${json.matched}/${json.total}`);
    } else {
      console.error(`[SheetSync] Refresh reported failure: ${text.slice(0, 500)}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[SheetSync] Non-JSON response: ${text.slice(0, 500)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[SheetSync] Fatal:", err.message || err);
  process.exit(1);
});