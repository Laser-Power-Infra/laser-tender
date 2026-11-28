// Tender executive dashboard -> Postgres: supply history and performance certificates. The three tables are the same in both
// databases; ours are a copy, theirs are the master (certificates are added, reviewed and linked there).
//
//   npm run sync:supply-history
//
// Source: TENDER_EXECUTIVE_DATABASE_URL, or by default the database "tender-executive-dashboard-production" on our own server with
// our own login. The tables are replaced on every run (inside one transaction). Also run by the daily job (lib/dailyJobs.ts).
import { Db, inTransaction } from './lib.ts';
import { isMain, cliPool, databaseUrl, loadEnv } from './env.ts';

export const SUPPLY_JOB = 'tender-executive:SUPPLY_HISTORY:SupplyHistory';

// In the order they are filled: the link table points at the other two.
const TABLES = ['"SupplyHistory"', 'performance_certificates', '"_CertSupplyHistory"'] as const;
export type SupplyCounts = { supply: number; certificates: number; links: number };

/** Replace our copies with the source's. An empty supply history changes nothing: it is far more likely a fault than the truth. */
export async function copySupplyHistory(src: Db, dst: Db): Promise<SupplyCounts> {
  // to_jsonb: every value exactly as Postgres holds it (the pg driver would shift the timestamps by the local time zone)
  const read = async (t: string) => (await src.query(`SELECT to_jsonb(s) AS j FROM ${t} s`)).rows.map(r => r.j);
  const supply = await read(TABLES[0]), certificates = await read(TABLES[1]), links = await read(TABLES[2]);   // one after another: one connection
  if (supply.length === 0) throw new Error('the tender executive database has no supply history rows: our copy is kept');
  const insert = (table: string, rows: unknown[]) =>
    dst.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
  await inTransaction(dst, async () => {
    for (const t of [...TABLES].reverse()) await dst.query(`DELETE FROM ${t}`);
    for (let i = 0; i < supply.length; i += 2000) await insert(TABLES[0], supply.slice(i, i + 2000));
    // one statement each: a duplicate certificate may point at an original that comes later in the list
    if (certificates.length) await insert(TABLES[1], certificates);
    if (links.length) await insert(TABLES[2], links);
  });
  return { supply: supply.length, certificates: certificates.length, links: links.length };
}

function sourceUrl(): string {
  if (process.env.TENDER_EXECUTIVE_DATABASE_URL) return process.env.TENDER_EXECUTIVE_DATABASE_URL;
  const ours = databaseUrl();
  if (!ours) throw new Error('No database URL: set TENDER_EXECUTIVE_DATABASE_URL, or DATABASE_URL / DATABASE_URL_DEV');
  const url = new URL(ours);
  url.pathname = '/tender-executive-dashboard-production';
  return url.href;
}

/** Copy the tables and record the run in sync_log. `dst` must be one connection. */
export async function runSupplyHistorySync(dst: Db): Promise<SupplyCounts> {
  const started = new Date();
  const { default: pg } = await import('pg');
  const src = new pg.Client({ connectionString: sourceUrl() });
  try {
    await src.connect();
    const n = await copySupplyHistory(src as unknown as Db, dst);
    const total = n.supply + n.certificates + n.links;
    await dst.query('INSERT INTO sync_log(job,started_at,finished_at,ok,rows_read,rows_written) VALUES ($1,$2,now(),true,$3,$3)', [SUPPLY_JOB, started, total]);
    return n;
  } catch (e: any) {
    await dst.query('INSERT INTO sync_log(job,started_at,finished_at,ok,message) VALUES ($1,$2,now(),false,$3)', [SUPPLY_JOB, started, String(e.message).slice(0, 500)]).catch(() => {});
    throw e;
  } finally {
    await src.end().catch(() => {});
  }
}

async function main() {
  loadEnv();
  const { db, close } = await cliPool();
  try {
    const n = await runSupplyHistorySync(db);
    console.log(`[SupplyHistory] ${n.supply} supply rows, ${n.certificates} performance certificates, ${n.links} links between them`);
  } finally { await close(); }
}

if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
