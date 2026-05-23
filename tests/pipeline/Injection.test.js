import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { Injection } from '../../src/pipeline/Injection.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject',
      injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4,
        template: '**{{subject}} {{label}}:** {{value.desc}}' } },
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', fields: [
    { id: 'arousal', label: 'Arousal', type: 'number', min: 0, max: 100,
      injection: { enabled: true, trigger: 'tag', tags: ['intimate'], position: 'in-prompt', depth: 2,
        template: '{{subject}} arousal {{value}}/{{max}}' } },
  ]});
  return eng;
}

test('always-trigger field calls setExtensionPrompt with rendered template', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');
  eng.setDescription(p.id, 'outfit', 'topwear', 'red silk dress', 'A fitted crimson silk dress.');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t, pos, d) => calls.push({ k, t, pos, d }) });
  inj.run();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].k, `tracker:${p.id}:outfit:topwear`);
  assert.match(calls[0].t, /Lyra/);
  assert.match(calls[0].t, /A fitted crimson silk dress\./);
  assert.strictEqual(calls[0].pos, 'in-prompt');
  assert.strictEqual(calls[0].d, 4);
});

test('tag-trigger field excluded when tag off, included when on', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'stats', 'arousal', 30);
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  assert.strictEqual(calls.filter(c => c.k.endsWith('arousal')).length, 0);
  eng.setSceneTag('intimate', true);
  calls.length = 0;
  inj.run();
  assert.strictEqual(calls.filter(c => c.k.endsWith('arousal')).length, 1);
  assert.match(calls.find(c => c.k.endsWith('arousal')).t, /Lyra arousal 30\/100/);
});

test('clears previous keys by writing empty text first', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  eng.removeSubject('Lyra');
  inj.run();
  // The second run should issue a clearing call (empty string) for the now-gone key.
  const cleared = calls.find(c => c.k === `tracker:${p.id}:outfit:topwear` && c.t === '');
  assert.ok(cleared, 'expected clearing call for removed subject\'s old injection key');
});

test('disabled injection field never emits', () => {
  const eng = mkEngine();
  eng.defineTracker({ id: 'silent', label: 'Silent', fields: [
    { id: 'x', label: 'X', type: 'text', injection: { enabled: false } },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'silent', 'x', 'hi');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  assert.strictEqual(calls.filter(c => c.k.endsWith('silent:x')).length, 0);
});
