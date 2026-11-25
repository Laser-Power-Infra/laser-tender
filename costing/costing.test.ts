import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsumption, rmRateFor, interestPct, drumMakingCharge, drumFromMaster, drumFromBom, freightPerTrip, freightTotal, matchNonChainBom, mmToInch } from './rules.ts';
import { costItem, ItemInput } from './engine.ts';
import { runParity } from './parity.ts';

const rates = [
  { rate_date: '2026-10-01', rm_name: 'AL ROD', rate: 250 }, { rate_date: '2026-11-10', rm_name: 'AL ROD', rate: 260 }, { rate_date: '2026-11-24', rm_name: 'AL ROD', rate: 265 },
  { rate_date: '2026-11-20', rm_name: 'XLPE', rate: 150 },
];

test('consumption source order is respected and never guessed', () => {
  const line = (n: number) => [{ rm_name: 'AL ROD', consumption: n, formula: 'f' }];
  const r = resolveConsumption([{ source: 'IS_STANDARD', source_ref: 'IS 398 cl.x', lines: line(9) }, { source: 'APPROVED_GTP', source_ref: 'GTP-1', lines: line(5) }, { source: 'SAME_UTILITY_SPEC', source_ref: 'ENQ-1', lines: line(7) }])!;
  assert.equal(r[0].source, 'SAME_UTILITY_SPEC'); assert.equal(r[0].consumption, 7);
  assert.equal(resolveConsumption([]), null);
  assert.equal(resolveConsumption([{ source: 'DOCKET_SPEC', source_ref: 'x', lines: [] }]), null);
});

test('RM rate policy: FIRM = today, PV = base date, carried forward', () => {
  assert.equal(rmRateFor(rates, 'AL ROD', 'FIRM', '2026-11-24').rate, 265);
  assert.equal(rmRateFor(rates, 'AL ROD', 'PV', '2026-11-24', '2026-11-15').rate, 260);
  assert.equal(rmRateFor(rates, 'AL ROD', 'PV', '2026-11-24', '2026-10-15').rate, 250);
  assert.equal(rmRateFor(rates, 'XLPE', 'FIRM', '2026-11-24').rate_date, '2026-11-20');   // carried forward
  assert.equal(rmRateFor(rates, 'AL ROD', 'PV', '2026-11-24', '2026-09-01').rate, null);
  assert.match(rmRateFor(rates, 'AL ROD', 'PV', '2026-11-24').note, /FLAG/);
});

test('interest: 1% per 30 days and the default ladder', () => {
  assert.deepEqual(interestPct({ statedCreditDays: 45, orderValueRupees: 1 }), { pct: 1.5, days: 45, basis: 'party terms' });
  assert.equal(interestPct({ partyLastQuoteDays: 30, orderValueRupees: 1 }).pct, 1);
  assert.equal(interestPct({ orderValueRupees: 49_99_999 }).days, 0);
  assert.equal(interestPct({ orderValueRupees: 80_00_000 }).days, 60);
  assert.equal(interestPct({ orderValueRupees: 80_00_000 }).pct, 2);
  assert.equal(interestPct({ statedCreditDays: 0, orderValueRupees: 99_00_000 }).days, 0);   // stated advance beats the default
});

test('drum rules', () => {
  assert.equal(drumMakingCharge(54), 150); assert.equal(drumMakingCharge(54.1), 200);
  assert.equal(mmToInch(1270), 50);
  assert.deepEqual(drumFromMaster({ cost_col_n: 5000, cost_col_d: 4000 }), { cost: 5000, usedFallback: false });
  assert.deepEqual(drumFromMaster({ cost_col_n: null, cost_col_d: 4000 }), { cost: 4000, usedFallback: true });
  assert.equal(drumFromBom([{ consumption: 10, lastRate: 50 }, { consumption: 2, lastRate: 100 }], 48).cost, 850);
  assert.equal(drumFromBom([{ consumption: 10, lastRate: 50 }], 60).cost, 700);
  assert.equal(drumFromBom(null, 48, 1200).cost, 3600);
  assert.equal(drumFromBom(null, 48).cost, null);
});

test('freight: abnormal never used, 6-month rule, lowest, pin fallback, full truck, ex-works', () => {
  const rows = [
    { to_pin: '700001', vehicle_type: '20T', rate_per_trip: 30000, rate_date: '2026-10-01', abnormal: false },
    { to_pin: '700001', vehicle_type: '20T', rate_per_trip: 28000, rate_date: '2026-09-01', abnormal: false },
    { to_pin: '700001', vehicle_type: '20T', rate_per_trip: 1000, rate_date: '2026-11-01', abnormal: true },
    { to_pin: '700001', vehicle_type: '20T', rate_per_trip: 20000, rate_date: '2026-01-01', abnormal: false },   // > 6 months -> 21000
    { to_pin: '700099', vehicle_type: '20T', rate_per_trip: 31000, rate_date: '2026-11-01', abnormal: false },
  ];
  assert.equal(freightPerTrip(rows, '700001', '20T', '2026-11-24').perTrip, 21000);
  assert.equal(freightPerTrip(rows, '700050', '20T', '2026-11-24').perTrip, 21000);      // nearest by prefix 700 -> lowest of 700xxx
  assert.match(freightPerTrip(rows, '700050', '20T', '2026-11-24').basis, /FLAG/);
  assert.equal(freightPerTrip(rows, '110001', '20T', '2026-11-24').perTrip, null);
  assert.equal(freightPerTrip(rows, '700001', '32T', '2026-11-24').perTrip, null);
  assert.deepEqual(freightTotal(21000, 7, 4, true), { total: 42000, trips: 2, basis: '2 full truck(s) x 21000' });
  assert.equal(freightTotal(21000, 7, 4, false).total, 0);
});

test('non-chain BOM match within 1%', () => {
  const boms = { B1: { AL: 100, XLPE: 20 }, B2: { AL: 100.5, XLPE: 20.1 }, B3: { AL: 103, XLPE: 20 } };
  assert.equal(matchNonChainBom({ AL: 100, XLPE: 20 }, boms).bomId, 'B1');
  assert.equal(matchNonChainBom({ AL: 100.4, XLPE: 20 }, { B2: boms.B2, B3: boms.B3 }).bomId, 'B2');
  assert.equal(matchNonChainBom({ AL: 100, XLPE: 20 }, { B3: boms.B3 }).bomId, null);
  assert.equal(matchNonChainBom({ AL: 100 }, { B1: boms.B1 }).bomId, null);   // different RM set
});

const base: ItemInput = {
  qty: 1, unit: 'KM', today: '2026-11-24', rmPolicy: 'FIRM', rmRates: rates,
  rmLines: [{ rm_name: 'AL ROD', consumption: 100, source: 'DOCKET_SPEC', source_ref: 'TS p3', formula: 'x' }],
  drumCostPerUnit: 500, freightPerUnit: 1000, pct: { mfg: 0.05, profit: 0.08, insp: 0.01, ttr: 0.005, gst: 0.18 }, interest: { statedCreditDays: 30, orderValueRupees: 1 },
};
test('engine: RM detail cites source, warns on missing rate, reports the markup basis', () => {
  const o = costItem(base);
  assert.equal(o.rm_cost, 26500); assert.equal(o.rm_detail[0].consumption_source, 'DOCKET_SPEC');
  assert.equal(o.markup_order, 'TOUHID_SHEETS_PARTIAL');
  assert.equal(o.gst, Math.round(o.price_ex_gst * 0.18 * 100) / 100);
  assert.equal(o.price_ex_gst, Math.round((o.ex_works + 1000) * 100) / 100);
  const bad = costItem({ ...base, rmLines: [{ ...base.rmLines[0], rm_name: 'UNKNOWN' }] });
  assert.ok(bad.warnings.some(w => /no rate/.test(w)));
});
test('engine: PV uses base-date rate; ex-works has no freight', () => {
  const pv = costItem({ ...base, rmPolicy: 'PV', baseDate: '2026-11-15' });
  assert.equal(pv.rm_cost, 26000);
  const xw = costItem({ ...base, freightPerUnit: 0 });
  assert.equal(xw.price_ex_gst, xw.ex_works);
});
test('parity harness reports mismatches', () => {
  const o = costItem(base);
  const ok = runParity([{ docket: 'D', item: 'I', input: base, expected: { rm_cost: 26500, ex_works: o.ex_works } }]);
  assert.ok(ok.every(r => r.ok));
  const bad = runParity([{ docket: 'D', item: 'I', input: base, expected: { ex_works: o.ex_works * 1.1 } }]);
  assert.equal(bad[0].ok, false);
});

// Real rows from Touhid's costings (CLAUDE COSTINGS / TOUHID ITEMS, 24 Nov 2026): cost/km (RM + drum), MFG, Intt, Insp -> EXW/km, price incl GST.
test('markup order reproduces Touhid costings', async () => {
  const { applyMarkups } = await import('./engine.ts');
  const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 0.05, `${got} vs ${want}`);     // his sheet rounds 1st EXW to paise first
  for (const [cost, mfg, intt, insp, exw, price] of [
    [113538.48, 0.04, 3, 0.01, 122803.24, 144907.82],        // FC6200002 ACSR DOG
    [1293536.23, 0.15, 3, 0.01, 1547069.35, 1825541.83],     // FA1100114 3.5C x 400 AL/ARD
    [643527.03, 0.15, 3, 0.01, 769658.35, 908196.85],        // FA0200073 19C x 2.5 CU/ARD
    [844046, 0.15, 0, 0, 970652.9, 1145370.42],              // FA0700002 1C x 630 AL/ARD
    [187312, 0.40, 0, 0, 262236.8, 309439.42],               // FA0900008 3.5C x 35 AL/ARD
  ]) {
    const m = applyMarkups({ rm: cost, drum: 0 }, { mfg, profit: 0, insp, ttr: 0, gst: 0.18 }, intt, 0);
    near(m.exWorks, exw);
    near(m.exWorks * 1.18, price);
  }
});
