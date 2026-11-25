import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK, filterRows, columnOptions } from './tableFilter.ts';

const rows = [
  ['ENQ-1', 'ACME', 'KMS'],
  ['ENQ-2', 'acme power', ''],
  ['ENQ-10', 'BETA', 'MTR'],
];

test('filterRows: global search, per-column search, value lists and blanks combine', () => {
  assert.deepEqual(filterRows(rows, '', [], []), [0, 1, 2]);
  assert.deepEqual(filterRows(rows, 'ACME', [], []), [0, 1]);                 // any column, case-insensitive
  assert.deepEqual(filterRows(rows, '', ['', 'power'], []), [1]);
  assert.deepEqual(filterRows(rows, '', [], [[], [], [BLANK, 'MTR']]), [1, 2]);
  assert.deepEqual(filterRows(rows, 'acme', [], [[], [], ['KMS']]), [0]);
  assert.deepEqual(filterRows(rows, '', [], [[], [], ['KMS']], 2), [0, 1, 2]); // the open column ignores its own list
});

test('columnOptions: distinct, numeric-aware sort, blank first', () => {
  assert.deepEqual(columnOptions(rows, [0, 1, 2], 0), ['ENQ-1', 'ENQ-2', 'ENQ-10']);
  assert.deepEqual(columnOptions(rows, [0, 1, 2], 2), [BLANK, 'KMS', 'MTR']);
  assert.deepEqual(columnOptions(rows, [0], 2), ['KMS']);
});
