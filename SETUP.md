# Nightly Costing Job — Server Setup

This guide sets up the **scheduled nightly costing job** on the Windows server
`192.168.1.190` (which hosts the codebase and the PostgreSQL DB).

The job runs two steps, in order:

1. **Google Sheet costing sync** — calls the app's `/api/costing/refresh` endpoint
   (the same logic as the "Costing from sheet" button, `refreshCostingData`). It reads
   the "TENDER COSTING ATTACHMENT" Google Sheet and stores each docket's
   `attachmentUrl` from the sheet in the DB.
2. **Network costing-file search** — runs `scripts/scanCostingFiles.mjs`: it reads
   dockets that still have **no** `attachmentUrl` from the `SmartsheetTender` table,
   recursively searches the costing network folder, and stores the matching Excel file
   path (encrypted) back in the DB.

Every network scan run is recorded in the **`CostingScanRun`** table and shown on the
dashboard (sidebar → "COSTING SCAN HISTORY"): how many dockets were searched, how many
files were found, not found, failed, duration and status.

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
| `WORKER_API_KEY` | **required for step 1.** Sent by the trigger script as `x-api-key` to the app's `/api/costing/refresh`. |
| `COSTING_SYNC_APP_URL` | optional; base URL of the running app used by the trigger script (default `http://localhost:4173`). |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | **required for step 1.** These live in the **app's** env (`.env.production` for Docker); the running app needs them to read the Google Sheet. |

> **Step 1 needs the app running.** The sheet sync is triggered via the running app at
> `COSTING_SYNC_APP_URL` (default `http://localhost:4173`). If the app is down, step 1
> logs a failure but the network scan (step 2) still proceeds.

> **Why a limit is needed:** searching one docket can take 30–60s (it walks the costing
> tree recursively). Scanning all ~1,778 missing dockets in one go would run 10–20h. The
> script only picks dockets that were **never attempted or not retried for
> `COSTING_SCAN_RETRY_DAYS` days**, oldest-attempt first, so a nightly `--limit`/limit
> env makes steady progress and every missing docket gets searched within a few nights.
> Found files are stored immediately; not-found dockets are retried after the retry
> window (files often appear later).

## 4. Test the job once (manual)

Test step 1 (sheet sync via the app — needs the app running, e.g. dev on `:4123` or
prod on `:4173`):

```bat
cd /d D:\laser-tenders
set COSTING_SYNC_APP_URL=http://localhost:4173
node scripts/triggerCostingSheetSync.mjs
```

Expect output like `[SheetSync] OK — matched 3417/5249`.

Then test step 2 (network scan):

```bat
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

Use the wrapper `run-costing-scan.cmd` (it `cd`s to the repo, runs **step 1 sheet sync
then step 2 network scan**, and writes console output to `logs\costing-scan-console.log`).
No re-registration is needed if you already created the task — it runs this file fresh
each time, so just deploy the updated `.cmd`.

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

- **`[SheetSync] Request failed: ...`** → the app isn't reachable at
  `COSTING_SYNC_APP_URL` (default `http://localhost:4173`). Confirm the app is running
  and the port is right.
- **`[SheetSync] ... reported failure` / HTTP 401** → `WORKER_API_KEY` in the repo `.env`
  doesn't match the app's `WORKER_API_KEY`.
- **Sheet sync returns `matched 0`** → the running app lacks the Google creds
  (`GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`) in its env, or it has no network access
  to `sheets.googleapis.com`. The network scan step still runs.
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