// Google Sheets -> Postgres (sheet_snapshot). Replaces the Google Sheets data feeding Power BI.
//
//   npm run sync:gsheets [-- --sheet CIRCULARS]      (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY from .env)
//
// Setup (one time): create a Google service account, download its JSON key, and SHARE each spreadsheet in sheets.config.json
// with the service-account e-mail (Viewer is enough). Whole tab is replaced on every run (inside one transaction).
import { Db, loadConfig, inTransaction } from './lib.ts';
import { isMain, cliPool } from './env.ts';
import { getAccessToken } from '../lib/google-auth.ts';
import { loadTypedTables } from './typed_tables.ts';

/** Pure: turn a 2-D grid (as returned by Sheets API values.get) into snapshot rows. headerRow is 1-based. */
export function rowsToSnapshot(grid: unknown[][], headerRow = 1): { row_no: number; data: Record<string, string> }[] {
  const header = (grid[headerRow - 1] ?? []).map((h, i) => (String(h ?? '').trim() || `col_${i + 1}`));
  // de-duplicate repeated headers (Sheets allows them): "Rate", "Rate" -> "Rate", "Rate_2"
  const seen = new Map<string, number>();
  const keys = header.map(h => { const n = (seen.get(h) ?? 0) + 1; seen.set(h, n); return n === 1 ? h : `${h}_${n}`; });
  const out: { row_no: number; data: Record<string, string> }[] = [];
  for (let r = headerRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every(c => c === '' || c === null || c === undefined)) continue;      // skip fully blank rows
    const data: Record<string, string> = {};
    keys.forEach((k, i) => { const v = row[i]; if (v !== undefined && v !== null && v !== '') data[k] = String(v); });
    out.push({ row_no: r + 1, data });
  }
  return out;
}

export async function replaceTab(db: Db, sheetKey: string, tab: string, rows: { row_no: number; data: Record<string, string> }[]) {
  await inTransaction(db, async () => {
    await db.query('DELETE FROM sheet_snapshot WHERE sheet_key=$1 AND tab_name=$2', [sheetKey, tab]);
    // 2000 rows per statement: some tabs have tens of thousands of rows
    for (let i = 0; i < rows.length; i += 2000) {
      await db.query(`INSERT INTO sheet_snapshot(sheet_key,tab_name,row_no,data)
                      SELECT $1, $2, x.row_no, x.data FROM jsonb_to_recordset($3::jsonb) AS x(row_no integer, data jsonb)`, [sheetKey, tab, JSON.stringify(rows.slice(i, i + 2000))]);
    }
  });
  return rows.length;
}

/** Read one tab as a 2-D grid of what people see in the sheet (FORMATTED_VALUE keeps dates as text, not serial numbers). */
export async function fetchTab(token: string, spreadsheetId: string, tab: string): Promise<unknown[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${tab}'`)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()).values ?? []) as unknown[][];
}

export async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_CLIENT_EMAIL, key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new Error('GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY are not set');
  return getAccessToken(email, key.replace(/\\n/g, '\n'));
}

/** Re-read every configured tab into sheet_snapshot, then rebuild the typed tables. `db` must be one connection. Returns what failed; a failed tab keeps its old rows. */
export async function runGsheetsSync(db: Db, want = 'all'): Promise<{ tabs: number; failed: string[] }> {
  const token = await googleToken();
  let tabs = 0;
  const failed: string[] = [];
  for (const s of loadConfig().googleSheets.filter((x: any) => want === 'all' || x.key === want)) {
    for (const tab of s.tabs) {
      const started = new Date();
      const job = `gsheets:${s.key}:${tab.name}`;
      try {
        const n = await replaceTab(db, s.key, tab.name, rowsToSnapshot(await fetchTab(token, s.spreadsheetId, tab.name), tab.headerRow ?? 1));
        await db.query('INSERT INTO sync_log(job,started_at,finished_at,ok,rows_read,rows_written) VALUES ($1,$2,now(),true,$3,$3)', [job, started, n]);
        console.log(`[${s.key}/${tab.name}] ${n} rows`);
        tabs++;
      } catch (e: any) {
        failed.push(`${s.key}/${tab.name}`);
        await db.query('INSERT INTO sync_log(job,started_at,finished_at,ok,message) VALUES ($1,$2,now(),false,$3)', [job, started, String(e.message).slice(0, 500)]);
        console.error(`[${s.key}/${tab.name}] FAILED: ${e.message}`);
      }
    }
  }
  try { console.log('[typed tables]', await loadTypedTables(db)); }
  catch (e: any) { failed.push('typed tables'); console.error(`[typed tables] FAILED: ${e.message}`); }
  return { tabs, failed };
}

async function main() {
  const want = process.argv.includes('--sheet') ? process.argv[process.argv.indexOf('--sheet') + 1] : 'all';
  const { db, close } = await cliPool();      // a single connection
  try { if ((await runGsheetsSync(db, want)).failed.length) process.exitCode = 1; }
  finally { await close(); }
}

if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
