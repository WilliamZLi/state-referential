import { test } from 'node:test';
import assert from 'node:assert';
import { computeCompactionRange } from '../../src/pipeline/CompactionRange.js';

const msg = (id) => ({ state_referential_msgId: id, mes: id, extra: {} });
const marker = (id) => ({ state_referential_msgId: id, mes: id, extra: { from: 'state-referential', l3Kind: 'compaction' } });
const anchored = (id) => ({ state_referential_msgId: id, mes: id, extra: {}, l3Anchor: { anchoredAt: 1 } });

const opts = (over = {}) => ({ recentWindow: 2, minSize: 2, ...over });

test('returns null for an empty chat', () => {
  assert.equal(computeCompactionRange([], opts()), null);
});

test('returns null when everything is inside the protected recent window', () => {
  const chat = [msg('a'), msg('b')];
  assert.equal(computeCompactionRange(chat, opts()), null);
});

test('compacts the oldest contiguous run, leaving the recent window', () => {
  const chat = [msg('a'), msg('b'), msg('c'), msg('d')];
  const r = computeCompactionRange(chat, opts());
  assert.deepEqual(r, { startIndex: 0, endIndex: 1, msgIds: ['a', 'b'] });
});

test('stops the run at an anchored message', () => {
  const chat = [msg('a'), anchored('b'), msg('c'), msg('d'), msg('e')];
  const r = computeCompactionRange(chat, opts());
  assert.equal(r, null);
});

test('skips leading synthetic markers to start at the first compactable message', () => {
  const chat = [marker('m0'), msg('a'), msg('b'), msg('c'), msg('d')];
  const r = computeCompactionRange(chat, opts());
  assert.deepEqual(r, { startIndex: 1, endIndex: 2, msgIds: ['a', 'b'] });
});

test('a marker inside the run ends the run', () => {
  const chat = [msg('a'), msg('b'), marker('m'), msg('c'), msg('d'), msg('e')];
  const r = computeCompactionRange(chat, opts());
  assert.deepEqual(r, { startIndex: 0, endIndex: 1, msgIds: ['a', 'b'] });
});

test('returns null when the run is shorter than minSize', () => {
  const chat = [msg('a'), msg('b'), msg('c')];
  assert.equal(computeCompactionRange(chat, opts()), null);
});

test('maxCount caps the run length', () => {
  const chat = [msg('a'), msg('b'), msg('c'), msg('d'), msg('e'), msg('f')];
  const r = computeCompactionRange(chat, opts({ maxCount: 2 }));
  assert.deepEqual(r, { startIndex: 0, endIndex: 1, msgIds: ['a', 'b'] });
});

test('a null chat is treated like an empty chat (null)', () => {
  assert.equal(computeCompactionRange(null, opts()), null);
});

test('maxCount below minSize yields null (minSize always wins)', () => {
  const chat = [msg('a'), msg('b'), msg('c'), msg('d')];
  assert.equal(computeCompactionRange(chat, opts({ maxCount: 1 })), null);
});

test('a valid run before an anchor returns that run', () => {
  const chat = [msg('a'), msg('b'), msg('c'), anchored('x'), msg('d'), msg('e'), msg('f')];
  const r = computeCompactionRange(chat, opts());
  assert.deepEqual(r, { startIndex: 0, endIndex: 2, msgIds: ['a', 'b', 'c'] });
});
