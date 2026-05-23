import { test } from 'node:test';
import assert from 'node:assert';
import { debounce } from '../../src/util/debounce.js';

test('debounce coalesces rapid calls', async () => {
  let calls = 0;
  const fn = debounce(() => { calls++; }, 20);
  fn(); fn(); fn();
  await new Promise(r => setTimeout(r, 40));
  assert.strictEqual(calls, 1);
});

test('debounce.flush runs immediately and clears pending', async () => {
  let calls = 0;
  const fn = debounce(() => { calls++; }, 50);
  fn();
  fn.flush();
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(calls, 1);
});

test('debounce.cancel prevents pending call', async () => {
  let calls = 0;
  const fn = debounce(() => { calls++; }, 20);
  fn();
  fn.cancel();
  await new Promise(r => setTimeout(r, 40));
  assert.strictEqual(calls, 0);
});
