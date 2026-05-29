// tests/engine/ChronicleStore.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ChronicleStore } from '../../src/engine/ChronicleStore.js';

function mkStore(initial = {}) {
  return new ChronicleStore({
    bigPicture: initial.bigPicture ?? '',
    bigPictureCoversThrough: initial.bigPictureCoversThrough ?? null,
    entries: initial.entries ?? [],
    config: {
      verbatimWindow: initial.verbatimWindow ?? 3,
      updateStrategy: initial.updateStrategy ?? 'lazy',
      bigPictureTokenCap: 300,
      entryTokenCap: 200,
      ...(initial.config ?? {}),
    },
  });
}

test('appendEntry adds an entry with an id and returns it', () => {
  const s = mkStore();
  const e = s.appendEntry('Act I', 'Lyra arrived in Brightcairn.', 'tmsg-1');
  assert.ok(e.id, 'entry has id');
  assert.strictEqual(e.title, 'Act I');
  assert.strictEqual(e.body, 'Lyra arrived in Brightcairn.');
  assert.strictEqual(e.createdByMessageId, 'tmsg-1');
  assert.ok(e.createdAt, 'createdAt set');
  assert.strictEqual(s.getEntries().length, 1);
});

test('listVerbatimEntries returns last N per verbatimWindow', () => {
  const s = mkStore({ verbatimWindow: 2 });
  s.appendEntry('A', 'a', null);
  s.appendEntry('B', 'b', null);
  s.appendEntry('C', 'c', null);
  const v = s.listVerbatimEntries();
  assert.strictEqual(v.length, 2);
  assert.strictEqual(v[0].title, 'B');
  assert.strictEqual(v[1].title, 'C');
});

test('needsBigPictureUpdate: true when entries.length > verbatimWindow (lazy)', () => {
  const s = mkStore({ verbatimWindow: 2, updateStrategy: 'lazy' });
  s.appendEntry('A', 'a', null);
  s.appendEntry('B', 'b', null);
  assert.strictEqual(s.needsBigPictureUpdate(), false);
  s.appendEntry('C', 'c', null);
  assert.strictEqual(s.needsBigPictureUpdate(), true);
});

test('needsBigPictureUpdate: always false when strategy is manual', () => {
  const s = mkStore({ verbatimWindow: 1, updateStrategy: 'manual' });
  s.appendEntry('A', 'a', null);
  s.appendEntry('B', 'b', null);
  assert.strictEqual(s.needsBigPictureUpdate(), false);
});

test('getEntriesForFolding returns entries outside verbatimWindow', () => {
  const s = mkStore({ verbatimWindow: 2 });
  s.appendEntry('A', 'a', null);
  s.appendEntry('B', 'b', null);
  s.appendEntry('C', 'c', null);
  const toFold = s.getEntriesForFolding();
  assert.strictEqual(toFold.length, 1);
  assert.strictEqual(toFold[0].title, 'A');
});

test('foldEntries removes entries up to and including the given id', () => {
  const s = mkStore({ verbatimWindow: 2 });
  const a = s.appendEntry('A', 'a', null);
  s.appendEntry('B', 'b', null);
  s.appendEntry('C', 'c', null);
  s.foldEntries(a.id);
  assert.strictEqual(s.getEntries().length, 2);
  assert.strictEqual(s.getEntries()[0].title, 'B');
});

test('setBigPicture + getBigPicture', () => {
  const s = mkStore();
  s.appendEntry('A', 'a', null);
  const id = s.getEntries()[0].id;
  s.setBigPicture('Lyra is now an outlaw.', id);
  assert.strictEqual(s.getBigPicture(), 'Lyra is now an outlaw.');
  assert.strictEqual(s.getBigPictureCoversThrough(), id);
});

test('serialize/hydrate round-trip', () => {
  const s = mkStore();
  const e = s.appendEntry('A', 'hello', 'tmsg-5');
  s.setBigPicture('big pic', e.id);
  const blob = s.serialize();
  const s2 = ChronicleStore.hydrate(blob);
  assert.strictEqual(s2.getEntries()[0].title, 'A');
  assert.strictEqual(s2.getBigPicture(), 'big pic');
});
