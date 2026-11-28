import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { certificateCandidates, certificatePath } from './typeTestFiles.ts';

test('ledger hyperlinks -> paths relative to the ledger folder; only that folder and its parent can be read', () => {
  assert.deepEqual(certificateCandidates('../Conductors/AAAC/AAAC%20Dog/A%20%20B.pdf'), ['Conductors/AAAC/AAAC Dog/A  B.pdf', '../Conductors/AAAC/AAAC Dog/A  B.pdf']);
  assert.deepEqual(certificateCandidates('..\\Conductors\\X.PDF'), ['Conductors/X.PDF', '../Conductors/X.PDF']);
  assert.deepEqual(certificateCandidates('..\\..\\Conductors\\X.PDF'), ['Conductors/X.PDF', '../Conductors/X.PDF']);
  assert.deepEqual(certificateCandidates('Cables\\LT%20%20PVC\\16.pdf'), ['Cables/LT  PVC/16.pdf']);
  assert.deepEqual(certificateCandidates('Cables/100% Cu.pdf'), ['Cables/100% Cu.pdf']);   // a bad % escape is kept as written
  for (const t of ['', 'https://example.com/a.pdf', 'file:///C:/a.pdf', 'C:\\a.pdf', '\\\\server\\share\\a.pdf', '/etc/passwd']) assert.deepEqual(certificateCandidates(t), [], t);

  const root = path.resolve('share', 'MD Work', 'Updated TTR');
  assert.equal(certificatePath(root, 'Cables/a.pdf'), path.join(root, 'Cables', 'a.pdf'));
  assert.equal(certificatePath(root, 'Cables\\a.pdf'), path.join(root, 'Cables', 'a.pdf'));
  assert.equal(certificatePath(root, '../Conductors/a.pdf'), path.resolve('share', 'MD Work', 'Conductors', 'a.pdf'));
  assert.equal(certificatePath(root, '../../outside.pdf'), null);
  assert.equal(certificatePath(root, 'Cables/../../../outside.pdf'), null);
  assert.equal(certificatePath(root, '..'), null);
});
