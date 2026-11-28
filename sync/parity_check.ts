// Parity check: compare Smartsheet (live) vs the dashboard DB for rows still owned by Smartsheet.
// Run daily during the parallel run. Exit code 1 = differences found -> do NOT cut over yet.
//
//   SMARTSHEET_TOKEN=... DATABASE_URL=... npx tsx sync/parity_check.ts [--sheet sales_enquiry]
import { Db, SsSheet, SheetKind, loadColumns, loadConfig, mapRow } from './lib.ts';
import { isMain, cliPool, smartsheetToken } from './env.ts';
import { fetchSheet } from './smartsheet_sync.ts';

export interface Diff { key: string; column: string; smartsheet: unknown; db: unknown }
export interface ParityReport { smartsheetRows: number; dbRows: number; missingInDb: string[]; extraInDb: string[]; diffs: Diff[] }

const same = (a: unknown, b: unknown) => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  // pg returns Date objects: a `date` column as local midnight (so the UTC day can be the day before), a timestamptz as the instant.
  const text = (v: unknown, other: unknown) => {
    if (!(v instanceof Date)) return String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(other).trim())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    return v.toISOString();
  };
  const [x, y] = [text(a, b), text(b, a)];
  const [tx, ty] = [Date.parse(x), Date.parse(y)];
  // two timestamps are equal when they are the same instant, whatever their text form
  return x === y || (x.includes('T') && y.includes('T') && !Number.isNaN(tx) && tx === ty);
};

/** Pure: compare mapped Smartsheet records with DB records. keyOf picks the identity (docket_no for enquiries, smartsheet_row_id for items). */
export function compareRecords(ssRecords: Map<string, Record<string, unknown>>, dbRecords: Map<string, Record<string, unknown>>, columns: string[], ignore: string[] = []): ParityReport {
  const rep: ParityReport = { smartsheetRows: ssRecords.size, dbRows: dbRecords.size, missingInDb: [], extraInDb: [], diffs: [] };
  for (const [k, s] of ssRecords) {
    const d = dbRecords.get(k);
    if (!d) { rep.missingInDb.push(k); continue; }
    for (const c of columns) if (!ignore.includes(c) && !same(s[c], d[c])) rep.diffs.push({ key: k, column: c, smartsheet: s[c], db: d[c] });
  }
  for (const k of dbRecords.keys()) if (!ssRecords.has(k)) rep.extraInDb.push(k);
  return rep;
}

export async function checkSheet(db: Db, kind: SheetKind, sheetId: string, sheet: SsSheet): Promise<ParityReport> {
  const cols = loadColumns()[kind];
  const names = cols.map(c => c.db_column);
  const ss = new Map<string, Record<string, unknown>>();
  for (const row of sheet.rows) { const m = mapRow(kind, sheet, row, cols); ss.set(kind === 'sales_enquiry' ? String(m.record.docket_no) : m.smartsheetRowId, m.record); }
  const table = kind === 'sales_enquiry' ? 'enquiry' : 'enquiry_item';
  const key = kind === 'sales_enquiry' ? 'docket_no' : 'smartsheet_row_id';
  const q = await db.query(`SELECT * FROM ${table} WHERE master='smartsheet' AND (source_sheet_id=$1 OR $2) AND deleted_at IS NULL`, [sheetId, kind === 'sales_enquiry']);
  const dbm = new Map<string, Record<string, unknown>>(q.rows.map(r => [String(r[key]), r]));
  // dashboard-owned rows are legitimately absent from Smartsheet: only compare rows the DB says Smartsheet still owns
  return compareRecords(ss, dbm, names, ['modified_by', 'modified_date', 'created_date', 'created_by']);
}

async function main() {
  const { db: pool, close } = await cliPool();
  const want = process.argv.includes('--sheet') ? process.argv[process.argv.indexOf('--sheet') + 1] : 'all';
  let bad = 0;
  for (const c of loadConfig().smartsheet.filter((s: any) => want === 'all' || s.key === want)) {
    const rep = await checkSheet(pool, c.kind, c.sheetId, await fetchSheet(smartsheetToken(), c.sheetId));
    console.log(`[${c.key}] smartsheet=${rep.smartsheetRows} db=${rep.dbRows} missingInDb=${rep.missingInDb.length} extraInDb=${rep.extraInDb.length} diffs=${rep.diffs.length}`);
    if (rep.missingInDb.length) console.log('  missing in DB:', rep.missingInDb.slice(0, 20).join(', '));
    rep.diffs.slice(0, 20).forEach(d => console.log('  diff', d.key, d.column, JSON.stringify(d.smartsheet), '!=', JSON.stringify(d.db)));
    if (rep.missingInDb.length || rep.diffs.length) bad++;
  }
  await close();
  process.exit(bad ? 1 : 0);
}
if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
