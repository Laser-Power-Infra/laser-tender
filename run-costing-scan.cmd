@echo off
rem ============================================================
rem  Nightly costing job wrapper (Windows Task Scheduler)
rem  1) Google Sheet costing sync  (app /api/costing/refresh)
rem  2) Network costing-file scan   (scripts/scanCostingFiles.mjs)
rem  3) Push parsed-costing queue  (scripts/pushCostingToQueue.mjs)
rem  4) Nightly breakdown report  (scripts/costingJobReport.mjs)
rem
rem  Each step writes its own log and is also appended to the
rem  master timeline log. Step status is echoed to the console.
rem    logs\costing-sheet-sync.log
rem    logs\costing-network-scan.log
rem    logs\costing-queue-push.log
rem    logs\costing-job-report.log
rem    logs\costing-scan-console.log   (master, accumulates)
rem ============================================================
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

set "MASTER=logs\costing-scan-console.log"

echo ===== Costing job START =====
echo [%date% %time%] ===== Costing job START ===== >> "%MASTER%"

rem ---- Step 1: Google Sheet costing sync (via the running app) ----
echo.
echo ===== STEP 1: SHEET SYNC START =====
echo [%date% %time%] ----- STEP 1: SHEET SYNC START ----- >> "%MASTER%"
node scripts\triggerCostingSheetSync.mjs > "logs\costing-sheet-sync.log" 2>&1
set RC=%ERRORLEVEL%
type "logs\costing-sheet-sync.log" >> "%MASTER%"
if not "%RC%"=="0" (
  echo ===== STEP 1: SHEET SYNC FAILED ^(exit=%RC%^) =====
  echo [%date% %time%] ----- STEP 1: SHEET SYNC FAILED ^(exit=%RC%^) ----- >> "%MASTER%"
) else (
  echo ===== STEP 1: SHEET SYNC DONE =====
  echo [%date% %time%] ----- STEP 1: SHEET SYNC DONE ----- >> "%MASTER%"
)

rem ---- Step 2: Network costing-file search + DB update ----
echo.
echo ===== STEP 2: NETWORK SCAN START =====
echo [%date% %time%] ----- STEP 2: NETWORK SCAN START ----- >> "%MASTER%"
node scripts\scanCostingFiles.mjs > "logs\costing-network-scan.log" 2>&1
set RC=%ERRORLEVEL%
type "logs\costing-network-scan.log" >> "%MASTER%"
if not "%RC%"=="0" (
  echo ===== STEP 2: NETWORK SCAN FAILED ^(exit=%RC%^) =====
  echo [%date% %time%] ----- STEP 2: NETWORK SCAN FAILED ^(exit=%RC%^) ----- >> "%MASTER%"
) else (
  echo ===== STEP 2: NETWORK SCAN DONE =====
  echo [%date% %time%] ----- STEP 2: NETWORK SCAN DONE ----- >> "%MASTER%"
)

rem ---- Step 3: Push costing attachments to the parsing queue ----
echo.
echo ===== STEP 3: QUEUE PUSH START =====
echo [%date% %time%] ----- STEP 3: QUEUE PUSH START ----- >> "%MASTER%"
node scripts\pushCostingToQueue.mjs > "logs\costing-queue-push.log" 2>&1
set RC=%ERRORLEVEL%
type "logs\costing-queue-push.log" >> "%MASTER%"
if not "%RC%"=="0" (
  echo ===== STEP 3: QUEUE PUSH FAILED ^(exit=%RC%^) =====
  echo [%date% %time%] ----- STEP 3: QUEUE PUSH FAILED ^(exit=%RC%^) ----- >> "%MASTER%"
) else (
  echo ===== STEP 3: QUEUE PUSH DONE =====
  echo [%date% %time%] ----- STEP 3: QUEUE PUSH DONE ----- >> "%MASTER%"
)

rem ---- Step 4: Nightly breakdown report ----
echo.
echo ===== STEP 4: JOB REPORT START =====
echo [%date% %time%] ----- STEP 4: JOB REPORT START ----- >> "%MASTER%"
node scripts\costingJobReport.mjs > "logs\costing-job-report.log" 2>&1
set RC=%ERRORLEVEL%
type "logs\costing-job-report.log" >> "%MASTER%"
if not "%RC%"=="0" (
  echo ===== STEP 4: JOB REPORT FAILED ^(exit=%RC%^) =====
  echo [%date% %time%] ----- STEP 4: JOB REPORT FAILED ^(exit=%RC%^) ----- >> "%MASTER%"
) else (
  echo ===== STEP 4: JOB REPORT DONE =====
  echo [%date% %time%] ----- STEP 4: JOB REPORT DONE ----- >> "%MASTER%"
)

echo.
echo ===== Costing job END ^(exit=%RC%^) =====
echo [%date% %time%] ===== Costing job END ^(exit=%RC%^) ===== >> "%MASTER%"

exit /b %RC%