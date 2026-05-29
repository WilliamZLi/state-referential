// tests/engine/WorldRegistry.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { WorldRegistry } from '../../src/engine/WorldRegistry.js';

function mkServerApi(initial = []) {
  const worlds = new Map(initial.map(w => [w.id, { ...w }]));
  let nextId = 1;
  return {
    listWorlds: async () => [...worlds.values()],
    createWorld: async (meta) => { worlds.set(meta.id, { ...meta }); return worlds.get(meta.id); },
    getWorld: async (id) => worlds.get(id) ?? null,
    patchMeta: async (id, patch) => { const w = worlds.get(id); if (w) worlds.set(id, { ...w, ...patch }); },
    deleteWorld: async (id) => { worlds.delete(id); },
    getResource: async (id, key) => null,
    putResource: async (id, key, data) => {},
    getChronicle: async (id) => null,
    putChronicle: async (id, data) => {},
    _worlds: worlds,
  };
}

test('init loads worlds from server', async () => {
  const api = mkServerApi([
    { id: 'w1', name: 'Eldoria', createdAt: 1000, narratorCardHint: null, mainlineChatId: null,
      openBranchChatId: null, subjects: { subjects: [], protagonistId: null }, sceneTags: [],
      chronicleConfig: { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 }, lockedBy: null },
  ]);
  const reg = new WorldRegistry(api);
  await reg.init();
  assert.strictEqual(reg.list().length, 1);
  assert.strictEqual(reg.get('w1').name, 'Eldoria');
});

test('create assigns uuid, stores, returns meta', async () => {
  const api = mkServerApi();
  const reg = new WorldRegistry(api);
  await reg.init();
  const w = await reg.create({ name: 'Mars Colony', narratorCardHint: null });
  assert.ok(w.id, 'id assigned');
  assert.strictEqual(w.name, 'Mars Colony');
  assert.ok(w.createdAt, 'createdAt set');
  assert.strictEqual(reg.list().length, 1);
  // server received it
  assert.ok(api._worlds.has(w.id));
});

test('update patches name / config in memory and on server', async () => {
  const api = mkServerApi([{ id: 'w1', name: 'Old', createdAt: 1000, narratorCardHint: null,
    mainlineChatId: null, openBranchChatId: null, subjects: { subjects: [], protagonistId: null },
    sceneTags: [], chronicleConfig: { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 }, lockedBy: null }]);
  const reg = new WorldRegistry(api);
  await reg.init();
  await reg.update('w1', { name: 'New Name' });
  assert.strictEqual(reg.get('w1').name, 'New Name');
});

test('delete removes from memory and server', async () => {
  const api = mkServerApi([{ id: 'w1', name: 'X', createdAt: 1000, narratorCardHint: null,
    mainlineChatId: null, openBranchChatId: null, subjects: { subjects: [], protagonistId: null },
    sceneTags: [], chronicleConfig: { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 }, lockedBy: null }]);
  const reg = new WorldRegistry(api);
  await reg.init();
  await reg.delete('w1');
  assert.strictEqual(reg.list().length, 0);
  assert.ok(!api._worlds.has('w1'));
});

test('setMainlineChatId updates mainlineChatId on server', async () => {
  const api = mkServerApi([{ id: 'w1', name: 'X', createdAt: 1000, narratorCardHint: null,
    mainlineChatId: null, openBranchChatId: null, subjects: { subjects: [], protagonistId: null },
    sceneTags: [], chronicleConfig: { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 }, lockedBy: null }]);
  const reg = new WorldRegistry(api);
  await reg.init();
  await reg.setMainlineChatId('w1', 'chat-abc');
  assert.strictEqual(reg.get('w1').mainlineChatId, 'chat-abc');
  assert.strictEqual(api._worlds.get('w1').mainlineChatId, 'chat-abc');
});
