import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { Injection } from '../../src/pipeline/Injection.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'outfit',
    label: 'Outfit',
    injection: {
      enabled: true,
      trigger: 'always',
      position: 'in-prompt',
      depth: 4,
      template: '{{subject}}: {{topwear}}',
    },
    fields: [
      { id: 'topwear', label: 'Topwear', type: 'text', injection: { enabled: true } },
    ],
  });
  return eng;
}

test('Injection sanitizes {{ in subject name to prevent recursive expansion', () => {
  const eng = mkEngine();
  // We bypass SubjectStore's name guard by injecting directly — the sanitization
  // in expandTemplate is the last line of defence for odd inputs coming from
  // non-standard paths (e.g. migration, test injection).
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress {{evil}}');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push(t) });
  inj.run();
  const out = calls[0] ?? '';
  // The literal {{ from the value must not appear in output (must be escaped)
  assert.ok(!out.includes('{{evil}}'), `Output must not contain raw {{evil}}: ${out}`);
  assert.ok(out.includes('{ {evil} }') || out.includes('{ {'), `Output must contain sanitized form: ${out}`);
});

test('Injection sanitizes {{ in field description to prevent recursive expansion', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Hero', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'armor');
  // Simulate a description that came back from AI with template syntax
  eng.setDescription(p.id, 'outfit', 'topwear', 'armor', '{{malicious}} prose');
  eng.defineTracker({
    id: 'outfit2',
    label: 'Outfit2',
    injection: {
      enabled: true,
      trigger: 'always',
      position: 'in-prompt',
      depth: 4,
      template: '{{topwear.desc}}',
    },
    fields: [
      { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject', injection: { enabled: true } },
    ],
  });
  // Re-set the field on the new tracker
  eng.setField(p.id, 'outfit2', 'topwear', 'armor');
  eng.setDescription(p.id, 'outfit2', 'topwear', 'armor', '{{malicious}} prose');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const call = calls.find(c => c.k.includes('outfit2'));
  assert.ok(call, 'expected injection for outfit2');
  assert.ok(!call.t.includes('{{malicious}}'), `Description {{...}} must be sanitized: ${call.t}`);
});

test('Injection sanitizes newline in field value', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Hero', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'line1\nline2');
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push(t) });
  inj.run();
  const out = calls[0] ?? '';
  assert.ok(!out.includes('\n'), `Newline in field value should be sanitized: ${JSON.stringify(out)}`);
});
