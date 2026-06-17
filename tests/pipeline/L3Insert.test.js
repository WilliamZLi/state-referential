import { test } from 'node:test';
import assert from 'node:assert';
import { spliceSyntheticMessage, buildSyntheticMessage, spliceAtIndex } from '../../src/pipeline/L3Insert.js';
import { readTrackerMsgId } from '../../src/util/id.js';

// Builds a minimal ST-shaped chat array. Tracker ids live at the message TOP
// LEVEL (state_referential_msgId), mirroring src/util/id.js — NOT in extra.
function mkChat() {
  return [
    { state_referential_msgId: 'm-1', is_user: true, mes: 'User opens the door.', extra: {} },
    { state_referential_msgId: 'm-2', is_user: false, mes: 'A draft of cold air.', extra: {} },
    { state_referential_msgId: 'm-3', is_user: false, mes: 'The hall stretches on.', extra: {} },
  ];
}

test('inserts a synthetic message immediately after the target message', () => {
  const chat = mkChat();
  const { index } = spliceSyntheticMessage(chat, {
    afterTrackerMsgId: 'm-1', kind: 'fold-back', name: 'Folded', mes: 'Summary.',
  });

  assert.equal(index, 1, 'insert position is target index + 1');
  assert.equal(chat.length, 4);
  assert.equal(chat[1].mes, 'Summary.', 'synthetic message lands at index 1');
  assert.equal(readTrackerMsgId(chat[0]), 'm-1', 'target unchanged at index 0');
  assert.equal(readTrackerMsgId(chat[2]), 'm-2', 'former index-1 message shifted to index 2');
});

test('assigns a stable top-level tracker id to the synthetic message', () => {
  const chat = mkChat();
  const { message } = spliceSyntheticMessage(chat, {
    afterTrackerMsgId: 'm-1', kind: 'fold-back', mes: 'x', id: 'l3-fixed',
  });
  // Must be readable via the canonical reader, and live at top level (swipe-stable),
  // NOT in extra (which ST replaces per swipe).
  assert.equal(readTrackerMsgId(message), 'l3-fixed');
  assert.equal(message.state_referential_msgId, 'l3-fixed');
  assert.equal(message.extra?.trackerMsgId, undefined, 'id must NOT be stashed in swipe-volatile extra');
});

test('auto-generates a tracker id when none is supplied', () => {
  const chat = mkChat();
  const { message } = spliceSyntheticMessage(chat, { afterTrackerMsgId: 'm-1', kind: 'compaction', mes: 'x' });
  assert.ok(readTrackerMsgId(message), 'a non-empty id is assigned at insertion time');
});

test("marks the synthetic message so Layer 1's auto-update skip-gate excludes it", () => {
  const chat = mkChat();
  const { message } = spliceSyntheticMessage(chat, { afterTrackerMsgId: 'm-2', kind: 'compaction', mes: 'x' });
  // The real gate in Versioning.js:34 / index.js:125 is exactly this:
  assert.equal(message.extra.from === 'state-referential', true);
});

test('stamps l3Kind and small-system flags', () => {
  const chat = mkChat();
  const { message } = spliceSyntheticMessage(chat, { afterTrackerMsgId: 'm-2', kind: 'act-complete', name: 'Act I', mes: 'x' });
  assert.equal(message.extra.l3Kind, 'act-complete');
  assert.equal(message.extra.isSmallSys, true);
  assert.equal(message.is_user, false);
  assert.equal(message.is_system, false, 'kept in AI history per spec §3.3; collapsed via CSS, not is_system');
  assert.equal(message.name, 'Act I');
});

test('inserting after the last message appends to the end', () => {
  const chat = mkChat();
  const { index } = spliceSyntheticMessage(chat, { afterTrackerMsgId: 'm-3', kind: 'compaction', mes: 'x' });
  assert.equal(index, 3);
  assert.equal(chat.length, 4);
  assert.equal(chat[3].mes, 'x');
});

test('does not mutate other messages tracker ids', () => {
  const chat = mkChat();
  spliceSyntheticMessage(chat, { afterTrackerMsgId: 'm-1', kind: 'fold-back', mes: 'x' });
  assert.deepEqual(
    chat.filter(m => m.mes !== 'x').map(readTrackerMsgId),
    ['m-1', 'm-2', 'm-3'],
  );
});

test('throws on an unknown afterTrackerMsgId (drift: branch-from message was deleted)', () => {
  const chat = mkChat();
  assert.throws(
    () => spliceSyntheticMessage(chat, { afterTrackerMsgId: 'gone', kind: 'fold-back', mes: 'x' }),
    /unknown afterTrackerMsgId/,
  );
  assert.equal(chat.length, 3, 'chat is left untouched when the target is missing');
});

test('buildSyntheticMessage stamps id, skip-gate, kind and small-sys flags', () => {
  const m = buildSyntheticMessage({ kind: 'compaction', mes: 'sum', name: 'Compacted', id: 'fixed' });
  assert.equal(readTrackerMsgId(m), 'fixed');
  assert.equal(m.state_referential_msgId, 'fixed');
  assert.equal(m.extra.from, 'state-referential');
  assert.equal(m.extra.l3Kind, 'compaction');
  assert.equal(m.extra.isSmallSys, true);
  assert.equal(m.is_user, false);
  assert.equal(m.is_system, false);
  assert.equal(m.name, 'Compacted');
});

test('buildSyntheticMessage merges extra and auto-generates an id', () => {
  const m = buildSyntheticMessage({ kind: 'compaction', mes: 'x', extra: { l3ArchiveId: 'a1' } });
  assert.ok(readTrackerMsgId(m));
  assert.equal(m.extra.l3ArchiveId, 'a1');
});

test('spliceAtIndex inserts at the head of the chat (index 0)', () => {
  const chat = [{ state_referential_msgId: 'm-1', mes: 'a', extra: {} }];
  const msg = buildSyntheticMessage({ kind: 'compaction', mes: 'head', id: 'h' });
  const i = spliceAtIndex(chat, 0, msg);
  assert.equal(i, 0);
  assert.equal(chat[0].mes, 'head');
  assert.equal(chat[1].mes, 'a');
});
