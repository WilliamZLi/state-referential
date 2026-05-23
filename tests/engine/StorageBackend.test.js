import { test } from 'node:test';
import assert from 'node:assert';
import { InMemoryBackend, BACKEND_KEYS } from '../../src/engine/StorageBackend.js';

test('BACKEND_KEYS lists the six load/save pairs', () => {
  assert.deepStrictEqual(BACKEND_KEYS.sort(), [
    'definitions', 'descriptions', 'sceneTags', 'snapshots', 'subjects', 'values',
  ]);
});

test('InMemoryBackend round-trips each key', () => {
  const b = new InMemoryBackend();
  b.saveSubjects({ subjects: [{ id: 'p', name: 'Lyra', role: 'protagonist' }], protagonistId: 'p' });
  b.saveValues({ p: { outfit: { topwear: { v: 'red dress', lastTouchedMsg: null } } } });
  b.saveDescriptions({ global: {}, perSubject: {} });
  b.saveSceneTags(['intimate']);
  b.saveSnapshots({});
  b.saveDefinitions([{ id: 'outfit', label: 'Outfit', fields: [] }]);

  assert.deepStrictEqual(b.loadSubjects().protagonistId, 'p');
  assert.deepStrictEqual(b.loadValues().p.outfit.topwear.v, 'red dress');
  assert.deepStrictEqual(b.loadSceneTags(), ['intimate']);
  assert.deepStrictEqual(b.loadDefinitions()[0].id, 'outfit');
});

test('InMemoryBackend.flush resolves immediately', async () => {
  const b = new InMemoryBackend();
  await b.flush();
});
