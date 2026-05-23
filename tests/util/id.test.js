import { test } from 'node:test';
import assert from 'node:assert';
import { newId, ensureTrackerMsgId } from '../../src/util/id.js';

test('newId returns a v4-ish uuid string', () => {
  const a = newId();
  const b = newId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notStrictEqual(a, b);
});

test('ensureTrackerMsgId assigns to message.extra.trackerMsgId once', () => {
  const msg = {};
  const id1 = ensureTrackerMsgId(msg);
  assert.ok(id1);
  assert.strictEqual(msg.extra.trackerMsgId, id1);
  const id2 = ensureTrackerMsgId(msg);
  assert.strictEqual(id2, id1);
});

test('ensureTrackerMsgId tolerates missing extra', () => {
  const msg = { mes: 'hi' };
  const id = ensureTrackerMsgId(msg);
  assert.ok(id);
  assert.strictEqual(msg.extra.trackerMsgId, id);
});
