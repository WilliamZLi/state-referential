import { test } from 'node:test';
import assert from 'node:assert';
import { coerceStructInputs } from '../../src/ui/structEntryForm.js';

const SUBS = [
  { id: 'detail', type: 'text' },
  { id: 'amount', type: 'number', min: 0, default: 0 },
  { id: 'status', type: 'enum', options: ['open', 'fulfilled', 'failed'], default: 'open' },
];

test('coerceStructInputs: numbers parsed, enum validated, text stringified', () => {
  const patch = coerceStructInputs(SUBS, { detail: 'owed', amount: '40', status: 'fulfilled' });
  assert.deepEqual(patch, { detail: 'owed', amount: 40, status: 'fulfilled' });
});

test('coerceStructInputs: bad number → default; bad enum → default/first', () => {
  const patch = coerceStructInputs(SUBS, { detail: '', amount: 'xx', status: 'bogus' });
  assert.equal(patch.amount, 0);
  assert.equal(patch.status, 'open');
});

test('coerceStructInputs: only known sub-fields included', () => {
  const patch = coerceStructInputs(SUBS, { amount: '5', junk: 'ignore' });
  assert.equal(patch.junk, undefined);
  assert.equal(patch.amount, 5);
});
