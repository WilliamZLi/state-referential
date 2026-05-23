import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { AutoUpdate } from '../../src/pipeline/AutoUpdate.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist','npc'], autoUpdate: true, fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', inclusion: { rule: 'always' } },
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', appliesToRoles: ['protagonist','npc'], autoUpdate: true, fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100, allowDelta: true, inclusion: { rule: 'always' } },
    { id: 'arousal', label: 'Arousal', type: 'number', min: 0, max: 100, default: 0, allowDelta: true,
      inclusion: { rule: 'tag', tags: ['intimate'] } },
  ]});
  eng.defineTracker({ id: 'state', label: 'State', appliesToRoles: ['protagonist','npc'], autoUpdate: true, fields: [
    { id: 'mood', label: 'Mood', type: 'enum', options: ['neutral','happy','sad'], default: 'neutral', inclusion: { rule: 'always' } },
    { id: 'statuses', label: 'Statuses', type: 'list', default: [], inclusion: { rule: 'active', activeWindow: 2 } },
  ]});
  return eng;
}

test('buildPrompt includes always-rule fields and excludes tag-gated when off', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'blue tunic');
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: 'She drew her sword.' });
  assert.match(prompt, /Lyra \(protagonist\)/);
  assert.match(prompt, /outfit\.topwear .*= "blue tunic"/);
  assert.match(prompt, /stats\.hp/);
  assert.doesNotMatch(prompt, /stats\.arousal/);
  assert.match(prompt, /She drew her sword\./);
});

test('tag-gated field included when tag active', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setSceneTag('intimate', true);
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: '...' });
  assert.match(prompt, /stats\.arousal/);
});

test('active rule excludes when stale', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  // touched at tm-5, current is tm-9, window=2 → stale
  eng.setField(p.id, 'state', 'statuses', ['stunned'], { msgId: 'tm-5' });
  const au = new AutoUpdate(eng, {
    generateQuietPrompt: async () => '',
    getCurrentMsgId: () => 'tm-9',
    getMsgIndex: (id) => ({ 'tm-5': 5, 'tm-9': 9 }[id] ?? null),
  });
  const prompt = au.buildPrompt({ lastNarratorReply: '...' });
  assert.doesNotMatch(prompt, /state\.statuses/);
});

test('run() calls generateQuietPrompt then applies commands', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  let promptSent = '';
  const au = new AutoUpdate(eng, {
    generateQuietPrompt: async (text) => { promptSent = text; return `SET Lyra outfit.topwear = "red"\nDELTA Lyra stats.hp -5`; },
  });
  const res = await au.run({ lastNarratorReply: 'She fell.', msgId: 'tm-1' });
  assert.ok(promptSent.includes('Lyra'));
  assert.strictEqual(res.applied, 2);
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'red');
});

test('manual-rule field never appears (until one-shot include)', () => {
  const eng = mkEngine();
  eng.defineTracker({ id: 'secret', label: 'Secret', autoUpdate: true, fields: [
    { id: 'pin', label: 'PIN', type: 'text', inclusion: { rule: 'manual' } },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: '...' });
  assert.doesNotMatch(prompt, /secret\.pin/);
  au.includeOnce(p.id, 'secret', 'pin');
  const prompt2 = au.buildPrompt({ lastNarratorReply: '...' });
  assert.match(prompt2, /secret\.pin/);
  // one-shot consumed
  const prompt3 = au.buildPrompt({ lastNarratorReply: '...' });
  assert.doesNotMatch(prompt3, /secret\.pin/);
});

test('respects autoUpdate=false on tracker', () => {
  const eng = mkEngine();
  eng.defineTracker({ id: 'manual', label: 'Manual', autoUpdate: false, fields: [
    { id: 'note', label: 'Note', type: 'text', inclusion: { rule: 'always' } },
  ]});
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: '...' });
  assert.doesNotMatch(prompt, /manual\.note/);
});
