import { test } from 'node:test';
import assert from 'node:assert';
import { ensureTrackerMsgId, readTrackerMsgId } from '../../src/util/id.js';

test('ensureTrackerMsgId writes state_referential_msgId on fresh message', () => {
  const msg = {};
  const id = ensureTrackerMsgId(msg);
  assert.ok(id, 'should return an id');
  assert.strictEqual(msg.extra.state_referential_msgId, id);
});

test('ensureTrackerMsgId is idempotent — does not change existing state_referential_msgId', () => {
  const msg = { extra: { state_referential_msgId: 'existing-id' } };
  const id = ensureTrackerMsgId(msg);
  assert.strictEqual(id, 'existing-id');
  assert.strictEqual(msg.extra.state_referential_msgId, 'existing-id');
});

test('ensureTrackerMsgId migrates legacy trackerMsgId to new key', () => {
  const msg = { extra: { trackerMsgId: 'legacy-id' } };
  const id = ensureTrackerMsgId(msg);
  assert.strictEqual(id, 'legacy-id', 'should reuse legacy id');
  assert.strictEqual(msg.extra.state_referential_msgId, 'legacy-id', 'should promote to new key');
});

test('readTrackerMsgId reads state_referential_msgId', () => {
  const msg = { extra: { state_referential_msgId: 'new-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'new-id');
});

test('readTrackerMsgId falls back to legacy trackerMsgId', () => {
  const msg = { extra: { trackerMsgId: 'old-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'old-id');
});

test('readTrackerMsgId returns null for message with no id', () => {
  assert.strictEqual(readTrackerMsgId({}), null);
  assert.strictEqual(readTrackerMsgId(null), null);
  assert.strictEqual(readTrackerMsgId(undefined), null);
});

test('readTrackerMsgId prefers state_referential_msgId over legacy key', () => {
  const msg = { extra: { state_referential_msgId: 'new-id', trackerMsgId: 'old-id' } };
  assert.strictEqual(readTrackerMsgId(msg), 'new-id');
});
