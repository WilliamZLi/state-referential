import { test } from 'node:test';
import assert from 'node:assert';
import { SubjectStore } from '../../src/engine/SubjectStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkBus() {
  const events = [];
  return { events, emit: (n, p) => events.push([n, p]), on() {}, off() {} };
}

test('add subject, find by name, list', () => {
  const bus = mkBus();
  const s = new SubjectStore(new InMemoryBackend(), bus);
  const lyra = s.add('Lyra', { role: 'protagonist', createdBy: 'user', createdAtMsg: 'tm-1' });
  assert.strictEqual(lyra.role, 'protagonist');
  assert.strictEqual(s.findByName('Lyra').id, lyra.id);
  assert.strictEqual(s.list().length, 1);
  assert.strictEqual(bus.events[0][0], 'tracker:subject-added');
});

test('setProtagonist enforces single protagonist invariant', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  const a = s.add('A', { role: 'protagonist' });
  const b = s.add('B', { role: 'npc' });
  s.setProtagonist(b.id);
  assert.strictEqual(s.get(a.id).role, 'npc');
  assert.strictEqual(s.get(b.id).role, 'protagonist');
  assert.strictEqual(s.protagonistId(), b.id);
});

test('rename keeps id, updates name, emits', () => {
  const bus = mkBus();
  const s = new SubjectStore(new InMemoryBackend(), bus);
  const a = s.add('A', { role: 'npc' });
  s.rename('A', 'A-Prime');
  assert.strictEqual(s.get(a.id).name, 'A-Prime');
  assert.strictEqual(s.findByName('A-Prime').id, a.id);
  assert.ok(bus.events.find(e => e[0] === 'tracker:subject-renamed'));
});

test('remove drops and emits', () => {
  const bus = mkBus();
  const s = new SubjectStore(new InMemoryBackend(), bus);
  s.add('A', { role: 'npc' });
  s.remove('A');
  assert.strictEqual(s.findByName('A'), undefined);
  assert.ok(bus.events.find(e => e[0] === 'tracker:subject-removed'));
});

test('duplicate name throws', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  s.add('A', { role: 'npc' });
  assert.throws(() => s.add('A', { role: 'npc' }), /exists/);
});

test('protagonist alias resolves', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  s.add('Hero', { role: 'protagonist' });
  s.add('Maya', { role: 'npc' });
  assert.strictEqual(s.resolveAlias('protagonist').name, 'Hero');
  assert.strictEqual(s.resolveAlias('char').name, 'Hero');
  assert.strictEqual(s.resolveAlias('Maya').name, 'Maya');
});

test('user and self aliases return null (v1 documented limitation)', () => {
  const s = new SubjectStore(new InMemoryBackend(), mkBus());
  s.add('Hero', { role: 'protagonist' });
  assert.strictEqual(s.resolveAlias('user'), null);
  assert.strictEqual(s.resolveAlias('self'), null);
});
