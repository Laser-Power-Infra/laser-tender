# Nightly Costing Job — Server Setup

This guide sets up the **scheduled nightly costing job** on the Windows server
`192.168.1.190` (which hosts the codebase and the PostgreSQL DB).

The job runs four steps, in order:

1. **Google Sheet costing sync** — calls the app's `/api/costing/refresh` endpoint
   (the same logic as the "Costing from sheet" button, `refreshCostingData`). It reads
   the "TENDER COSTING ATTACHMENT" Google Sheet and stores each docket's
   `attachmentUrl` from the sheet in the DB.
2. **Network costing-file search** — runs `scripts/scanCostingFiles.mjs`: it reads
   dockets that still have **no** `attachmentUrl` from the `SmartsheetTender` table,
   recursively searches the costing network folder, and stores the matching Excel file
   path (encrypted) back in the DB.
3. **Queue push** — runs `scripts/pushCostingToQueue.mjs`: it publishes a
   `COSTING_ATTACHMENT_PARSING` task per docket (with an attachment URL and no parsed
   costing yet) to RabbitMQ queue `tender:parsing`.
4. **Nightly breakdown report** — runs `scripts/costingJobReport.mjs`: it counts the
   post-job state — total tenders, network attachments (ENC1.), AppSheet/Drive URLs
   (http), dockets with no attachment, and dockets already parsed.

Every network-scan run (step 2) **and** the nightly breakdown (step 4) are recorded in
the **`CostingScanRun`** table and shown on the dashboard (sidebar → "COSTING SCAN
HISTORY"). Scan rows show searched/found/missing; "nightly" rows show
`Net · Sheet · none · parsed`.

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
| `RABBITMQ_URL` | **required for step 3.** e.g. `amqp://guest:guest@192.168.1.190:5672` — the queue push publishes `tender:parsing` tasks here. |

> **Step 1 needs the app running.** The sheet sync is triggered via the running app at
> `COSTING_SYNC_APP_URL` (default `http://localhost:4173`). If the app is down, step 1
> logs a failure but steps 2 and 3 still proceed.
>
> **Step 3 publishes real tasks.** Dockets that are already parsed (have `cvaValue` /
> `proposedQty`) are skipped, so re-running it nightly is safe.

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

Then test step 3 (queue push — publishes to RabbitMQ):

```bat
node scripts/pushCostingToQueue.mjs --limit 5
```

Expect output like:

```
[QueuePush] 5 eligible (3417 no-url, 1827 already parsed)
[QueuePush] Connecting to RabbitMQ...
[QueuePush] ── SUMMARY ──
Eligible         : 5
Published        : 5
Failed           : 0
Skipped (no URL) : 3417
Skipped (parsed) : 1827
```

> Each searched docket sets its `costingScanAttemptedAt`. Not-found dockets are retried
> after `COSTING_SCAN_RETRY_DAYS` (default 7), so leave the nightly job running even
> after a backfill — new tenders arrive from Smartsheet and files appear over time.

Then test step 4 (nightly breakdown report):

```bat
node scripts/costingJobReport.mjs
```

Expect output like:

```
[JobReport] ── NIGHTLY COSTING BREAKDOWN ──
Total tenders        : 5293
Network attachments  : 25
AppSheet/Drive URLs  : 3652
No attachment        : 1616
Parsed costing       : 3553
```

## 5. Create the scheduled task (Windows Task Scheduler)

Use the wrapper `run-costing-scan.cmd` (it `cd`s to the repo, runs **step 1 sheet sync,
step 2 network scan, step 3 queue push, step 4 breakdown report**, and writes console
output to `logs\costing-scan-console.log`).
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

- **Dashboard**: side panel → "COSTING SCAN HISTORY" lists the last 15 runs. Scan rows
  show status, found/matched, missing, failed, duration. "nightly" rows show
  `Net · Sheet · none · parsed` (network / AppSheet-Drive / no-attachment / parsed).
- **Logs** (in `D:\laser-tenders\logs\`):
  - `costing-scan-console.log` — master timeline: STEP banners + each step's full
    output, accumulating every run.
  - `costing-sheet-sync.log` — step 1 (latest run only).
  - `costing-network-scan.log` — step 2 (latest run only).
  - `costing-queue-push.log` — step 3 (latest run only).
  - `costing-job-report.log` — step 4 (latest run only).
- **Console**: when the job runs in a visible window, each step prints
  `===== STEP n: ... START/DONE/FAILED =====` so you can watch progress live.

---

## Troubleshooting

- **`[QueuePush] RABBITMQ_URL is not set` / connect failure** → ensure `RABBITMQ_URL`
  is in the repo `.env` and RabbitMQ is reachable (e.g. `192.168.1.190:5672`). Step 3
  is skipped on failure but steps 1–2 still run.
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