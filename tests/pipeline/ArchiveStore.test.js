import { test } from 'node:test';
import assert from 'node:assert';
import { saveArchive, getArchive, listArchives } from '../../src/pipeline/ArchiveStore.js';

function mkChat() {
  return Object.assign(
    [{ state_referential_msgId: 'a', mes: 'a', extra: {} }, { state_referential_msgId: 'b', mes: 'b', extra: {} }],
    { extra: {} },
  );
}

test('saveArchive stores a slice keyed by a generated id and returns it', () => {
  const chat = mkChat();
  const id = saveArchive(chat, { startIndex: 0, endIndex: 1 }, { genId: () => 'arch-1', now: 1700 });
  assert.equal(id, 'arch-1');
  const a = getArchive(chat, 'arch-1');
  assert.equal(a.messages.length, 2);
  assert.equal(a.messages[0].mes, 'a');
  assert.equal(a.fromMessageId, 'a');
  assert.equal(a.toMessageId, 'b');
  assert.equal(a.compactedAt, 1700);
});

test('archived messages are deep copies, not live references', () => {
  const chat = mkChat();
  saveArchive(chat, { startIndex: 0, endIndex: 0 }, { genId: () => 'arch-1', now: 0 });
  chat[0].mes = 'MUTATED';
  assert.equal(getArchive(chat, 'arch-1').messages[0].mes, 'a');
});

test('listArchives returns ids', () => {
  const chat = mkChat();
  saveArchive(chat, { startIndex: 0, endIndex: 0 }, { genId: () => 'x', now: 0 });
  saveArchive(chat, { startIndex: 1, endIndex: 1 }, { genId: () => 'y', now: 0 });
  assert.deepEqual(listArchives(chat).sort(), ['x', 'y']);
});
