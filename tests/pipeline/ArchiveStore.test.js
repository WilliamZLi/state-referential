import { test } from 'node:test';
import assert from 'node:assert';
import { saveArchive, getArchive, listArchives } from '../../src/pipeline/ArchiveStore.js';

// Archives live in chat_metadata (the persisted `meta` object), NOT on the chat
// array — a property tacked onto the array (chat.extra) is dropped when ST
// serializes the chat, which would silently lose every compacted message.
const mkChat = () => [
  { state_referential_msgId: 'a', mes: 'a', extra: {} },
  { state_referential_msgId: 'b', mes: 'b', extra: {} },
];

test('saveArchive stores a slice in meta keyed by a generated id and returns it', () => {
  const meta = {};
  const chat = mkChat();
  const id = saveArchive(meta, chat, { startIndex: 0, endIndex: 1 }, { genId: () => 'arch-1', now: 1700 });
  assert.equal(id, 'arch-1');
  const a = getArchive(meta, 'arch-1');
  assert.equal(a.messages.length, 2);
  assert.equal(a.messages[0].mes, 'a');
  assert.equal(a.fromMessageId, 'a');
  assert.equal(a.toMessageId, 'b');
  assert.equal(a.compactedAt, 1700);
});

test('archives are written to the meta object, not the chat array', () => {
  const meta = {};
  const chat = mkChat();
  saveArchive(meta, chat, { startIndex: 0, endIndex: 0 }, { genId: () => 'arch-1', now: 0 });
  assert.ok(meta.l3Archives['arch-1'], 'archive lives on meta (chat_metadata)');
  assert.equal(chat.extra, undefined, 'nothing is written to the chat array');
});

test('archived messages are deep copies, not live references', () => {
  const meta = {};
  const chat = mkChat();
  saveArchive(meta, chat, { startIndex: 0, endIndex: 0 }, { genId: () => 'arch-1', now: 0 });
  chat[0].mes = 'MUTATED';
  assert.equal(getArchive(meta, 'arch-1').messages[0].mes, 'a');
});

test('listArchives returns ids', () => {
  const meta = {};
  const chat = mkChat();
  saveArchive(meta, chat, { startIndex: 0, endIndex: 0 }, { genId: () => 'x', now: 0 });
  saveArchive(meta, chat, { startIndex: 1, endIndex: 1 }, { genId: () => 'y', now: 0 });
  assert.deepEqual(listArchives(meta).sort(), ['x', 'y']);
});
