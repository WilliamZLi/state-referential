import { test } from 'node:test';
import assert from 'node:assert';
import { matchEntries } from '../../src/util/matchEntries.js';

test('keeps entries whose sub-field is in the allowed set', () => {
  const e = [{ name: 'a', status: 'open' }, { name: 'b', status: 'fulfilled' }];
  assert.deepEqual(matchEntries(e, { status: ['open'] }).map(x => x.name), ['a']);
});
test('no where → unchanged', () => {
  const e = [{ name: 'a' }];
  assert.equal(matchEntries(e, undefined), e);
});
