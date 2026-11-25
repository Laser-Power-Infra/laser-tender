// Shared helpers: DB interface, Smartsheet column mapping, value coercion, upsert SQL.
// Works with node-postgres (Pool/Client) and PGlite (used in the tests) because both expose query(text, params).
import columnsJson from '../db/columns.json';
import configJson from './sheets.config.json';

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export type SheetKind = 'sales_enquiry' | 'item_list';

export interface ColMap {
  index: number;
  smartsheet_title: string;
  smartsheet_column_id: string;
  smartsheet_type: string;
  system_column: string | null;
  db_column: string;
  pg_type: string;
  is_picklist: boolean;
  hidden: boolean;
  owner_hint: string | null;
  formula?: boolean;      // every cell is a Smartsheet formula (seen on all sampled rows, 24 Nov 2026): never typed in the form, never pushed by the mirror
}

export interface SsCell { columnId: number | string; value?: unknown; displayValue?: string }
export interface SsRow { id: number | string; rowNumber?: number; createdAt?: string; modifiedAt?: string; cells: SsCell[] }
export interface SsColumn { id: number | string; title: string; type?: string; index?: number }
export interface SsSheet { id?: number | string; name?: string; columns: SsColumn[]; rows: SsRow[]; totalPages?: number; totalRowCount?: number }

export const normTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

// JSON imports (not fs) so the same code runs inside the Next bundle.
export function loadColumns(): Record<SheetKind, ColMap[]> {
  return columnsJson as unknown as Record<SheetKind, ColMap[]>;
}

export function loadConfig(): any {
  return configJson;
}

/** Coerce one Smartsheet cell value to the Postgres type of the target column. Never throws; bad values become null (original stays in `legacy`). */
export function coerce(value: unknown, pgType: string): unknown {
  if (value === undefined || value === null) return pgType === 'boolean' ? false : null;
  if (typeof value === 'string' && value.trim() === '' && pgType !== 'text') return pgType === 'boolean' ? false : null;
  switch (pgType) {
    case 'date': {
      const m = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})/) : null;
      return m ? m[1] : null;
    }
    case 'timestamptz': {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'boolean':
      return value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes';
    case 'numeric':
    case 'integer': {
      const n = Number(String(value).replace(/[,\s%]/g, ''));
      if (!Number.isFinite(n)) return null;
      return pgType === 'integer' ? Math.round(n) : n;
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

export interface MappedRow {
  record: Record<string, unknown>;     // db_column -> coerced value
  legacy: Record<string, unknown>;     // original Smartsheet title -> displayValue ?? value  (lossless copy)
  unmappedTitles: string[];            // sheet columns we have no db_column for (older ERP lists differ)
  smartsheetRowId: string;
  modifiedAt: string | null;
}

export function mapRow(kind: SheetKind, sheet: SsSheet, row: SsRow, cols = loadColumns()[kind]): MappedRow {
  const byTitle = new Map(cols.map(c => [normTitle(c.smartsheet_title), c]));
  const colById = new Map<string, SsColumn>(sheet.columns.map(c => [String(c.id), c]));
  const record: Record<string, unknown> = {};
  const legacy: Record<string, unknown> = {};
  const unmapped = new Set<string>();
  for (const c of cols) record[c.db_column] = c.pg_type === 'boolean' ? false : null;
  for (const cell of row.cells) {
    const sc = colById.get(String(cell.columnId));
    if (!sc) continue;
    const cm = byTitle.get(normTitle(sc.title));
    if (cell.value === undefined && cell.displayValue === undefined) continue;
    legacy[sc.title.trim()] = cell.displayValue ?? cell.value;
    if (!cm) { unmapped.add(sc.title.trim()); continue; }
    // CONTACT_LIST: Smartsheet returns the e-mail in `value` and the person's name in `displayValue`; we keep the e-mail.
    record[cm.db_column] = coerce(cell.value ?? cell.displayValue, cm.pg_type);
  }
  return { record, legacy, unmappedTitles: [...unmapped], smartsheetRowId: String(row.id), modifiedAt: row.modifiedAt ?? null };
}

// ---------------------------------------------------------------- upserts
// Parallel-run rule: rows with master='dashboard' are NEVER overwritten by the Smartsheet import.
// Dashboard-native columns (allocated_to, lost_still_scope, ...) are never touched by the import either.
const IMPORT_SKIP_ON_UPDATE = new Set(['docket_no']);

export async function upsertEnquiry(db: Db, sourceSheetId: string, m: MappedRow): Promise<'inserted' | 'updated' | 'skipped'> {
  const cols = loadColumns().sales_enquiry.map(c => c.db_column);
  if (!m.record.docket_no) return 'skipped';
  const names = [...cols, 'smartsheet_row_id', 'source_sheet_id', 'legacy'];
  const vals = [...cols.map(c => m.record[c]), m.smartsheetRowId, sourceSheetId, JSON.stringify(m.legacy)];
  const ph = names.map((n, i) => (n === 'legacy' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sets = names.filter(n => !IMPORT_SKIP_ON_UPDATE.has(n)).map(n => `${n} = EXCLUDED.${n}`).join(', ');
  const r = await db.query(
    `INSERT INTO enquiry (${names.join(', ')}) VALUES (${ph.join(', ')})
     ON CONFLICT (docket_no) DO UPDATE SET ${sets}, updated_at = now(), row_version = enquiry.row_version + 1
       WHERE enquiry.master = 'smartsheet'
     RETURNING (xmax = 0) AS inserted`, vals);
  if (r.rows.length === 0) return 'skipped';           // row is dashboard-owned
  return r.rows[0].inserted ? 'inserted' : 'updated';
}

export async function upsertItem(db: Db, sourceSheetId: string, itemList: string, m: MappedRow): Promise<'inserted' | 'updated' | 'skipped'> {
  const cols = loadColumns().item_list.map(c => c.db_column);
  if (!m.record.docket_no) return 'skipped';
  const names = [...cols, 'item_list', 'smartsheet_row_id', 'source_sheet_id', 'legacy'];
  const vals = [...cols.map(c => m.record[c]), itemList, m.smartsheetRowId, sourceSheetId, JSON.stringify(m.legacy)];
  const ph = names.map((n, i) => (n === 'legacy' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sets = names.filter(n => n !== 'smartsheet_row_id' && n !== 'source_sheet_id').map(n => `${n} = EXCLUDED.${n}`).join(', ');
  const r = await db.query(
    `INSERT INTO enquiry_item (${names.join(', ')}) VALUES (${ph.join(', ')})
     ON CONFLICT (source_sheet_id, smartsheet_row_id) WHERE smartsheet_row_id IS NOT NULL
     DO UPDATE SET ${sets}, updated_at = now(), row_version = enquiry_item.row_version + 1
       WHERE enquiry_item.master = 'smartsheet'
     RETURNING (xmax = 0) AS inserted`, vals);
  if (r.rows.length === 0) return 'skipped';
  return r.rows[0].inserted ? 'inserted' : 'updated';
}

export async function inTransaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try { const out = await fn(); await db.query('COMMIT'); return out; }
  catch (e) { await db.query('ROLLBACK'); throw e; }
}
