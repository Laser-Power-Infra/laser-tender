# Nightly Costing-File Scan — Server Setup

This guide sets up the **scheduled nightly costing-file scan** on the Windows server
`192.168.1.190` (which hosts the codebase and the PostgreSQL DB).

The scan reuses the existing script `scripts/scanCostingFiles.mjs`: it reads dockets
that have **no** `attachmentUrl` from the `SmartsheetTender` table, recursively searches
the costing network folder, and stores the matching Excel file path (encrypted) back in
the DB.

Every run is recorded in the new **`CostingScanRun`** table and shown on the dashboard
(sidebar → "COSTING SCAN HISTORY"): how many dockets were searched, how many files were
found, not found, failed, duration and status.

---

## 1. Prerequisites on the server

- Node.js (v20+; the repo is built/tested on Node 22/26) with `npm`.
- The repo checked out on the server filesystem, e.g. `D:\laser-tenders`.
- The costing network folder accessible from the server, e.g.:
  `\\192.168.1.242\dipankar roy\COSTING & INVOLVEMENT`
- `.env` present in the repo root with the values below.

## 2. Update code + install

```bat
cd /d D:\laser-tenders
git pull
npm ci
npx prisma generate
npx prisma migrate deploy
```

`npx prisma migrate deploy` creates the `CostingScanRun` table (no data changes to
existing tables).

> If you deploy via Docker (docker-compose), run the same two Prisma steps once before
> building, or exec them in the container after deploy.

## 3. Check `.env` on the server

Make sure these exist (values should match what the running app uses):

| Variable | Required value |
| --- | --- |
| `ENVIRONMENT` | `PROD` (so scripts use `DATABASE_URL`) |
| `DATABASE_URL` | `postgresql://<user>:<pass>@localhost:5432/quotation-backup` (or your DB) |
| `COSTING_FILE_NETWORK_PATH` | the costing folder path the server can read. **Use the UNC path** `\\192.168.1.242\dipankar roy\COSTING & INVOLVEMENT` so the scheduled task works even when no user is logged in (a mapped `Z:` is per-login-session and may be missing). |
| `COSTING_PATH_ENCRYPTION_KEY` | **MUST be identical** to the key already used on other machines. Existing encrypted paths in the DB were encrypted with this key; if it differs, decrypting old records and the dashboard download will break. |
| `COSTING_NIGHTLY_SCAN_LIMIT` | dockets to search per run (e.g. `500`). **Set this** so each night finishes in time (see below). |
| `COSTING_SCAN_RETRY_DAYS` | optional; how many days before a docket that was searched but not found is retried (default `7`). |

> **Why a limit is needed:** searching one docket can take 30–60s (it walks the costing
> tree recursively). Scanning all ~1,778 missing dockets in one go would run 10–20h. The
> script only picks dockets that were **never attempted or not retried for
> `COSTING_SCAN_RETRY_DAYS` days**, oldest-attempt first, so a nightly `--limit`/limit
> env makes steady progress and every missing docket gets searched within a few nights.
> Found files are stored immediately; not-found dockets are retried after the retry
> window (files often appear later).

## 4. Test the scan once (manual)

```bat
cd /d D:\laser-tenders
node scripts/scanCostingFiles.mjs --limit 5
```

Expect output like:

```
[ScanCosting] Processing 5 dockets...
[ScanCosting] ── SUMMARY ──
Processed  : 5
Matched    : 3
Not found  : 2
Failed     : 0
Remaining  : 1775
```

Then check the dashboard — "COSTING SCAN HISTORY" should show a new row.

> Each searched docket sets its `costingScanAttemptedAt`. Not-found dockets are retried
> after `COSTING_SCAN_RETRY_DAYS` (default 7), so leave the nightly job running even
> after a backfill — new tenders arrive from Smartsheet and files appear over time.

## 5. Create the scheduled task (Windows Task Scheduler)

Use the wrapper `run-costing-scan.cmd` (it `cd`s to the repo, runs the script and writes
console output to `logs\costing-scan-console.log`).

Register as **"run whether user is logged on or not"** so it runs nightly even with no
one logged in. Set the time (`/ST`, 24-hour format) to your preferred time:

```bat
schtasks /Create /TN "LaserTender_CostingScan" ^
  /TR "D:\laser-tenders\run-costing-scan.cmd" ^
  /SC DAILY /ST 02:00 /RL HIGHEST ^
  /RU <DOMAIN\User or Machine\User> /RP <password> /F
```

Optional extras:

```bat
rem Run as soon as possible if the machine was off at start time:
schtasks /Change /TN "LaserTender_CostingScan" /RI 60 /DU 04:00
```

Verify:

```bat
schtasks /Query /TN "LaserTender_CostingScan" /V /FO LIST
```

To test the task immediately:

```bat
schtasks /Run /TN "LaserTender_CostingScan"
```

## 6. Check the reports

- **Dashboard**: side panel → "COSTING SCAN HISTORY" lists the last 15 runs
  (status, found/matched, missing, failed, duration).
- **Console log**: `D:\laser-tenders\logs\costing-scan-console.log` — full output of
  every run, including the summary and any errors.

---

## Troubleshooting

- **`[CostingFileFinder] Network path not accessible: ...`** → the task's account cannot
  reach the share. Use the UNC path in `COSTING_FILE_NETWORK_PATH` and confirm the task
  user has read access to `\\192.168.1.242\dipankar roy`.
- **`Decryption failed` / download broken after deploy** → `COSTING_PATH_ENCRYPTION_KEY`
  differs from the key used to write the old encrypted paths. Restore the original key.
- **Run shows `status: error` in history** → see `logs\costing-scan-console.log` for the
  exception; the DB row's `error` column also stores the message.
- **No new history row** → the task ran but couldn't write the run log (check console
  log for "Could not create run log"). Usually a `.env`/DB connectivity issue.
- **A run never finishes / takes many hours** → each docket search can take 30–60s. Set
  `COSTING_NIGHTLY_SCAN_LIMIT` (e.g. `500`) in `.env` so the task completes in the
  overnight window and lets the retry logic cover the rest over subsequent nights.
- **Skipped dockets when no limit set** → the script only picks dockets whose
  `costingScanAttemptedAt` is null or older than `COSTING_SCAN_RETRY_DAYS`. If you want
  to force a re-search of everything immediately, lower the retry days or clear the
  column: `node -e "...prisma.smartsheetTender.updateMany({data:{costingScanAttemptedAt:null}})"`.