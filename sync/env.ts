// CLI plumbing shared by the sync scripts: env loading, DB pool, Smartsheet token, schema for in-memory dry runs.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Db } from './lib.ts';

/** True when the file is the script being run (works on Windows, unlike a `file://${argv[1]}` compare). */
export const isMain = (metaUrl: string) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;

export function loadEnv() {
  try { process.loadEnvFile(); } catch { /* no .env: rely on the real environment */ }
}

/** Same rule as lib/prisma.ts: PROD -> DATABASE_URL, otherwise DATABASE_URL_DEV. */
export const databaseUrl = () => (process.env.ENVIRONMENT === 'PROD' ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEV);

export async function cliPool(): Promise<{ db: Db; close: () => Promise<void> }> {
  loadEnv();
  const url = databaseUrl();
  if (!url) throw new Error('No database URL: set DATABASE_URL (ENVIRONMENT=PROD) or DATABASE_URL_DEV');
  const { default: pg } = await import('pg');
  // One Client, not a Pool: inTransaction sends BEGIN/COMMIT through query(), which must stay on one connection.
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return { db: client as unknown as Db, close: () => client.end() };
}

export function smartsheetToken(): string {
  loadEnv();
  const t = process.env.SMARTSHEET_API_TOKEN;
  if (!t) throw new Error('SMARTSHEET_API_TOKEN is not set');
  return t;
}

/** Every Prisma migration in order: the schema the tests and --dry-run load into PGlite. Run from the repo root. */
export function schemaSql(): string {
  const dir = path.join(process.cwd(), 'prisma', 'migrations');
  return fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'migration.sql'))).sort()
    .map(d => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8')).join('\n');
}
