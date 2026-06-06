import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { AutoUpdate, DEFAULT_AUTOUPDATE_TEMPLATE } from '../../src/pipeline/AutoUpdate.js';

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

test('buildPrompt uses custom template when provided', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  const au = new AutoUpdate(eng, {
    generateQuietPrompt: async () => '',
    template: 'CUSTOM_PREAMBLE\n{{tracked_entities}}\n{{last_reply}}',
  });
  const prompt = au.buildPrompt({ lastNarratorReply: 'She entered the hall.' });
  assert.match(prompt, /CUSTOM_PREAMBLE/);
  assert.match(prompt, /outfit\.topwear/);
  assert.match(prompt, /She entered the hall\./);
});

test('buildPrompt appends {{last_reply}} if missing from template', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, {
    generateQuietPrompt: async () => '',
    template: 'PREAMBLE_NO_REPLY\n{{tracked_entities}}',
  });
  const prompt = au.buildPrompt({ lastNarratorReply: 'The door slammed shut.' });
  assert.match(prompt, /PREAMBLE_NO_REPLY/);
  assert.match(prompt, /The door slammed shut\./);
});

test('setTemplate switches the in-use template', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  // Without template, default is used
  const defaultPrompt = au.buildPrompt({ lastNarratorReply: 'default reply' });
  assert.match(defaultPrompt, /You are a state tracker/);
  // Switch to custom template
  au.setTemplate('CUSTOM\n{{last_reply}}');
  const customPrompt = au.buildPrompt({ lastNarratorReply: 'custom reply' });
  assert.match(customPrompt, /CUSTOM/);
  assert.match(customPrompt, /custom reply/);
  assert.doesNotMatch(customPrompt, /You are a state tracker/);
});

test('buildPrompt includes the last user message before the narrator reply', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: 'She nodded.', lastUserMessage: '<(curse: +50 stamina base)>' });
  assert.match(prompt, /# Last user message/);
  assert.ok(prompt.includes('+50 stamina base'));
  assert.ok(prompt.indexOf('+50 stamina base') < prompt.indexOf('She nodded.'), 'user message before narrator reply');
});

test('custom template without {{last_input}} still receives the user message', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '', template: 'CUSTOM\n{{tracked_entities}}\n{{last_reply}}' });
  const prompt = au.buildPrompt({ lastNarratorReply: 'reply', lastUserMessage: 'USERMSG-XYZ' });
  assert.ok(prompt.includes('USERMSG-XYZ'), 'auto-appended');
});

test('number annotation reflects maxFromField and uncapped fields', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'rpg', label: 'RPG', appliesToRoles: ['protagonist'], autoUpdate: true, fields: [
    { id: 'stamina', label: 'Stamina', type: 'number', min: 0, default: 100, allowDelta: true, maxFromField: 'max_stamina', inclusion: { rule: 'always' } },
    { id: 'max_stamina', label: 'Max stamina', type: 'number', min: 0, default: 100, allowDelta: true, inclusion: { rule: 'always' }, injection: { enabled: false } },
  ]});
  eng.addSubject('Lyra', { role: 'protagonist' });
  const au = new AutoUpdate(eng, { generateQuietPrompt: async () => '' });
  const prompt = au.buildPrompt({ lastNarratorReply: '...' });
  assert.ok(prompt.includes('cap tracked in max_stamina'), 'stamina shows its companion as the cap');
  assert.ok(prompt.includes('no fixed cap'), 'uncapped companion is not falsely 0-100');
  assert.ok(!/stamina \(number, 0-100\)/.test(prompt), 'must not claim a static 0-100 for stamina');
});
