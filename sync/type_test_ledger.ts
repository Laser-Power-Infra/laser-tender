// Type Test Ledger.xlsx -> Postgres (sheet_snapshot). The Type test page reads this, not a Google Sheet.
//
//   npm run load:type-test -- "tmp/Type Test Ledger.xlsx"
//
// shortcut: loaded by hand from a file, so the page is as old as the last load; move the ledger to a Google Sheet
// in sheets.config.json when it has to refresh with the daily sync.
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { cliPool, isMain, loadEnv } from './env.ts';
import { rowsToSnapshot, replaceTab } from './gsheets_sync.ts';
import { certificateCandidates, certificatePath, typeTestRoot } from '../lib/typeTestFiles.ts';

const KEY = 'TYPE_TEST_LEDGER', TAB = 'TTR JIST';
const FILE_KEY = 'Certificate file';   // read by lib/reports.ts and app/api/type-test/file

async function main() {
  loadEnv();
  const file = process.argv[2];
  if (!file) throw new Error('Give the ledger file: npm run load:type-test -- "tmp/Type Test Ledger.xlsx"');
  // dateNF: real date cells come out as 03-05-2016, the same day-first form the ledger's typed dates use (Excel's default shows 5/3/16)
  const ws = XLSX.readFile(file, { dateNF: 'dd-mm-yyyy' }).Sheets[TAB];
  if (!ws) throw new Error(`${file} has no "${TAB}" tab`);
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
  const rows = rowsToSnapshot(grid);
  if (rows.length === 0) throw new Error(`"${TAB}" has no rows: nothing loaded, the old rows are kept`);

  // The certificate number cells are hyperlinks to the PDF on the office server: keep where each one points, relative to the ledger's folder.
  const first = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s;
  const col = grid[0].findIndex(h => String(h).trim() === 'Test Certificate No');
  const root = typeTestRoot();
  const rootSeen = fs.existsSync(root);
  if (!rootSeen) console.warn(`[${KEY}] ${root} is not reachable from here: links are not checked against the files`);
  let linked = 0, missing = 0;
  for (const row of rows) {
    const target = col < 0 ? undefined : ws[XLSX.utils.encode_cell({ r: first.r + row.row_no - 1, c: first.c + col })]?.l?.Target;
    const candidates = target ? certificateCandidates(String(target)) : [];
    if (candidates.length === 0) continue;
    const found = rootSeen ? candidates.find(c => fs.existsSync(certificatePath(root, c) ?? '')) : undefined;
    if (rootSeen && !found) missing++;
    row.data[FILE_KEY] = found ?? candidates[0];
    linked++;
  }
  console.log(`[${KEY}] ${linked} certificate links${rootSeen ? `, ${missing} point to a file that is not on the server` : ''}`);
  const { db, close } = await cliPool();
  try {
    const started = new Date();
    const n = await replaceTab(db, KEY, TAB, rows);
    await db.query('INSERT INTO sync_log(job,started_at,finished_at,ok,rows_read,rows_written) VALUES ($1,$2,now(),true,$3,$3)', [`xlsx:${KEY}:${TAB}`, started, n]);
    console.log(`[${KEY}/${TAB}] ${n} rows`);
  } finally { await close(); }
}

if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
