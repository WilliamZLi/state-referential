import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { DescriptionProbe } from '../../src/pipeline/DescriptionProbe.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject' },
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, describable: false },
  ]});
  return eng;
}

test('reprobe profile override forces a profile regardless of the field', async () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'wardrobe', label: 'Wardrobe', fields: [
    { id: 'cloak', label: 'Cloak', type: 'text', describable: true, descriptionScope: 'per-subject' },
    { id: 'curse', label: 'Curse', type: 'text', describable: true, descriptionScope: 'per-subject', probeProfile: 'detailed' },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'wardrobe', 'cloak', 'Moonpetal Cloak');
  eng.setField(p.id, 'wardrobe', 'curse', 'Hex');
  const calls = [];
  const probe = new DescriptionProbe(eng, {
    generateQuietPrompt: async (prompt) => { calls.push(prompt); return 'x'; },
    getProbeContext: () => ({ lastInput: 'CTX-INPUT', lastReply: 'CTX-REPLY' }),
  });
  probe.enqueue([{ subjectId: p.id, trackerId: 'wardrobe', fieldId: 'cloak', value: 'Moonpetal Cloak', profile: 'detailed' }]);
  probe.enqueue([{ subjectId: p.id, trackerId: 'wardrobe', fieldId: 'curse', value: 'Hex', profile: 'generic' }]);
  await probe.drain();
  const cloakPrompt = calls.find(c => c.includes('Moonpetal Cloak'));
  const cursePrompt = calls.find(c => c.includes('Hex'));
  assert.ok(cloakPrompt.includes('CTX-INPUT'), 'profile:detailed forces detailed on a generic field');
  assert.ok(!cursePrompt.includes('CTX-INPUT'), 'profile:generic forces generic on a detailed field');
});

test('enqueue then drain calls probe sequentially with rendered template', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist', traits: { height: 'tall', hair: 'red' } });
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');
  const calls = [];
  const probe = new DescriptionProbe(eng, { generateQuietPrompt: async (prompt) => { calls.push(prompt); return 'a fitted crimson silk dress'; } });
  probe.enqueue([{ subjectId: p.id, trackerId: 'outfit', fieldId: 'topwear', value: 'red silk dress' }]);
  await probe.drain();
  assert.strictEqual(calls.length, 1);
  // Default template focuses on the item itself, not the subject/traits.
  assert.match(calls[0], /red silk dress/);
  assert.match(calls[0], /generic/i); // stays a sanity-check that we got the real template
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'red silk dress'), 'a fitted crimson silk dress');
});

test('skips non-describable and empty values', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const calls = [];
  const probe = new DescriptionProbe(eng, { generateQuietPrompt: async (q) => { calls.push(q); return 'x'; } });
  probe.enqueue([
    { subjectId: p.id, trackerId: 'stats', fieldId: 'hp', value: 50 },     // non-describable
    { subjectId: p.id, trackerId: 'outfit', fieldId: 'topwear', value: '' }, // empty
  ]);
  await probe.drain();
  assert.strictEqual(calls.length, 0);
});

test('cache hit skips', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setDescription(p.id, 'outfit', 'topwear', 'red dress', 'existing prose');
  const calls = [];
  const probe = new DescriptionProbe(eng, { generateQuietPrompt: async (q) => { calls.push(q); return 'x'; } });
  probe.enqueue([{ subjectId: p.id, trackerId: 'outfit', fieldId: 'topwear', value: 'red dress' }]);
  await probe.drain();
  assert.strictEqual(calls.length, 0);
});

test('emits tracker:probe-completed', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const events = [];
  eng.on('tracker:probe-completed', e => events.push(e));
  const probe = new DescriptionProbe(eng, { generateQuietPrompt: async () => 'prose result' });
  probe.enqueue([{ subjectId: p.id, trackerId: 'outfit', fieldId: 'topwear', value: 'red' }]);
  await probe.drain();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].prose, 'prose result');
});

test('detailed profile scopes the description to the element only', async () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'heels', label: 'Heels', type: 'text', describable: true, descriptionScope: 'per-subject', probeProfile: 'detailed' },
  ]});
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'heels', 'stiletto heels');
  const calls = [];
  const probe = new DescriptionProbe(eng, {
    generateQuietPrompt: async (prompt) => { calls.push(prompt); return 'x'; },
    getProbeContext: () => ({ lastInput: 'curse effects...', lastReply: '...' }),
  });
  probe.enqueue([{ subjectId: p.id, trackerId: 'outfit', fieldId: 'heels', value: 'stiletto heels' }]);
  await probe.drain();
  const prompt = calls[0];
  assert.match(prompt, /only this/i, 'tells the model to describe only this element');
  assert.match(prompt, /separate tracked|belong to|tracked (in their|elsewhere)/i, 'warns against re-listing effects tracked elsewhere');
});

test('detailed profile injects chat context; generic does not', async () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'state', label: 'State', fields: [
    { id: 'conditions', label: 'Conditions', type: 'list', describable: true, descriptionScope: 'per-subject', probeProfile: 'detailed' },
    { id: 'mood', label: 'Mood', type: 'text', describable: true, descriptionScope: 'per-subject' },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.addListEntry(p.id, 'state', 'conditions', 'Dairy Cow Curse');
  eng.setField(p.id, 'state', 'mood', 'merry');
  const calls = [];
  const probe = new DescriptionProbe(eng, {
    generateQuietPrompt: async (prompt) => { calls.push(prompt); return 'x'; },
    getProbeContext: () => ({ lastInput: 'DIRECTIVE-XYZ +50 stamina base', lastReply: 'REPLY-ABC' }),
  });
  probe.enqueue([
    { subjectId: p.id, trackerId: 'state', fieldId: 'conditions', value: 'Dairy Cow Curse' },
    { subjectId: p.id, trackerId: 'state', fieldId: 'mood', value: 'merry' },
  ]);
  await probe.drain();
  const detailedPrompt = calls.find(c => c.includes('Dairy Cow Curse'));
  const genericPrompt = calls.find(c => c.includes('merry'));
  assert.ok(detailedPrompt.includes('DIRECTIVE-XYZ +50 stamina base'), 'detailed profile injects the user directive');
  assert.ok(!genericPrompt.includes('DIRECTIVE-XYZ'), 'generic profile carries no context');
});
