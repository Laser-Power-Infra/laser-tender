@echo off
rem ============================================================
rem  Nightly costing-file scan wrapper (Windows Task Scheduler)
rem  Runs the existing scan script and appends output to a log.
rem  Run-reports are stored in the DB (CostingScanRun) and shown
rem  on the dashboard under "COSTING SCAN HISTORY".
rem ============================================================
setlocal

cd /d "%~dp0"

if not exist logs mkdir logs

echo [%date% %time%] ===== Costing scan START ===== >> "logs\costing-scan-console.log"

node scripts/scanCostingFiles.mjs >> "logs\costing-scan-console.log" 2>&1
set EXITCODE=%ERRORLEVEL%

echo [%date% %time%] ===== Costing scan END (exit=%EXITCODE%) ===== >> "logs\costing-scan-console.log"

exit /b %EXITCODE%