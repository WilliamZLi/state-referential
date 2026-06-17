import { test } from 'node:test';
import assert from 'node:assert';
import { isAnchored, setAnchor, toggleAnchor, countAnchors } from '../../src/pipeline/Anchors.js';

test('a fresh message is not anchored', () => {
  assert.equal(isAnchored({ mes: 'x' }), false);
});

test('setAnchor records an anchor with reason and timestamp source', () => {
  const m = { mes: 'x' };
  setAnchor(m, true, 'pivotal beat', 1700000000000);
  assert.equal(isAnchored(m), true);
  assert.equal(m.l3Anchor.reason, 'pivotal beat');
  assert.equal(m.l3Anchor.anchoredAt, 1700000000000);
});

test('setAnchor false clears the anchor', () => {
  const m = { mes: 'x', l3Anchor: { anchoredAt: 1 } };
  setAnchor(m, false);
  assert.equal(isAnchored(m), false);
});

test('toggleAnchor flips and returns the new state', () => {
  const m = { mes: 'x' };
  assert.equal(toggleAnchor(m, 'r', 5), true);
  assert.equal(isAnchored(m), true);
  assert.equal(toggleAnchor(m, 'r', 6), false);
  assert.equal(isAnchored(m), false);
});

test('countAnchors counts anchored messages in a chat', () => {
  const chat = [{ l3Anchor: { anchoredAt: 1 } }, { mes: 'x' }, { l3Anchor: { anchoredAt: 2 } }];
  assert.equal(countAnchors(chat), 2);
});

test('setAnchor without an explicit timestamp falls back to a real time, not epoch 0', () => {
  const m = { mes: 'x' };
  setAnchor(m, true);
  assert.equal(typeof m.l3Anchor.anchoredAt, 'number');
  assert.ok(m.l3Anchor.anchoredAt > 0, 'must not default to epoch 0');
  assert.equal(m.l3Anchor.reason, '');
});

test('isAnchored is safe on a nullish message', () => {
  assert.equal(isAnchored(null), false);
  assert.equal(isAnchored(undefined), false);
});
