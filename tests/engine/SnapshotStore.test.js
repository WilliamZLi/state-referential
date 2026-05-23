// state-referential/tests/engine/SnapshotStore.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { SnapshotStore } from '../../src/engine/SnapshotStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

const blob = (n) => ({ subjects: { protagonistId: null, subjects: [] }, values: { [n]: 1 }, descriptions: {}, sceneTags: [] });

test('save+load+list', () => {
  const s = new SnapshotStore(new InMemoryBackend(), { cap: 3 });
  s.save('m1', blob(1));
  s.save('m2', blob(2));
  assert.strictEqual(s.load('m1').values[1], 1);
  assert.deepStrictEqual(s.list().map(x=>x.msgId).sort(), ['m1','m2']);
});

test('cap drops oldest non-pinned', () => {
  const s = new SnapshotStore(new InMemoryBackend(), { cap: 2 });
  s.save('m1', blob(1));
  s.save('m2', blob(2));
  s.save('m3', blob(3));
  assert.deepStrictEqual(s.list().map(x=>x.msgId).sort(), ['m2','m3']);
});

test('pin survives cap', () => {
  const s = new SnapshotStore(new InMemoryBackend(), { cap: 2 });
  s.save('m1', blob(1)); s.pin('m1', 'branch-start');
  s.save('m2', blob(2)); s.save('m3', blob(3)); s.save('m4', blob(4));
  assert.ok(s.list().map(x=>x.msgId).includes('m1'));
});

test('unpin allows eviction', () => {
  const s = new SnapshotStore(new InMemoryBackend(), { cap: 2 });
  s.save('m1', blob(1)); s.pin('m1', 'user');
  s.save('m2', blob(2)); s.save('m3', blob(3));
  s.unpin('m1');
  s.save('m4', blob(4));
  assert.deepStrictEqual(s.list().map(x=>x.msgId).sort(), ['m3','m4']);
});

test('dropSnapshots respects pins', () => {
  const s = new SnapshotStore(new InMemoryBackend(), { cap: 10 });
  s.save('m1', blob(1)); s.save('m2', blob(2)); s.save('m3', blob(3));
  s.pin('m2', 'user');
  s.dropSnapshots(['m1','m2','m3']);
  assert.deepStrictEqual(s.list().map(x=>x.msgId), ['m2']);
});

test('round-trip via backend', () => {
  const b = new InMemoryBackend();
  const s = new SnapshotStore(b, { cap: 5 });
  s.save('m1', blob(1)); s.pin('m1', 'user');
  const s2 = new SnapshotStore(b, { cap: 5 });
  assert.strictEqual(s2.load('m1').values[1], 1);
  assert.strictEqual(s2.list().find(x=>x.msgId==='m1').pinned, true);
});
