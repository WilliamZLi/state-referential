import { test } from 'node:test';
import assert from 'node:assert';
import { computeNemoRuns } from '../../src/nemo/range.js';

const TOKENS = {
  u: { is_user: true },
  a: { is_user: false },
  h: { is_system: true },
  p: { l3Anchor: {} },
  m: { extra: { from: 'state-referential' } },
};

function mk(spec) {
  return spec
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ ...structuredClone(TOKENS[t]), mes: '#' + i }));
}

test('keeps the last 12, starting on a user message', () => {
  const r = computeNemoRuns(mk('u a '.repeat(10)), { keepLast: 12 });
  assert.equal(r.keptStart, 8);
  assert.deepStrictEqual(r.runs, [{ startIndex: 0, endIndex: 7, indices: [0, 1, 2, 3, 4, 5, 6, 7] }]);
});

test('keeps one extra when N lands mid-exchange', () => {
  assert.equal(computeNemoRuns(mk('u a '.repeat(10)), { keepLast: 11 }).keptStart, 8);
});

test('swipe safety: the last reply and its user message are always kept', () => {
  const r = computeNemoRuns(mk('u a '.repeat(5)), { keepLast: 1 });
  assert.equal(r.keptStart, 8);
  assert.deepStrictEqual(r.runs[0].indices, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('markers and pins split runs; hidden messages are skipped without splitting', () => {
  const r = computeNemoRuns(mk('m u a h u a p u a u a'), { keepLast: 2 });
  assert.deepStrictEqual(r.runs, [
    { startIndex: 1, endIndex: 5, indices: [1, 2, 4, 5] },
    { startIndex: 7, endIndex: 8, indices: [7, 8] },
  ]);
});

test('runs with fewer than 2 members are dropped; short chats yield nothing', () => {
  assert.deepStrictEqual(computeNemoRuns(mk('u p a u a'), { keepLast: 2 }).runs, []);
  assert.deepStrictEqual(computeNemoRuns(mk('u a'), { keepLast: 12 }).runs, []);
});
