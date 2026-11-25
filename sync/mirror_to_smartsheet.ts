// Dashboard -> Smartsheet mirror (parallel-run phase only). Keeps Smartsheet usable by people who haven't moved yet.
// Only rows with master='dashboard' are pushed. Rows that still have master='smartsheet' are never written to Smartsheet from here.
//
//   SMARTSHEET_TOKEN=... DATABASE_URL=... npx tsx sync/mirror_to_smartsheet.ts [--dry-run]
//
// DOCKET NUMBERING DURING THE PARALLEL RUN (decided by Puja, 24 Nov 2026): Smartsheet keeps issuing the docket (AUTO_NUMBER, not writable via API).
// A row created in the dashboard gets a temporary docket_no 'PENDING-<n>' (see next_pending_docket_no()), is pushed to Smartsheet here,
// and the real "ENQ-xxxxx-25-26" that Smartsheet returns replaces the temporary one (also in enquiry_item/attachment/item_costing rows).
// The dashboard then shows the same docket as Smartsheet. At cut-over (Phase 3) switch to next_docket_no() - see docs/OPEN_QUESTIONS.md Q4.
import { Db, SheetKind, ColMap, loadColumns, loadConfig } from './lib.ts';
import { isMain, cliPool, smartsheetToken } from './env.ts';

export interface RowPayload { id?: number; toBottom?: boolean; cells: { columnId: number; value: unknown }[] }

const SKIP_TYPES = new Set(['AUTO_NUMBER', 'CREATED_DATE', 'MODIFIED_DATE', 'CREATED_BY', 'MODIFIED_BY']); // system columns: not writable

/** Pure: build the Smartsheet add/update row payload from a DB record. Empty values are omitted (null/'' would clear a cell; we only push values). */
export function buildRowPayload(kind: SheetKind, record: Record<string, unknown>, smartsheetRowId?: string | null, cols: ColMap[] = loadColumns()[kind]): RowPayload {
  const cells: RowPayload['cells'][number][] = [];
  for (const c of cols) {
    if (c.system_column || c.formula || SKIP_TYPES.has(c.smartsheet_type)) continue;
    const v = record[c.db_column];
    if (v === null || v === undefined || v === '') continue;
    let out: unknown = v;
    if (c.pg_type === 'date') out = String(v).slice(0, 10);
    else if (c.pg_type === 'timestamptz') out = new Date(String(v)).toISOString();
    else if (c.pg_type === 'boolean') out = v === true;
    else if (c.pg_type === 'numeric' || c.pg_type === 'integer') out = Number(v);
    else out = String(v);
    cells.push({ columnId: Number(c.smartsheet_column_id), value: out });
  }
  return smartsheetRowId ? { id: Number(smartsheetRowId), cells } : { toBottom: true, cells };
}

async function ssSend(method: 'POST' | 'PUT', path: string, token: string, body: unknown, attempt = 0): Promise<any> {
  const res = await fetch(`https://api.smartsheet.com/2.0${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) { await new Promise(r => setTimeout(r, 2000 * 2 ** attempt)); return ssSend(method, path, token, body, attempt + 1); }
  if (!res.ok) throw new Error(`Smartsheet ${res.status}: ${await res.text()}`);
  return res.json();
}

export const DOCKET_COL_ID = 76296593559428;

/** Pure: read the Smartsheet-issued docket from the row object returned by the add-rows call. */
export function extractDocket(resultRow: { cells?: { columnId: number | string; value?: unknown; displayValue?: string }[] } | undefined): string | null {
  const c = resultRow?.cells?.find(x => String(x.columnId) === String(DOCKET_COL_ID));
  const v = c?.displayValue ?? c?.value;
  return v ? String(v) : null;
}

/** Replace a temporary docket everywhere it is referenced. */
export async function rekeyDocket(db: Db, oldNo: string, newNo: string) {
  if (oldNo === newNo) return;
  await db.query('UPDATE enquiry SET docket_no=$2 WHERE docket_no=$1', [oldNo, newNo]);
  for (const t of ['enquiry_item', 'attachment', 'item_costing', 'costing_run'])
    await db.query(`UPDATE ${t} SET docket_no=$2 WHERE docket_no=$1`, [oldNo, newNo]).catch(() => {});
  // keep the edit history attached to the real docket
  await db.query(`UPDATE audit_log SET pk=$2 WHERE table_name='enquiry' AND pk=$1`, [oldNo, newNo]);
}

export async function mirror(db: Db, token: string, dry: boolean) {
  const cfg = loadConfig().smartsheet as any[];
  const se = cfg.find(s => s.kind === 'sales_enquiry');
  const il = cfg.find(s => s.key === 'item_erp11');
  const enq = await db.query(`SELECT * FROM enquiry WHERE master='dashboard' AND deleted_at IS NULL AND (mirrored_at IS NULL OR updated_at > mirrored_at)`);
  for (const r of enq.rows) {
    const payload = buildRowPayload('sales_enquiry', r, r.smartsheet_row_id);
    if (dry) { console.log('DRY enquiry', r.docket_no, payload.cells.length, 'cells'); continue; }
    const j = r.smartsheet_row_id ? await ssSend('PUT', `/sheets/${se.sheetId}/rows`, token, [payload]) : await ssSend('POST', `/sheets/${se.sheetId}/rows`, token, [payload]);
    const res0 = j.result?.[0];
    const id = res0?.id ?? r.smartsheet_row_id;
    await db.query('UPDATE enquiry SET smartsheet_row_id=$2, source_sheet_id=$3, mirrored_at=now() WHERE docket_no=$1', [r.docket_no, String(id), se.sheetId]);
    if (String(r.docket_no).startsWith('PENDING-')) {
      const real = extractDocket(res0);
      if (real) await rekeyDocket(db, r.docket_no, real); else console.warn('no docket returned for', r.docket_no, '- re-read row', id, 'from Smartsheet');
    }
  }
  const items = await db.query(`SELECT * FROM enquiry_item WHERE master='dashboard' AND deleted_at IS NULL AND (mirrored_at IS NULL OR updated_at > mirrored_at)`);
  for (const r of items.rows) {
    const payload = buildRowPayload('item_list', r, r.smartsheet_row_id);
    if (dry) { console.log('DRY item', r.docket_no, payload.cells.length, 'cells'); continue; }
    const j = r.smartsheet_row_id ? await ssSend('PUT', `/sheets/${il.sheetId}/rows`, token, [payload]) : await ssSend('POST', `/sheets/${il.sheetId}/rows`, token, [payload]);
    const id = j.result?.[0]?.id ?? r.smartsheet_row_id;
    await db.query('UPDATE enquiry_item SET smartsheet_row_id=$2, source_sheet_id=$3, mirrored_at=now() WHERE id=$1', [r.id, String(id), il.sheetId]);
  }
  return { enquiries: enq.rows.length, items: items.rows.length };
}

async function main() {
  const { db: pool, close } = await cliPool();
  console.log(await mirror(pool, smartsheetToken(), process.argv.includes('--dry-run')));
  await close();
}
if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
