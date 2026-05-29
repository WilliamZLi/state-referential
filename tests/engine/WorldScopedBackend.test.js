// tests/engine/WorldScopedBackend.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { WorldScopedBackend } from '../../src/engine/WorldScopedBackend.js';

function mkServerApi() {
  const store = {};
  return {
    listWorlds: async () => [],
    createWorld: async (m) => m,
    getWorld: async (id) => store[id]?.meta ?? null,
    patchMeta: async (id, patch) => {
      store[id] ??= {};
      store[id].meta = { ...(store[id].meta ?? {}), ...patch };
    },
    deleteWorld: async () => {},
    getResource: async (id, key) => store[id]?.[key] ?? null,
    putResource: async (id, key, data) => {
      store[id] ??= {};
      store[id][key] = JSON.parse(JSON.stringify(data));
    },
    getChronicle: async (id) => store[id]?.chronicle ?? null,
    putChronicle: async (id, data) => {
      store[id] ??= {};
      store[id].chronicle = JSON.parse(JSON.stringify(data));
    },
    exportWorld: async () => new Blob(),
    importWorld: async () => ({}),
    _store: store,
  };
}

function mkCtx() {
  const settings = { 'state-referential': { definitions: [] } };
  return {
    getExtensionSettings: () => settings,
    saveSettingsDebounced: () => {},
  };
}

test('round-trips subjects, values, descriptions, sceneTags, snapshots', () => {
  const api = mkServerApi();
  const ctx = mkCtx();
  const b = new WorldScopedBackend('w1', api, {
    subjects: { subjects: [{ id: 'p', name: 'Lyra', role: 'protagonist', traits: {} }], protagonistId: 'p' },
    values: { p: { outfit: { topwear: { v: 'red dress', lastTouchedMsg: null } } } },
    descriptions: { global: {}, perSubject: {} },
    sceneTags: ['intimate'],
    snapshots: {},
  }, ctx);

  assert.strictEqual(b.loadSubjects().protagonistId, 'p');
  assert.strictEqual(b.loadValues().p.outfit.topwear.v, 'red dress');
  assert.deepStrictEqual(b.loadSceneTags(), ['intimate']);
  assert.deepStrictEqual(b.loadSnapshots(), {});
});

test('saveSubjects schedules a patchMeta flush', async () => {
  const api = mkServerApi();
  const ctx = mkCtx();
  const b = new WorldScopedBackend('w1', api, {}, ctx);
  b.saveSubjects({ subjects: [{ id: 'x', name: 'X', role: 'npc', traits: {} }], protagonistId: null });
  await b.flush();
  assert.strictEqual(api._store['w1'].meta.subjects.subjects[0].name, 'X');
});

test('saveValues debounced — flush writes values to server', async () => {
  const api = mkServerApi();
  const ctx = mkCtx();
  const b = new WorldScopedBackend('w1', api, {}, ctx);
  b.saveValues({ p: { stats: { hp: { v: 42, lastTouchedMsg: null } } } });
  await b.flush();
  assert.strictEqual(api._store['w1'].values.p.stats.hp.v, 42);
});

test('saveDescriptions flush writes descriptions to server', async () => {
  const api = mkServerApi();
  const ctx = mkCtx();
  const b = new WorldScopedBackend('w1', api, {}, ctx);
  b.saveDescriptions({ global: { 'outfit.topwear': { 'red dress': 'A fitted crimson dress.' } }, perSubject: {} });
  await b.flush();
  assert.strictEqual(api._store['w1'].descriptions.global['outfit.topwear']['red dress'], 'A fitted crimson dress.');
});

test('invalidate is a no-op (world backend holds authoritative in-memory state)', () => {
  const api = mkServerApi();
  const b = new WorldScopedBackend('w1', api, { sceneTags: ['combat'] }, mkCtx());
  b.invalidate();
  assert.deepStrictEqual(b.loadSceneTags(), ['combat']); // unchanged
});

test('loadDefinitions / saveDefinitions delegates to extension_settings', () => {
  const api = mkServerApi();
  const ctx = mkCtx();
  const b = new WorldScopedBackend('w1', api, {}, ctx);
  assert.deepStrictEqual(b.loadDefinitions(), []);
  b.saveDefinitions([{ id: 'outfit', label: 'Outfit', fields: [] }]);
  assert.strictEqual(b.loadDefinitions()[0].id, 'outfit');
  // also persisted in ctx
  assert.strictEqual(ctx.getExtensionSettings()['state-referential'].definitions[0].id, 'outfit');
});

test('WorldScopedBackend.hydrate constructs from server data', async () => {
  const api = mkServerApi();
  api._store['w1'] = {
    meta: {
      subjects: { subjects: [{ id: 'p', name: 'Hero', role: 'protagonist', traits: {} }], protagonistId: 'p' },
      sceneTags: ['social'],
    },
    values: { p: { stats: { hp: { v: 99, lastTouchedMsg: null } } } },
    descriptions: { global: {}, perSubject: {} },
    snapshots: {},
  };
  const ctx = mkCtx();
  const b = await WorldScopedBackend.hydrate('w1', api, ctx);
  assert.strictEqual(b.loadSubjects().protagonistId, 'p');
  assert.strictEqual(b.loadValues().p.stats.hp.v, 99);
  assert.deepStrictEqual(b.loadSceneTags(), ['social']);
});
