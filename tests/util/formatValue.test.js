import { test } from 'node:test';
import assert from 'node:assert';
import { formatValue } from '../../src/util/formatValue.js';

test('number field with a static max renders value/max', () => {
  const field = { type: 'number', min: 0, max: 100 };
  assert.strictEqual(formatValue(80, field, {}), '80/100');
});

test('maxFromField (dynamic companion) takes precedence over static max', () => {
  const field = { type: 'number', max: 100, maxFromField: 'maxHp' };
  assert.strictEqual(formatValue(40, field, { maxHp: 50 }), '40/50');
});

test('percent display takes precedence over static max', () => {
  const field = { type: 'number', max: 100, displayAs: 'percent' };
  assert.strictEqual(formatValue(30, field, {}), '30%');
});

test('number field without a max renders the bare value', () => {
  const field = { type: 'number' };
  assert.strictEqual(formatValue(7, field, {}), '7');
});
