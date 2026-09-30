@echo off
rem ============================================================
rem  Nightly costing job wrapper (Windows Task Scheduler)
rem  1) Google Sheet costing sync  (app /api/costing/refresh)
rem  2) Network costing-file scan   (scripts/scanCostingFiles.mjs)
rem  3) Push parsed-costing queue  (scripts/pushCostingToQueue.mjs)
rem  All steps append to logs\costing-scan-console.log. Run-reports for
rem  the network scan are stored in the DB (CostingScanRun) and shown
rem  on the dashboard under "COSTING SCAN HISTORY".
rem ============================================================
setlocal

cd /d "%~dp0"

if not exist logs mkdir logs

echo [%date% %time%] ===== Costing job START ===== >> "logs\costing-scan-console.log"

rem Step 1: Google Sheet costing sync (via the running app).
node scripts/triggerCostingSheetSync.mjs >> "logs\costing-scan-console.log" 2>&1
if errorlevel 1 (
  echo [%date% %time%] Sheet sync FAILED, continuing to network scan >> "logs\costing-scan-console.log"
)

rem Step 2: Network costing-file search + DB update.
node scripts/scanCostingFiles.mjs >> "logs\costing-scan-console.log" 2>&1
if errorlevel 1 (
  echo [%date% %time%] Network scan FAILED, continuing to queue push >> "logs\costing-scan-console.log"
)

rem Step 3: Push costing attachments to the parsing queue.
node scripts/pushCostingToQueue.mjs >> "logs\costing-scan-console.log" 2>&1
set EXITCODE=%ERRORLEVEL%

echo [%date% %time%] ===== Costing job END (exit=%EXITCODE%) ===== >> "logs\costing-scan-console.log"

exit /b %EXITCODE%