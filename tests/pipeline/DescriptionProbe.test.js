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

test('enqueue then drain calls probe sequentially with rendered template', async () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist', traits: { height: 'tall', hair: 'red' } });
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');
  const calls = [];
  const probe = new DescriptionProbe(eng, { generateQuietPrompt: async (prompt) => { calls.push(prompt); return 'A fitted crimson silk dress.'; } });
  probe.enqueue([{ subjectId: p.id, trackerId: 'outfit', fieldId: 'topwear', value: 'red silk dress' }]);
  await probe.drain();
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /Lyra/);
  assert.match(calls[0], /red silk dress/);
  assert.match(calls[0], /tall/);
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'red silk dress'), 'A fitted crimson silk dress.');
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
