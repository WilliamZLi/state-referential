import { test } from 'node:test';
import assert from 'node:assert';
import { ensureTrackerMsgId, readTrackerMsgId } from '../../src/util/id.js';

// msgId now lives at the message TOP LEVEL (not inside `extra`) because ST
// replaces `msg.extra` per swipe via swipe_info[]; a top-level property is
// preserved across swipes so the same snapshot can be loaded on every variant.

test('ensureTrackerMsgId writes state_referential_msgId at top level on fresh message', () => {
  const msg = {};
  const id = ensureTrackerMsgId(msg);
  assert.ok(id, 'should return an id');
  assert.strictEqual(msg.state_referential_msgId, id);
});

test('ensureTrackerMsgId is idempotent — does not change existing top-level id', () => {
  const msg = { state_referential_msgId: 'existing-id' };
  const id = ensureTrackerMsgId(msg);
  assert.strictEqual(id, 'existing-id');
  assert.strictEqual(msg.state_referential_msgId, 'existing-id');
});

test('ensureTrackerMsgId migrates legacy extra.state_referential_msgId to top-level', () => {
  const msg = { extra: { state_referential_msgId: 'old-extra-id' } };
  const id = ensureTrackerMsgId(msg);
  assert.strictEqual(id, 'old-extra-id', 'should reuse legacy id');
  assert.strictEqual(msg.state_referential_msgId, 'old-extra-id', 'should hoist to top-level');
});

test('ensureTrackerMsgId migrates legacy extra.trackerMsgId to top-level', () => {
  const msg = { extra: { trackerMsgId: 'older-id' } };
  const id = ensureTrackerMsgId(msg);
  assert.strictEqual(id, 'older-id', 'should reuse legacy id');
  assert.strictEqual(msg.state_referential_msgId, 'older-id', 'should hoist to top-level');
});

test('readTrackerMsgId reads top-level state_referential_msgId', () => {
  const msg = { state_referential_msgId: 'new-id' };
  assert.strictEqual(readTrackerMsgId(msg), 'new-id');
});

test('readTrackerMsgId falls back to legacy extra.state_referential_msgId', () => {
  const msg = { extra: { state_referential_msgId: 'extra-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'extra-id');
});

test('readTrackerMsgId falls back to legacy extra.trackerMsgId', () => {
  const msg = { extra: { trackerMsgId: 'old-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'old-id');
});

test('readTrackerMsgId returns null for message with no id', () => {
  assert.strictEqual(readTrackerMsgId({}), null);
  assert.strictEqual(readTrackerMsgId(null), null);
  assert.strictEqual(readTrackerMsgId(undefined), null);
});

test('readTrackerMsgId prefers top-level over legacy keys', () => {
  const msg = { state_referential_msgId: 'top-id', extra: { state_referential_msgId: 'extra-id', trackerMsgId: 'old-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'top-id');
});

test('top-level msgId survives extra-object replacement (swipe simulation)', () => {
  // First swipe: ST stores extra in swipe_info[0]
  const msg = { extra: { someStInternal: 'a' } };
  const originalId = ensureTrackerMsgId(msg);
  // User swipes right → ST replaces msg.extra with swipe_info[1] (fresh blank)
  msg.extra = { someStInternal: 'b' };
  // readTrackerMsgId must still return the original id from the top-level property
  assert.strictEqual(readTrackerMsgId(msg), originalId, 'top-level id must survive extra replacement');
});
