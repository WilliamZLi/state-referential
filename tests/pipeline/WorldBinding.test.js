// tests/pipeline/WorldBinding.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { WorldBinding } from '../../src/pipeline/WorldBinding.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkServerApi(worlds = {}) {
  const store = {};
  for (const [id, data] of Object.entries(worlds)) store[id] = { ...data };
  return {
    listWorlds: async () => Object.values(store).map(d => d.meta ?? null).filter(Boolean),
    createWorld: async (m) => { store[m.id] = { meta: m }; return m; },
    getWorld: async (id) => store[id]?.meta ?? null,
    patchMeta: async (id, patch) => {
      store[id] ??= {};
      store[id].meta = { ...(store[id].meta ?? {}), ...patch };
    },
    deleteWorld: async (id) => { delete store[id]; },
    getResource: async (id, key) => store[id]?.[key] ?? null,
    putResource: async (id, key, data) => { store[id] ??= {}; store[id][key] = data; },
    getChronicle: async (id) => store[id]?.chronicle ?? null,
    putChronicle: async () => {},
    exportWorld: async () => new Blob(),
    importWorld: async () => ({}),
  };
}

function mkCtx() {
  const settings = { 'state-referential': { definitions: [] } };
  return { getExtensionSettings: () => settings, saveSettingsDebounced: () => {} };
}

test('unbound chat returns chatScopedBackend', async () => {
  const chatBackend = new InMemoryBackend();
  const binding = new WorldBinding(chatBackend, mkServerApi(), mkCtx());
  const b = await binding.selectBackend({ trackerWorldId: undefined, trackerChatRole: 'unbound' });
  assert.strictEqual(b, chatBackend);
  assert.strictEqual(binding.currentWorldId, null);
});

test('null chatMeta returns chatScopedBackend', async () => {
  const chatBackend = new InMemoryBackend();
  const binding = new WorldBinding(chatBackend, mkServerApi(), mkCtx());
  const b = await binding.selectBackend(null);
  assert.strictEqual(b, chatBackend);
});

test('mainline chat hydrates WorldScopedBackend', async () => {
  const worldId = 'w-abc';
  const api = mkServerApi({
    [worldId]: {
      meta: {
        id: worldId, name: 'Test', createdAt: 1000, narratorCardHint: null,
        mainlineChatId: 'chat-1', openBranchChatId: null,
        subjects: { subjects: [{ id: 'p', name: 'Lyra', role: 'protagonist', traits: {} }], protagonistId: 'p' },
        sceneTags: ['intimate'],
        chronicleConfig: { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
        lockedBy: null,
      },
      values: { p: { stats: { hp: { v: 88, lastTouchedMsg: null } } } },
      descriptions: { global: {}, perSubject: {} },
      snapshots: {},
    },
  });
  const chatBackend = new InMemoryBackend();
  const binding = new WorldBinding(chatBackend, api, mkCtx());
  const b = await binding.selectBackend({ trackerWorldId: worldId, trackerChatRole: 'mainline' });
  assert.notStrictEqual(b, chatBackend, 'should return WorldScopedBackend, not chatBackend');
  assert.strictEqual(binding.currentWorldId, worldId);
  assert.strictEqual(b.loadSubjects().protagonistId, 'p');
  assert.strictEqual(b.loadValues().p.stats.hp.v, 88);
  assert.deepStrictEqual(b.loadSceneTags(), ['intimate']);
});

test('server fetch failure falls back to chatScopedBackend', async () => {
  const failApi = {
    ...mkServerApi(),
    getWorld: async () => { throw new Error('network error'); },
    getResource: async () => { throw new Error('network error'); },
  };
  const chatBackend = new InMemoryBackend();
  const binding = new WorldBinding(chatBackend, failApi, mkCtx());
  const b = await binding.selectBackend({ trackerWorldId: 'w-x', trackerChatRole: 'mainline' });
  assert.strictEqual(b, chatBackend, 'should fall back to chatBackend on error');
  assert.strictEqual(binding.currentWorldId, null);
});
