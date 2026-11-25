// Load dropdown lists (seed/picklists.json) into ref_* tables and align docket_counter with the imported data.
//   DATABASE_URL=... npx tsx sync/seed.ts
import picklists from '../seed/picklists.json';
import { Db } from './lib.ts';
import { isMain, cliPool } from './env.ts';

export async function seed(db: Db) {
  const p = picklists as any;
  for (const n of p.parties ?? []) await db.query('INSERT INTO ref_party(name) VALUES ($1) ON CONFLICT DO NOTHING', [n]);
  for (const n of p.utilities ?? []) await db.query('INSERT INTO ref_utility(name) VALUES ($1) ON CONFLICT DO NOTHING', [n]);
  for (const i of p.erp_items ?? []) await db.query('INSERT INTO ref_erp_item(code,name,label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [i.code, i.name, i.label]);
  for (const [key, vals] of Object.entries<string[]>(p.small_picklists ?? {})) {
    let i = 0; for (const v of vals) await db.query('INSERT INTO ref_picklist(list_key,sort_order,value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [key, i++, v]);
  }
}

/** Set docket_counter so the next dashboard-issued docket continues after the highest imported one. Run AFTER the Smartsheet import. */
export async function alignDocketCounter(db: Db): Promise<number> {
  const r = await db.query(`SELECT coalesce(max(split_part(docket_no,'-',2)::int),0) AS m FROM enquiry WHERE docket_no ~ '^ENQ-[0-9]+-'`);
  const m = Number(r.rows[0].m);
  await db.query(`SELECT setval('docket_counter', $1, $2)`, [Math.max(m, 1), m > 0]);
  return m;
}

async function main() {
  const { db: pool, close } = await cliPool();
  await seed(pool);
  console.log('picklists seeded; highest docket =', await alignDocketCounter(pool));
  await close();
}
if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
