// Create / edit dashboard-owned enquiries and item lines (parallel-run rules: docs/enquiry-platform/BUILD_BRIEF.md §3, §6).
// `db` must be ONE connection (a client from pool.connect(), or PGlite): every write shares a transaction with its audit_log row.
import picklists from '../seed/picklists.json';
import { Db, SheetKind, coerce, inTransaction, loadColumns } from '../sync/lib.ts';

const TABLE = { sales_enquiry: { table: 'enquiry', pk: 'docket_no' }, item_list: { table: 'enquiry_item', pk: 'id' } } as const;
const BIG_LISTS: Record<string, string> = { party_name: 'parties', utility: 'utilities', propose_erp_item: 'erp_items', country: 'countries' };
// owner_hint is parsed from "(...)" in the title. 'Debosmita Nath' is not a section either: her fields (enquiry date, party, email, subject,
// reference no) are the ones the enquiry mail fills, so they sit in General (guideline 27 Nov 2026, section 3.1).
const NOT_AN_OWNER = new Set(['ALL', '1', 'TS ATTACHED', 'GTP ATTACHED', 'NO ERP CODE', 'BOM & LG %', 'Debosmita Nath']);

export type Values = Record<string, unknown>;
export interface FormField {
  name: string;                                   // db_column
  label: string;                                  // Smartsheet column title
  type: 'text' | 'number' | 'date' | 'checkbox';
  picklist: string | null;                        // key for picklistOptions()
  group: string;
  hint?: string;
}

// Only these columns may ever be written from the screens: no system columns, no docket number.
const editable = (kind: SheetKind) => loadColumns()[kind].filter(c => !c.system_column && !c.formula && !c.hidden && c.db_column !== 'docket_no');

function groupOf(hint: string | null): string {
  if (!hint || NOT_AN_OWNER.has(hint)) return 'General';
  if (/^(mkt|marketing)/i.test(hint)) return 'Marketing team';
  if (/^(by )?acc? ?h/i.test(hint)) return 'Account holder';
  return hint;
}

export function formFields(kind: SheetKind): FormField[] {
  return editable(kind).map(c => ({
    name: c.db_column,
    label: c.smartsheet_title.replace(/\s+/g, ' ').trim(),
    type: c.pg_type === 'boolean' ? 'checkbox' : c.pg_type === 'date' ? 'date' : c.pg_type === 'numeric' || c.pg_type === 'integer' ? 'number' : 'text',
    picklist: c.is_picklist ? BIG_LISTS[c.db_column] ?? `${kind}.${c.smartsheet_title}` : null,
    group: groupOf(c.owner_hint),
    // BUILD_BRIEF §2: item-list percent columns hold fractions
    ...(kind === 'item_list' && c.db_column.endsWith('_pct') ? { hint: 'Fraction: 18 % = 0.18' } : {}),
  }));
}

/** Whitelist + coerce client values. Throws on a column that is not editable and on a value that does not fit the column type. */
function prepare(kind: SheetKind, values: Values): [string, unknown][] {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid form data');
  const cols = new Map(editable(kind).map(c => [c.db_column, c]));
  return Object.entries(values).map(([k, v]) => {
    const c = cols.get(k);
    if (!c) throw new Error(`Column "${k}" cannot be edited here`);
    const blank = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const out = coerce(blank ? null : v, c.pg_type);
    if (!blank && out === null) throw new Error(`"${c.smartsheet_title.trim()}" is not a valid ${c.pg_type === 'date' ? 'date' : 'number'}`);
    return [k, out];
  });
}

// Smartsheet fills Created/Modified By/Date itself; dashboard-owned rows are never re-imported, so the server stamps them.
const stamps = (kind: SheetKind, when: 'CREATED' | 'MODIFIED') => loadColumns()[kind].filter(c => c.system_column?.startsWith(when));

const audit = (db: Db, actor: string, action: 'INSERT' | 'UPDATE', table: string, pk: string, changes: Record<string, { old: unknown; new: unknown }>) =>
  db.query('INSERT INTO audit_log (actor, action, table_name, pk, changes) VALUES ($1, $2, $3, $4, $5::jsonb)', [actor, action, table, pk, JSON.stringify(changes)]);

/** Insert + audit. Call inside a transaction. `fixed` values are server-decided (docket, item_list). */
async function insertRow(db: Db, kind: SheetKind, vals: [string, unknown][], fixed: [string, unknown][], actor: string): Promise<string> {
  const { table, pk } = TABLE[kind];
  const set = [...vals, ...fixed, ['updated_by', actor] as [string, unknown]];
  const names = [...set.map(([k]) => k), 'master'];
  const exprs = [...set.map((_, i) => `$${i + 1}`), `'dashboard'`];
  for (const c of stamps(kind, 'CREATED')) { names.push(c.db_column); exprs.push(c.system_column!.endsWith('_BY') ? `$${set.length}` : 'now()'); }
  if (kind === 'sales_enquiry') { names.push('docket_no'); exprs.push('next_pending_docket_no()'); } // Smartsheet issues the real docket via the mirror
  const r = await db.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${exprs.join(', ')}) RETURNING ${pk}::text AS pk`, set.map(([, v]) => v));
  await audit(db, actor, 'INSERT', table, r.rows[0].pk, Object.fromEntries(vals.map(([k, v]) => [k, { old: null, new: v }])));
  return r.rows[0].pk;
}

/** Update + audit of the columns that really changed. Opens its own transaction; `check` runs before the write. */
async function updateRow(db: Db, kind: SheetKind, key: string, values: Values, actor: string,
  check?: (row: Record<string, any>, changes: Record<string, { old: unknown; new: unknown }>) => Promise<void>): Promise<string[]> {
  const { table, pk } = TABLE[kind];
  const vals = prepare(kind, values);
  const cols = editable(kind);
  return inTransaction(db, async () => {
    // ::text so numbers/dates compare the same way under pg and PGlite (and dates do not shift time zone)
    const r = await db.query(`SELECT master, docket_no, ${cols.map(c => `${c.db_column}::text AS ${c.db_column}`).join(', ')}
      FROM ${table} WHERE ${pk}::text = $1 AND deleted_at IS NULL FOR UPDATE`, [key]);
    const row = r.rows[0];
    if (!row) throw new Error(`${kind === 'item_list' ? 'Item line' : 'Enquiry'} ${key} not found`);
    if (row.master !== 'dashboard') throw new Error('This row is still owned by Smartsheet and is read-only here: the next import would overwrite the change. Edit it in Smartsheet.');
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [k, v] of vals) {
      const raw = coerce(row[k], cols.find(c => c.db_column === k)!.pg_type);
      const old = raw === '' ? null : raw;
      if (old !== v) changes[k] = { old, new: v };
    }
    const changed = Object.keys(changes);
    if (changed.length === 0) return changed;
    await check?.(row, changes);
    const sets = changed.map((k, i) => `${k} = $${i + 3}`);
    for (const c of stamps(kind, 'MODIFIED')) sets.push(`${c.db_column} = ${c.system_column!.endsWith('_BY') ? '$2' : 'now()'}`);
    await db.query(`UPDATE ${table} SET ${sets.join(', ')}, row_version = row_version + 1, updated_at = now(), updated_by = $2 WHERE ${pk}::text = $1`,
      [key, actor, ...changed.map(k => changes[k].new)]);
    await audit(db, actor, 'UPDATE', table, key, changes);
    return changed;
  });
}

// BUILD_BRIEF §6: never create duplicate item lines - same docket, same party item name (case/space-insensitive), same proposed ERP item.
async function assertNoDuplicate(db: Db, docketNo: string, name: unknown, erp: unknown, exceptId: string) {
  if (typeof name !== 'string' || !name.trim()) return;
  const r = await db.query(`SELECT id FROM enquiry_item WHERE docket_no = $1 AND deleted_at IS NULL AND id::text <> $4
      AND lower(regexp_replace(btrim(party_item_name), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim($2), '\\s+', ' ', 'g'))
      AND coalesce(btrim(propose_erp_item), '') = coalesce(btrim($3), '') ORDER BY id LIMIT 1`, [docketNo, name, erp ?? null, exceptId]);
  if (r.rows[0]) throw new Error(`Duplicate item line: line #${r.rows[0].id} of this docket already has the same party item name and proposed ERP item. Add the quantity to line #${r.rows[0].id} instead.`);
}

const filled = (vals: [string, unknown][]) => {
  const out = vals.filter(([, v]) => v !== null && v !== false);
  if (out.length === 0) throw new Error('Nothing to save: fill in at least one field');
  return out;
};

export async function createEnquiry(db: Db, values: Values, actor: string): Promise<{ docketNo: string }> {
  const vals = filled(prepare('sales_enquiry', values));
  return inTransaction(db, async () => ({ docketNo: await insertRow(db, 'sales_enquiry', vals, [], actor) }));
}

export async function updateEnquiry(db: Db, docketNo: string, values: Values, actor: string): Promise<{ docketNo: string; changed: string[] }> {
  return { docketNo, changed: await updateRow(db, 'sales_enquiry', String(docketNo), values, actor) };
}

export async function addItem(db: Db, docketNo: string, values: Values, actor: string): Promise<{ id: string }> {
  const vals = filled(prepare('item_list', values));
  const v = Object.fromEntries(vals);
  return inTransaction(db, async () => {
    // the row lock also serialises concurrent adds to one docket, so the duplicate check cannot be raced
    const e = await db.query('SELECT 1 FROM enquiry WHERE docket_no = $1 AND deleted_at IS NULL FOR UPDATE', [String(docketNo)]);
    if (!e.rows[0]) throw new Error(`Enquiry ${docketNo} not found`);
    await assertNoDuplicate(db, String(docketNo), v.party_item_name, v.propose_erp_item, '');
    return { id: await insertRow(db, 'item_list', vals, [['docket_no', String(docketNo)], ['item_list', 'new']], actor) };
  });
}

export async function updateItem(db: Db, id: string | number, values: Values, actor: string): Promise<{ id: string; changed: string[] }> {
  const key = String(id);
  const changed = await updateRow(db, 'item_list', key, values, actor, async (row, changes) => {
    if (!changes.party_item_name && !changes.propose_erp_item) return;
    const next = (k: string) => (changes[k] ? changes[k].new : row[k]);
    await assertNoDuplicate(db, row.docket_no, next('party_item_name'), next('propose_erp_item'), key);
  });
  return { id: key, changed };
}

// ---------------------------------------------------------------- reads for the screens
/** One live row with every form column as text (dates 'YYYY-MM-DD', booleans 'true'/'false'), plus master / docket_no / row_version. */
export async function getForEdit(db: Db, kind: SheetKind, key: string): Promise<Record<string, string | null> | null> {
  const { table, pk } = TABLE[kind];
  const r = await db.query(`SELECT ${pk}::text AS pk, master, docket_no, row_version::text AS row_version, ${editable(kind).map(c => `${c.db_column}::text AS ${c.db_column}`).join(', ')}
    FROM ${table} WHERE ${pk}::text = $1 AND deleted_at IS NULL`, [String(key)]);
  return r.rows[0] ?? null;
}

export async function listItems(db: Db, docketNo: string): Promise<Record<string, string | null>[]> {
  const r = await db.query(`SELECT id::text AS id, master, item_list, party_item_name, propose_erp_item, qty::text AS qty, unit
    FROM enquiry_item WHERE docket_no = $1 AND deleted_at IS NULL ORDER BY id`, [docketNo]);
  return r.rows;
}

/** Dropdown values by key: 'parties' | 'utilities' | 'erp_items' | 'countries' | a ref_picklist list_key ("<sheet>.<Smartsheet column title>"). */
export async function picklistOptions(db: Db, keys: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const col = async (key: string, sql: string) => { if (keys.includes(key)) out[key] = (await db.query(sql)).rows.map(r => r.v); };
  await col('parties', 'SELECT name AS v FROM ref_party WHERE active ORDER BY name');
  await col('utilities', 'SELECT name AS v FROM ref_utility WHERE active ORDER BY name');
  await col('erp_items', 'SELECT label AS v FROM ref_erp_item WHERE active ORDER BY label');
  if (keys.includes('countries')) out.countries = picklists.countries; // not seeded into a table (sync/seed.ts)
  const small = keys.filter(k => !(k in out));
  if (small.length) {
    const r = await db.query('SELECT list_key, value FROM ref_picklist WHERE list_key = ANY($1) ORDER BY list_key, sort_order', [small]);
    for (const row of r.rows) (out[row.list_key] ??= []).push(row.value);
  }
  return out;
}
