import { test } from 'node:test';
import assert from 'node:assert';
import { SceneTagStore } from '../../src/engine/SceneTagStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkBus() { const e=[]; return { events:e, emit:(n,p)=>e.push([n,p]), on(){}, off(){} }; }

test('set/toggle/list/isActive', () => {
  const bus = mkBus();
  const t = new SceneTagStore(new InMemoryBackend(), bus);
  t.set('intimate', true);
  assert.deepStrictEqual(t.list(), ['intimate']);
  t.toggle('combat');
  assert.deepStrictEqual(t.list().sort(), ['combat','intimate']);
  t.set('intimate', false);
  assert.deepStrictEqual(t.list(), ['combat']);
  assert.strictEqual(t.isActive('combat'), true);
  assert.strictEqual(t.anyActive(['social','combat']), true);
  assert.strictEqual(bus.events.filter(e => e[0] === 'tracker:tag-changed').length, 3);
});

test('idempotent set does not emit', () => {
  const bus = mkBus();
  const t = new SceneTagStore(new InMemoryBackend(), bus);
  t.set('x', false);
  assert.strictEqual(bus.events.length, 0);
  t.set('x', true);
  t.set('x', true);
  assert.strictEqual(bus.events.length, 1);
});
