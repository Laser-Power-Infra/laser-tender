import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../sync/lib.ts';
import { schemaSql } from '../sync/env.ts';
import { draftCosting, readCostingRuns, NO_CONSUMPTION } from './costingRun.ts';

// One PGlite for the whole file, schema reset per test (several instances crash V8 here).
let pglite: PGlite | undefined;
async function freshDb() {
  pglite ??= new PGlite();
  await pglite.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' + schemaSql());
  const db = pglite as unknown as Db;
  await db.query(`INSERT INTO enquiry (docket_no, quotation_no) VALUES ('ENQ-1', NULL)`);
  // Percent columns are fractions. Item 1 has a BOM and an unapproved special VA; item 2 has no BOM id; item 3 is deleted.
  await db.query(`INSERT INTO enquiry_item (docket_no, propose_erp_item, qty, unit, freight, gst_pct, mfg_pct, prof_pct, intt_pct, insp_pct,
                    special_value_addition_pct, special_rate_approval_dvg, actual_non_chain_bom_id, base_date, deleted_at) VALUES
    ('ENQ-1', 'CABLE A@FA1300213', 10, 'KMS', 25000, 0.18, 0.05, 0.10, 0.01, 0, 0.02, 'NO', ' U1-C0003-2922 ', '2026-10-01', NULL),
    ('ENQ-1', 'CABLE B@FA0000001', 5, 'KMS', NULL, 0.18, 0.05, 0.10, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('ENQ-1', 'GONE@X', 1, 'KMS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'U1-C0003-2922', NULL, now())`);
  // BOM RM names as in NON CHAIN BOM; rate names as in DAILY MKT CP (note the double space); no rate for XLPE CCV-TR.
  await db.query(`INSERT INTO non_chain_bom (bom_id, erp_code, rm_name, consumption) VALUES
    ('U1-C0003-2922', 'FA1300213', 'Aluminium Wire Rod', 2616), ('U1-C0003-2922', 'FA1300213', 'PP FILLER - 18 MM', 10),
    ('U1-C0003-2922', 'FA1300213', 'XLPE CCV-TR', 717)`);
  await db.query(`INSERT INTO rm_rate (rate_date, rm_name, rate, rate_unit, source_tab) VALUES
    ('2026-11-23', 'Aluminium Wire Rod', 340, 'KG', 'DAILY MKT CP'), ('2026-11-24', 'Aluminium Wire Rod', 341, 'KG', 'DAILY MKT CP'),
    ('2026-11-25', 'Aluminium Wire Rod', 999, 'KG', 'DAILY MKT CP'), ('2026-11-24', 'PP FILLER  - 18 MM', 132, NULL, 'DAILY MKT CP'),
    ('2026-11-24', 'Aluminium Wire Rod', 1, 'KG', 'DAILY RM RATES')`);
  return db;
}
const itemsSnapshot = async (db: Db) => JSON.stringify((await db.query('SELECT * FROM enquiry_item ORDER BY id')).rows);

test('draft run: BOM item gets rm_detail with source + formula, item without BOM is flagged with no numbers', async () => {
  const db = await freshDb();
  const before = await itemsSnapshot(db);
  const res = await draftCosting(db, 'ENQ-1', 'puja@example.com', '2026-11-24');
  assert.equal(res.revision, 1);

  const [run] = await readCostingRuns(db, 'docket_no', 'ENQ-1');
  assert.deepEqual([run.status, run.rm_rate_policy, run.created_by, run.items.length], ['DRAFT', 'FIRM', 'puja@example.com', 2]);

  const [a, b] = run.items;
  assert.equal(a.it_code, 'IT001');
  assert.deepEqual(a.rm.map(r => [r.rm_name, Number(r.consumption), r.rate == null ? null : Number(r.rate), r.rate_date, r.amount == null ? null : Number(r.amount)]), [
    ['Aluminium Wire Rod', 2616, 341, '2026-11-24', 892056],       // today's rate, not the later one, not the other tab
    ['PP FILLER - 18 MM', 10, 132, '2026-11-24', 1320],            // matched despite the double space in the rate sheet
    ['XLPE CCV-TR', 717, null, null, null],
  ]);
  for (const r of a.rm) {
    assert.equal(r.consumption_source, 'NON_CHAIN_BOM');
    assert.match(r.source_ref!, /NON CHAIN BOM, BOM Code U1-C0003-2922/);
    assert.match(r.formula!, /consumption = NON CHAIN BOM U1-C0003-2922, column ".+" \| amount = consumption x rate/);
  }
  // XLPE CCV-TR has no rate: the RM detail is kept but no (understated) totals are stored
  assert.deepEqual([a.rm_cost, a.ex_works, a.price_ex_gst, a.price_incl_gst], [null, null, null, null]);
  const w = a.warnings.join('\n');
  for (const re of [/XLPE CCV-TR: no rate/, /RM cost incomplete/, /Special VA % 0.02 NOT applied: no DVG approval/, /placement of PROF %, TTR % and special VA % is NOT verified/, /Q10.*freight 25000 NOT applied/, /drum cost per unit = 0: item FA1300213 not in STD DRUM MAP/, /blank % column\(s\) taken as 0: ttr/])
    assert.match(w, re);

  assert.deepEqual([b.it_code, b.bom_match_note, b.rm.length], ['IT002', 'no ACTUAL NON CHAIN BOM ID', 0]);
  assert.deepEqual([b.rm_cost, b.ex_works, b.price_ex_gst, b.price_incl_gst], [null, null, null, null]);
  assert.deepEqual(b.warnings, [NO_CONSUMPTION]);
  assert.ok(res.warnings.includes(`IT002: ${NO_CONSUMPTION}`));

  const stored = (await db.query('SELECT inputs, breakdown FROM item_costing ORDER BY id LIMIT 1')).rows[0];
  assert.equal(stored.inputs.rmLines.length, 3);
  assert.equal(stored.breakdown.markup_order, 'TOUHID_SHEETS_PARTIAL');

  assert.equal(await itemsSnapshot(db), before);                                   // nothing on enquiry_item changes
  assert.equal((await db.query(`SELECT quotation_no FROM enquiry`)).rows[0].quotation_no, null);
});

test('second call makes revision 2; PV uses the item base date; approved special VA is applied', async () => {
  const db = await freshDb();
  await draftCosting(db, 'ENQ-1', 'a@x', '2026-11-24');
  await db.query(`UPDATE enquiry SET price_basis = 'PRICE VARIATION' WHERE docket_no = 'ENQ-1'`);
  await db.query(`UPDATE enquiry_item SET special_rate_approval_dvg = 'YES', base_date = '2026-11-23' WHERE actual_non_chain_bom_id IS NOT NULL`);
  await db.query(`INSERT INTO rm_rate (rate_date, rm_name, rate, source_tab) VALUES ('2026-11-23', 'PP FILLER - 18 MM', 132, 'DAILY MKT CP'), ('2026-11-23', 'XLPE CCV-TR', 100, 'DAILY MKT CP')`);
  await db.query(`INSERT INTO sheet_snapshot (sheet_key, tab_name, row_no, data) VALUES
    ('CIRCULARS', 'STD DRUM MAP', 2, '{"ITEM CODE":"FA1300213","DRUM CODE":"MD0100066","STD LENGTH (M)":"500"}'),
    ('CIRCULARS', 'STD DRUM COST', 2, '{"DRUM CODE":"MD0100066","DRUM COST PER DRUM (Rs)":"2724","COST SOURCE":"DRUM MASTER - old costing rate"}')`);
  const res = await draftCosting(db, 'ENQ-1', 'a@x', '2026-11-24');
  assert.equal(res.revision, 2);

  const runs = await readCostingRuns(db, 'docket_no', 'ENQ-1');
  assert.deepEqual(runs.map(r => [r.revision, r.rm_rate_policy, r.rm_base_date]), [[2, 'PV', '2026-11-23'], [1, 'FIRM', null]]);
  const a = runs[0].items[0];
  assert.deepEqual([Number(a.rm[0].rate), a.rm[0].rate_date], [340, '2026-11-23']);
  // every RM rated: 2616 x 340 + 10 x 132 + 717 x 100 = 962460; drum 2724 x 1000 / 500 = 5448 per km (as in Touhid's old costings)
  // cost 967908 x (1 + 0.05 mfg + 0.10 profit + 0.02 approved VA) = 1132452.36; x (1 + 0.01 interest) = 1143776.88
  assert.equal(Number(a.rm_cost), 962460);
  assert.deepEqual([Number(a.drum_cost), Number(a.freight)], [5448, 0]);
  assert.equal(Number(a.ex_works), 1143776.88);
  assert.match(a.warnings.join('\n'), /drum cost\/km 5448 = drum MD0100066 Rs 2724 x 1000 \/ std length 500 m/);
  assert.deepEqual((await readCostingRuns(db, 'id', runs[1].id)).map(r => r.revision), [1]);
  await assert.rejects(draftCosting(db, 'ENQ-404', 'a@x', '2026-11-24'), /No live items/);
});
