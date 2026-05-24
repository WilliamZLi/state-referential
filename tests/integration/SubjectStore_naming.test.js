import { test } from 'node:test';
import assert from 'node:assert';
import { SubjectStore } from '../../src/engine/SubjectStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkBus() {
  return { emit() {}, on() {}, off() {} };
}

test('SubjectStore.add rejects name containing "{"', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  assert.throws(() => s.add('{{evil}}', { role: 'npc' }), /forbidden/i);
});

test('SubjectStore.add rejects name containing "."', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  assert.throws(() => s.add('a.b', { role: 'npc' }), /forbidden/i);
});

test('SubjectStore.add rejects name containing "|"', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  assert.throws(() => s.add('a|b', { role: 'npc' }), /forbidden/i);
});

test('SubjectStore.rename rejects new name containing "{"', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  s.add('Hero', { role: 'protagonist' });
  assert.throws(() => s.rename('Hero', '{{Hero}}'), /forbidden/i);
});

test('SubjectStore.add allows normal names without forbidden chars', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  const subj = s.add('Hero Prime', { role: 'protagonist' });
  assert.ok(subj.id);
  assert.strictEqual(subj.name, 'Hero Prime');
});
