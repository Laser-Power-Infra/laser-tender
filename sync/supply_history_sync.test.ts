import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from './lib.ts';
import { schemaSql } from './env.ts';
import { copySupplyHistory } from './supply_history_sync.ts';

test('supply history and certificates copy: every column as it is, replaces our rows, an empty source keeps them', async () => {
  const [src, dst] = await Promise.all([0, 1].map(async () => { const p = new PGlite(); await p.exec(schemaSql()); return p as unknown as Db; }));
  await src.query(`INSERT INTO "SupplyHistory" (id, "createdAt", "updatedAt", fy, "saleBillNumber", "itemCode", rate, "invoiceQty", "certificateSentDate", "lastSyncedAt") VALUES
    ('a', '2026-05-28 10:00:00.123', '2026-05-29 11:00:00', '26-27', 'LT26Y-00036', 'FA1', 1234.5, 2.822, '2026-06-01 09:30:00', '2026-08-14 00:00:00'),
    ('b', '2026-05-28 10:00:00', '2026-05-28 10:00:00', '26-27', 'LT26Y-00035', 'FA2', NULL, NULL, NULL, '2026-08-14 00:00:00')`);
  // the duplicate (serial 1) is listed before its original (serial 2)
  await src.query(`INSERT INTO performance_certificates (id, "updatedAt", serial, "certificateName", "issueDate", "duplicateOfId") VALUES
    ('dup', '2026-11-25 10:00:00', 1, 'Copy.pdf', NULL, 'orig'), ('orig', '2026-11-25 10:00:00', 2, 'Cert.pdf', '2021-10-20 18:30:00', NULL)`);
  await src.query(`INSERT INTO "_CertSupplyHistory" ("A", "B") VALUES ('orig', 'a'), ('orig', 'b')`);
  await dst.query(`INSERT INTO "SupplyHistory" (id, "updatedAt", fy) VALUES ('stale', now(), '18-19')`);
  await dst.query(`INSERT INTO performance_certificates (id, "updatedAt") VALUES ('stale-cert', now())`);
  await dst.query(`INSERT INTO "_CertSupplyHistory" ("A", "B") VALUES ('stale-cert', 'stale')`);

  const all = async (db: Db) => Promise.all(['"SupplyHistory" s ORDER BY id', 'performance_certificates s ORDER BY id', '"_CertSupplyHistory" s ORDER BY "A", "B"']
    .map(async t => (await db.query(`SELECT to_jsonb(s) AS j FROM ${t}`)).rows.map(r => r.j)));
  assert.deepEqual(await copySupplyHistory(src, dst), { supply: 2, certificates: 2, links: 2 });
  assert.deepEqual(await all(dst), await all(src));          // timestamps, numbers, serials and nulls unchanged; the stale rows are gone
  assert.equal((await all(dst))[0][0].createdAt, '2026-05-28T10:00:00.123');
  await copySupplyHistory(src, dst);                         // a second run gives the same tables
  assert.deepEqual(await all(dst), await all(src));

  await src.query('DELETE FROM "SupplyHistory"');
  await assert.rejects(copySupplyHistory(src, dst), /our copy is kept/);
  assert.deepEqual((await all(dst)).map(t => t.length), [2, 2, 2]);
});
