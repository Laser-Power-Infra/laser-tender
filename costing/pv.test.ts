import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetDate, addMonths, firstWorkingDay, lastWorkingDay, indexSpecFor, lookupIndex, pvValue, offerAdvice, bestOfferMonth, eventKindForTerms, pctChangeInConductor, IndexSeries, pvClauseSummary } from './pv.ts';

test('sheet date parsing', () => {
  assert.equal(parseSheetDate('10-Oct-2025'), '2025-10-10'); assert.equal(parseSheetDate('01-Dec-24'), '2024-12-01');
  assert.equal(parseSheetDate('1-Jul-2013'), '2013-07-01'); assert.equal(parseSheetDate('20-09-2025'), '2025-09-20');
  assert.equal(parseSheetDate('NOT OFFERED'), null); assert.equal(parseSheetDate(''), null);
});
test('date helpers: EDATE clamp, working days', () => {
  assert.equal(addMonths('2025-03-31', -1), '2025-02-28');
  assert.equal(firstWorkingDay('2025-11-01'), '2025-11-03');       // 1 Nov 2025 is Saturday
  assert.equal(lastWorkingDay('2025-11-01'), '2025-11-28');        // 30 Nov is Sunday
});
test('PV DATE RULE MAP: index date per code', () => {
  assert.deepEqual(indexSpecFor('PMA-IE@PREVIOUS MONTH AVG - IEEMA', '2025-11-19'), { kind: 'MONTHLY', month: '2025-10-01' });   // matches sheet row: applicable 01-Oct-25
  assert.deepEqual(indexSpecFor('PMA-IE@PREVIOUS MONTH AVG - CACMAI', '2025-11-19'), { kind: 'MONTH_AVG', month: '2025-10-01' });
  assert.deepEqual(indexSpecFor('PMD-IE@PREVIOUS MONTH DATE TO DATE-IEEMA', '2025-03-31'), { kind: 'DAILY', date: '2025-02-28' });
  assert.deepEqual(indexSpecFor('1WDPM-CA@1ST WORKING DAY PRIOR MONTH- CACMAI', '2025-12-10'), { kind: 'DAILY', date: '2025-11-03' });
  assert.deepEqual(indexSpecFor('LWDPM-CA@LAST WORKING DAY PRIOR MONTH- CACMAI', '2025-12-10'), { kind: 'DAILY', date: '2025-11-28' });
  assert.deepEqual(indexSpecFor('15DP-CA@15 DAYS PRIOR CACMAI', '2025-12-10'), { kind: 'DAILY', date: '2025-11-25' });
  assert.deepEqual(indexSpecFor('30 DAYS PRIOR IEEMA-CONDUCTOR', '2025-12-10'), { kind: 'DAILY', date: '2025-11-10' });
  assert.throws(() => indexSpecFor('XYZ', '2025-12-10'));
});
test('event kind from PV terms', () => {
  assert.equal(eventKindForTerms('PHYSICAL DELIVERY AT STORE(-)'), 'DELIVERY');
  assert.equal(eventKindForTerms('BackfromInspOffer date(-), 1ST DAY OF PREVIOUS MONTH'), 'OFFER');
  assert.equal(eventKindForTerms('Backfrom dispatch doc date(-)'), 'DISPATCH');
  assert.equal(eventKindForTerms('NA'), 'NOT_APPLICABLE');
});

// Contract RC25Y-00088 (TP Southern Odisha, 1C x 150 AL XLPE): sheet shows PV VALUE 11,015 and % change in conductor 10.53%.
const series: IndexSeries = {
  AL: [{ date: '2024-12-01', value: 252941 }, { date: '2025-10-01', value: 279579 }],
  PVC: [{ date: '2024-12-01', value: 159825 }, { date: '2025-10-01', value: 156825 }],
  XLPE_LV: [{ date: '2024-12-01', value: 147843 }, { date: '2025-10-01', value: 158844 }],
};
const comps = [{ name: 'AlF', factor: 0.425, indexKey: 'AL' as const }, { name: 'CCF', factor: 0.388, indexKey: 'PVC' as const }, { name: 'XLF', factor: 0.078, indexKey: 'XLPE_LV' as const }];
test('PV value reproduces the live sheet row RC25Y-00088 (11,015/km)', () => {
  const o = pvValue({ components: comps, series, baseSpec: { kind: 'MONTHLY', month: '2024-12-01' }, applicableSpec: indexSpecFor('PMA-IE@PREVIOUS MONTH AVG - IEEMA', '2025-11-19') });
  assert.equal(o.pv, 11015); assert.equal(o.status, 'BASE PRICE PENDING');          // sheet also shows "BASE PRICE PENDING" in % PV
  assert.equal((pctChangeInConductor(252941, 279579) * 100).toFixed(2), '10.53');
});
test('ceiling: capped at 20% of base price; missing index flagged', () => {
  const base = { components: comps, series, baseSpec: { kind: 'MONTHLY', month: '2024-12-01' } as const, applicableSpec: { kind: 'MONTHLY', month: '2025-10-01' } as const };
  const o = pvValue({ ...base, basePrice: 40000 });
  assert.equal(o.status, 'CEILING APPLIED'); assert.equal(o.pvCapped, 8000);
  const ok = pvValue({ ...base, basePrice: 100000 }); assert.equal(ok.status, 'OK'); assert.ok(Math.abs(ok.pctPv! - 0.11015) < 1e-9);
  const none = pvValue({ ...base, baseSpec: { kind: 'MONTHLY', month: '2000-01-01' } }); assert.equal(none.status, 'INDEX MISSING'); assert.equal(none.pv, null);
});
test('provisional index: used for main metals (AL) only; other RMs fall back to last circular', () => {
  const s = [{ date: '2025-10-01', value: 100 }, { date: '2025-11-01', value: 110, provisional: true }];
  assert.equal(lookupIndex(s, { kind: 'MONTHLY', month: '2025-11-01' }, 'AL').value, 110);
  assert.equal(lookupIndex(s, { kind: 'MONTHLY', month: '2025-11-01' }, 'AL').provisional, true);
  assert.equal(lookupIndex(s, { kind: 'MONTHLY', month: '2025-11-01' }, 'PVC').value, 100);
  const avg = lookupIndex([{ date: '2025-10-03', value: 10 }, { date: '2025-10-20', value: 20 }], { kind: 'MONTH_AVG', month: '2025-10-01' });
  assert.equal(avg.value, 15);
});
test('offer now vs wait, mirrors the sheet recommendation texts', () => {
  assert.match(offerAdvice({ today: '2025-11-10', lastDate: '2025-12-31', pvThisMonth: 1000, pvNextMonthProvisional: 1500, qty: 2 }).recommendation, /^WAIT: \+500/);
  assert.equal(offerAdvice({ today: '2025-11-10', lastDate: '2025-12-31', pvThisMonth: 1000, pvNextMonthProvisional: 1500, qty: 2 }).lotGain, 1000);
  assert.match(offerAdvice({ today: '2025-11-10', lastDate: '2025-11-25', pvThisMonth: 1000, pvNextMonthProvisional: 1500, qty: 2 }).recommendation, /schedule ends before next month/);
  assert.match(offerAdvice({ today: '2026-03-20', lastDate: '2026-03-15', pvThisMonth: 1, pvNextMonthProvisional: null, qty: 8 }).recommendation, /SCHEDULE OVER/);
  assert.match(offerAdvice({ today: '2025-12-05', lastDate: '2025-12-31', pvThisMonth: 11015, pvNextMonthProvisional: 11015, qty: 1, alreadyOfferedOn: '04-Dec-25' }).recommendation, /^ALREADY OFFERED/);
  assert.deepEqual(bestOfferMonth([{ month: '2025-10-01', pv: 9000 }, { month: '2025-11-01', pv: 11015 }], 9000), { month: '2025-11-01', pv: 11015, extra: 2015 });
});
test('PV clause summary flags missing docket data instead of assuming', () => {
  const s = pvClauseSummary({ basis: 'IEEMA', baseDate: null, terms: null, pvDaysCode: null });
  assert.ok(s.some(x => /base date missing/.test(x)));
});
