import { test } from 'node:test';
import assert from 'node:assert';
import { makeSessionId } from '../../src/pipeline/WorldLock.js';

function mockStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('makeSessionId persists across calls (a reload reuses the same id)', () => {
  const store = mockStorage();
  const a = makeSessionId(store);
  const b = makeSessionId(store);
  assert.equal(a, b, 'second call (reload) returns the stored id, not a new one');
  assert.ok(a && typeof a === 'string' && a.length > 0);
});

test('makeSessionId mints distinct ids when no storage is available (fallback)', () => {
  const a = makeSessionId(null);
  const b = makeSessionId(null);
  assert.notEqual(a, b, 'without storage there is no persistence, so ids differ');
});

test('makeSessionId tolerates a throwing storage (private mode) and still returns an id', () => {
  const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const id = makeSessionId(boom);
  assert.ok(id && typeof id === 'string' && id.length > 0);
});
