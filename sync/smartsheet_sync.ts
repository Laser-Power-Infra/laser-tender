// Smartsheet -> Postgres import / incremental sync (Phase 1 and the Smartsheet->DB half of Phase 2).
//
//   SMARTSHEET_TOKEN=... DATABASE_URL=postgres://... npx tsx sync/smartsheet_sync.ts --sheet all
//   npx tsx sync/smartsheet_sync.ts --sheet sales_enquiry --since 2026-11-20T00:00:00Z
//   npx tsx sync/smartsheet_sync.ts --sheet sales_enquiry --fixture sync/fixtures/sales_enquiry.json --dry-run
//
// Idempotent: safe to run every 5-10 minutes. Uses rowsModifiedSince for increments.
// Rows with master='dashboard' are never overwritten (see lib.ts).
import { Db, SsSheet, SheetKind, loadConfig, mapRow, upsertEnquiry, upsertItem, inTransaction } from './lib.ts';
import { isMain, cliPool, smartsheetToken, schemaSql } from './env.ts';

const API = 'https://api.smartsheet.com/2.0';

async function ssGet(path: string, token: string, attempt = 0): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 || res.status >= 500) {            // Smartsheet rate limit: 300 requests/min/token
    if (attempt >= 6) throw new Error(`Smartsheet ${res.status} on ${path} after retries`);
    await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
    return ssGet(path, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`Smartsheet ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

/** Fetch a whole sheet (all pages). `since` = ISO timestamp -> only rows modified after it. */
export async function fetchSheet(token: string, sheetId: string, since?: string): Promise<SsSheet> {
  const pageSize = 2000;
  let page = 1; let sheet: SsSheet | null = null;
  for (;;) {
    const q = `?pageSize=${pageSize}&page=${page}` + (since ? `&rowsModifiedSince=${encodeURIComponent(since)}` : '');
    const j = await ssGet(`/sheets/${sheetId}${q}`, token);
    if (!sheet) sheet = { id: j.id, name: j.name, columns: j.columns, rows: [] };
    sheet.rows.push(...(j.rows ?? []));
    // GET /sheets/{id} returns no totalPages (only totalRowCount, unfiltered): stop on the first short page.
    if ((j.rows ?? []).length < pageSize) break;
    page++;
  }
  return sheet!;
}

export interface SyncResult { read: number; inserted: number; updated: number; skipped: number; unmappedTitles: string[]; maxModified: string | null }

export async function syncSheet(db: Db, cfg: { key: string; kind: SheetKind; sheetId: string; itemList?: string }, sheet: SsSheet): Promise<SyncResult> {
  const res: SyncResult = { read: sheet.rows.length, inserted: 0, updated: 0, skipped: 0, unmappedTitles: [], maxModified: null };
  const unmapped = new Set<string>();
  await inTransaction(db, async () => {
    for (const row of sheet.rows) {
      const m = mapRow(cfg.kind, sheet, row);
      m.unmappedTitles.forEach(t => unmapped.add(t));
      if (m.modifiedAt && (!res.maxModified || m.modifiedAt > res.maxModified)) res.maxModified = m.modifiedAt;
      const out = cfg.kind === 'sales_enquiry'
        ? await upsertEnquiry(db, cfg.sheetId, m)
        : await upsertItem(db, cfg.sheetId, cfg.itemList ?? 'ERP 11', m);
      res[out]++;
    }
  });
  res.unmappedTitles = [...unmapped];
  return res;
}

/** Incremental sync of the configured sheets (cursor per sheet in sync_state). Used by the CLI and by the app's Refresh Data.
 *  `full` reads every row: Smartsheet's rowsModifiedSince misses some changed rows (seen 27 Nov 2026: ENQ-21815 edited on 26 Nov was never returned),
 *  so the daily job runs full and the incremental run is only the quick refresh in between. */
export async function runSmartsheetSync(db: Db, token: string, want = 'all', opts: { since?: string; record?: boolean; full?: boolean } = {}): Promise<Record<string, SyncResult>> {
  const cfg = loadConfig().smartsheet.filter((s: any) => want === 'all' || s.key === want);
  if (!cfg.length) throw new Error(`no sheet '${want}' in sheets.config.json`);
  const out: Record<string, SyncResult> = {};
  for (const c of cfg) {
    const started = new Date();
    const stateKey = `smartsheet:${c.key}`;
    const since = opts.full ? undefined : opts.since ?? (await db.query('SELECT last_modified_cursor FROM sync_state WHERE job=$1', [stateKey])).rows[0]?.last_modified_cursor?.toISOString?.();
    const r = await syncSheet(db, c, await fetchSheet(token, c.sheetId, since));
    out[c.key] = r;
    console.log(`[${c.key}] read=${r.read} inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped}` + (r.unmappedTitles.length ? ` UNMAPPED COLUMNS: ${r.unmappedTitles.join(' | ')}` : ''));
    if (opts.record !== false) {
      await db.query(`INSERT INTO sync_state(job,last_success_at,last_modified_cursor,detail) VALUES ($1,now(),$2,$3::jsonb)
                      ON CONFLICT (job) DO UPDATE SET last_success_at=now(), last_modified_cursor=coalesce($2, sync_state.last_modified_cursor), detail=$3::jsonb`,
        [stateKey, r.maxModified, JSON.stringify(r)]);
      await db.query('INSERT INTO sync_log(job,started_at,finished_at,ok,rows_read,rows_written,message) VALUES ($1,$2,now(),true,$3,$4,$5)',
        [stateKey, started, r.read, r.inserted + r.updated, r.unmappedTitles.length ? `unmapped: ${r.unmappedTitles.join(', ')}` : null]);
    }
  }
  return out;
}

async function main() {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i]);
  if (args.has('dry-run')) {      // live read-only fetch into an in-memory database: nothing is written anywhere
    const { PGlite } = await import('@electric-sql/pglite');
    const p = new PGlite(); await p.exec(schemaSql());
    await runSmartsheetSync(p as unknown as Db, smartsheetToken(), args.get('sheet') ?? 'all', { since: args.get('since'), record: false });
    for (const t of ['enquiry', 'enquiry_item']) console.log(t, 'rows:', (await p.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]);
    return;
  }
  const { db, close } = await cliPool();
  await runSmartsheetSync(db, smartsheetToken(), args.get('sheet') ?? 'all', { since: args.get('since'), full: args.has('full') });
  await close();
}

if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
