import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { StandaloneProbe } from '../../src/pipeline/StandaloneProbe.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'mood', label: 'Mood', autoUpdate: false,
    probe: { enabled: true, prompt: 'Describe {{subject}} mood.', trigger: 'on-change', insertAs: 'small-sys-message', exclusive: true, collapsed: true },
    fields: [{ id: 'note', label: 'Note', type: 'text' }] });
  eng.defineTracker({ id: 'log', label: 'Log', autoUpdate: false,
    probe: { enabled: true, prompt: 'Summarize {{subject}} log.', trigger: 'every-turn', insertAs: 'macro-only' },
    fields: [{ id: 'note', label: 'Note', type: 'text' }] });
  return eng;
}

test('on-change probe fires only when a field in that tracker changed', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const inserts = [];
  const proseStore = {};
  const sp = new StandaloneProbe(eng, {
    generateQuietPrompt: async (q) => `probe-result-for: ${q}`,
    insertSmallSysMessage: (opts) => inserts.push(opts),
    proseStore,
  });
  await sp.run({ changedTrackerIds: new Set(['mood']), subject: p });
  assert.strictEqual(inserts.length, 1);
  assert.match(inserts[0].mes, /probe-result-for/);
  assert.strictEqual(inserts[0].extra.exclusive, true);
});

test('on-change probe skipped when tracker not changed', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const inserts = [];
  const sp = new StandaloneProbe(eng, {
    generateQuietPrompt: async () => 'x',
    insertSmallSysMessage: (o) => inserts.push(o),
    proseStore: {},
  });
  await sp.run({ changedTrackerIds: new Set(['otherTracker']), subject: p });
  assert.strictEqual(inserts.length, 0);
});

test('every-turn macro-only writes to proseStore, no chat insert', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const inserts = [];
  const proseStore = {};
  const sp = new StandaloneProbe(eng, {
    generateQuietPrompt: async () => 'log summary',
    insertSmallSysMessage: (o) => inserts.push(o),
    proseStore,
  });
  await sp.run({ changedTrackerIds: new Set(), subject: p });
  assert.strictEqual(inserts.length, 0);
  assert.strictEqual(proseStore['log']?.[p.id], 'log summary');
});

test('manual trigger: runOne ignores triggers', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const inserts = [];
  const sp = new StandaloneProbe(eng, {
    generateQuietPrompt: async () => 'forced',
    insertSmallSysMessage: (o) => inserts.push(o),
    proseStore: {},
  });
  await sp.runOne('mood', p);
  assert.strictEqual(inserts.length, 1);
});
