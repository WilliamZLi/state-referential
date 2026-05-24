import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { Injection } from '../../src/pipeline/Injection.js';

// ── helpers ────────────────────────────────────────────────────────────────────

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'outfit',
    label: 'Outfit',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4,
      template: '**{{subject}} outfit:** {{topwear}}' },
    fields: [
      { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject',
        injection: { enabled: true } },
    ],
  });
  eng.defineTracker({
    id: 'stats',
    label: 'Stats',
    injection: { enabled: true, trigger: 'tag', tags: ['intimate'], position: 'in-prompt', depth: 2,
      template: '{{subject}} arousal {{arousal}}/100' },
    fields: [
      { id: 'arousal', label: 'Arousal', type: 'number', min: 0, max: 100,
        injection: { enabled: true } },
    ],
  });
  return eng;
}

// ── Test 1: always-trigger calls setExtensionPrompt once per tracker ───────────

test('always-trigger tracker calls setExtensionPrompt once per tracker with rendered template', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');
  eng.setDescription(p.id, 'outfit', 'topwear', 'red silk dress', 'A fitted crimson silk dress.');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t, pos, d) => calls.push({ k, t, pos, d }) });
  inj.run();
  // Only one call for the outfit tracker (stats is tag-gated and no tag active)
  const outfitCalls = calls.filter(c => c.k === `tracker:${p.id}:outfit`);
  assert.strictEqual(outfitCalls.length, 1);
  assert.match(outfitCalls[0].t, /Lyra/);
  assert.match(outfitCalls[0].t, /red silk dress/);
  assert.strictEqual(outfitCalls[0].pos, 'in-prompt');
  assert.strictEqual(outfitCalls[0].d, 4);
});

// ── Test 2: tag-trigger respects scene tags at TRACKER level ──────────────────

test('tag-trigger tracker excluded when tag off, included when on', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'stats', 'arousal', 30);
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  assert.strictEqual(calls.filter(c => c.k === `tracker:${p.id}:stats`).length, 0);
  eng.setSceneTag('intimate', true);
  calls.length = 0;
  inj.run();
  const statsCalls = calls.filter(c => c.k === `tracker:${p.id}:stats`);
  assert.strictEqual(statsCalls.length, 1);
  assert.match(statsCalls[0].t, /Lyra arousal 30\/100/);
});

// ── Test 3: clears previous keys when tracker no longer injected ───────────────

test('clears previous keys by writing empty string when tracker no longer injected', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  eng.removeSubject('Lyra');
  inj.run();
  const cleared = calls.find(c => c.k === `tracker:${p.id}:outfit` && c.t === '');
  assert.ok(cleared, 'expected clearing call for removed subject\'s old injection key');
});

// ── Test 4: disabled tracker never emits ──────────────────────────────────────

test('tracker with injection.enabled=false never emits', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'silent',
    label: 'Silent',
    injection: { enabled: false },
    fields: [
      { id: 'x', label: 'X', type: 'text', injection: { enabled: true } },
    ],
  });
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'silent', 'x', 'hello');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  assert.strictEqual(calls.filter(c => c.k.includes('silent')).length, 0);
});

// ── Test 5: field with injection.enabled=false is omitted from rendered output ─

test('field with injection.enabled=false is omitted from rendered output', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'mixed',
    label: 'Mixed',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4, template: '{{fields}}' },
    fields: [
      { id: 'visible', label: 'Visible', type: 'text', injection: { enabled: true } },
      { id: 'hidden', label: 'Hidden', type: 'text', injection: { enabled: false } },
    ],
  });
  const p = eng.addSubject('Hero', { role: 'protagonist' });
  eng.setField(p.id, 'mixed', 'visible', 'yes');
  eng.setField(p.id, 'mixed', 'hidden', 'secret');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const call = calls.find(c => c.k === `tracker:${p.id}:mixed`);
  assert.ok(call, 'expected injection call for mixed tracker');
  assert.match(call.t, /visible/i);  // the field label or value appears
  assert.ok(!call.t.includes('secret'), 'hidden field value must not appear in output');
});

// ── Test 6: {{fields}} placeholder expands to all enabled fields auto-formatted ─

test('{{fields}} placeholder expands to auto-formatted enabled fields', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'gear',
    label: 'Gear',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4, template: '{{fields}}' },
    fields: [
      { id: 'sword', label: 'Sword', type: 'text', injection: { enabled: true } },
      { id: 'shield', label: 'Shield', type: 'text', injection: { enabled: true } },
      { id: 'potion', label: 'Potion', type: 'text', injection: { enabled: false } },
    ],
  });
  const p = eng.addSubject('Knight', { role: 'protagonist' });
  eng.setField(p.id, 'gear', 'sword', 'Excalibur');
  eng.setField(p.id, 'gear', 'shield', 'Round shield');
  eng.setField(p.id, 'gear', 'potion', 'Health potion');
  eng.setDescription(p.id, 'gear', 'sword', 'Excalibur', 'A gleaming legendary blade.');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const call = calls.find(c => c.k === `tracker:${p.id}:gear`);
  assert.ok(call, 'expected injection call for gear tracker');
  // Auto-format: "Sword: Excalibur (A gleaming legendary blade.)"
  assert.match(call.t, /Sword.*Excalibur/);
  assert.match(call.t, /A gleaming legendary blade\./);
  // Shield appears (no desc → no parenthetical)
  assert.match(call.t, /Shield.*Round shield/);
  // Potion is injection.enabled=false → must not appear
  assert.ok(!call.t.includes('Health potion'), 'disabled field must not appear in {{fields}} expansion');
});
