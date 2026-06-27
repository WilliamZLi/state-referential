import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { Injection, truncateDesc } from '../../src/pipeline/Injection.js';

test('truncateDesc keeps descriptions up to the render cap (300) and trims longer ones', () => {
  const short = 'A short identifier clause.';
  assert.strictEqual(truncateDesc(short), short, 'short desc unchanged');
  const med = 'x'.repeat(200);
  assert.strictEqual(truncateDesc(med), med, '200 chars is under the cap and must not be truncated');
  const long = 'y'.repeat(400);
  const out = truncateDesc(long);
  assert.ok(out.endsWith('…'), 'over-cap desc ends with ellipsis');
  assert.strictEqual(out.length, 300, 'truncated to 299 chars + ellipsis');
});

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
  assert.strictEqual(outfitCalls[0].pos, 0); // IN_PROMPT (main body — 'in-prompt' string maps to 0)
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
  assert.match(call.t, /A gleaming legendary blade/);
  // Shield appears (no desc → no parenthetical)
  assert.match(call.t, /Shield.*Round shield/);
  // Potion is injection.enabled=false → must not appear
  assert.ok(!call.t.includes('Health potion'), 'disabled field must not appear in {{fields}} expansion');
});

// ── Test 7: tracker with all fields empty is skipped (no header-only block) ────

test('tracker with all fields empty does not emit an extension prompt', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'wardrobe',
    label: 'Wardrobe',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4,
      template: '**{{subject}} wardrobe:**\n{{items}}' },
    fields: [
      { id: 'items', label: 'Items', type: 'list', injection: { enabled: true } },
    ],
  });
  const p = eng.addSubject('Sylvia', { role: 'protagonist' });
  // Intentionally do NOT set items — empty list.
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const call = calls.find(c => c.k === `tracker:${p.id}:wardrobe`);
  // Either no call at all, or a clearing empty-string call — but never a populated header.
  assert.ok(!call || call.t === '', 'empty tracker must not emit header-only injection');
});

// ── Test 8: previously-populated tracker clears its slot when fields go empty ──

test('tracker that becomes empty clears its previous extension prompt slot', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'outfit',
    label: 'Outfit',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4,
      template: '**{{subject}} outfit:** {{topwear}}' },
    fields: [
      { id: 'topwear', label: 'Topwear', type: 'text', injection: { enabled: true } },
    ],
  });
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');

  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const firstCall = calls.find(c => c.k === `tracker:${p.id}:outfit`);
  assert.ok(firstCall && firstCall.t.includes('red silk dress'), 'first run should emit populated block');

  // Now clear the field and re-run — the slot should be cleared with an empty string.
  eng.setField(p.id, 'outfit', 'topwear', '');
  calls.length = 0;
  inj.run();
  const secondCall = calls.find(c => c.k === `tracker:${p.id}:outfit`);
  assert.ok(secondCall && secondCall.t === '', 'cleared field should clear the previous injection slot');
});

// ── Test 9 & 10: struct-list injection with inclusion.where filter ─────────────

function mkLedgerInjection({ allFulfilled = false } = {}) {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'ledger',
    label: 'Ledger',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4, template: '{{fields}}' },
    fields: [
      {
        id: 'threads',
        label: 'Threads',
        type: 'struct-list',
        injection: { enabled: true },
        inclusion: { where: { status: ['open'] } },
        fields: [
          { id: 'name',   label: 'Name',   type: 'text' },
          { id: 'detail', label: 'Detail', type: 'text' },
          { id: 'amount', label: 'Amount', type: 'number', min: 0 },
          { id: 'status', label: 'Status', type: 'enum', options: ['open', 'fulfilled'] },
        ],
      },
    ],
  });
  const p = eng.addSubject('Player', { role: 'protagonist' });

  if (allFulfilled) {
    eng.setField(p.id, 'ledger', 'threads', [
      { name: 'Old quest', status: 'fulfilled' },
    ]);
  } else {
    eng.setField(p.id, 'ledger', 'threads', [
      { name: 'Merchant debt', amount: 40, status: 'open' },
      { name: 'Old quest', status: 'fulfilled' },
    ]);
  }

  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t, pos, d) => calls.push({ k, t, pos, d }) });

  return {
    runAndGetPrompt(trackerId) {
      inj.run();
      const key = `tracker:${p.id}:${trackerId}`;
      const call = calls.find(c => c.k === key);
      return call ? call.t : '';
    },
  };
}

test('struct-list injection renders open rows only, one line each', () => {
  const r = mkLedgerInjection(); // helper: ledger always-on, where status:[open], 2 rows (one open, one fulfilled)
  const out = r.runAndGetPrompt('ledger');
  assert.match(out, /Merchant debt/);          // open row present
  assert.match(out, /amount: 40/);
  assert.doesNotMatch(out, /Old quest/);        // fulfilled row filtered out
});

test('struct-list injection skips the block when no row passes the filter', () => {
  const r = mkLedgerInjection({ allFulfilled: true });
  assert.equal(r.runAndGetPrompt('ledger'), ''); // nothing injected
});

// ── Test 10 (T5 gap): filter sub-field name must not appear in rendered output ──

test('struct-list injection does not render the filter sub-field (status) in output', () => {
  const r = mkLedgerInjection(); // where: { status: ['open'] }
  const out = r.runAndGetPrompt('ledger');
  assert.doesNotMatch(out, /status/, 'filter key sub-field must be suppressed from rendered rows');
});

// ── Test 11 (FIX 2): default-valued sub-fields omitted; non-default rendered ───

test('struct-list injection omits sub-field when value equals default, renders when non-default', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({
    id: 'ledger',
    label: 'Ledger',
    injection: { enabled: true, trigger: 'always', position: 'in-prompt', depth: 4, template: '{{fields}}' },
    fields: [
      {
        id: 'threads',
        label: 'Threads',
        type: 'struct-list',
        injection: { enabled: true },
        fields: [
          { id: 'detail', label: 'Detail', type: 'text', default: '' },
          { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
        ],
      },
    ],
  });
  const p = eng.addSubject('Player', { role: 'protagonist' });
  eng.setField(p.id, 'ledger', 'threads', [
    { name: 'Zero debt', detail: '', amount: 0 },    // amount at default
    { name: 'Real debt', detail: '', amount: 40 },   // amount non-default
  ]);
  const calls = [];
  const inj = new Injection(eng, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const call = calls.find(c => c.k === `tracker:${p.id}:ledger`);
  assert.ok(call, 'expected injection call');
  const out = call.t;
  // Row with amount=0 must NOT render "amount:" (it's the default value)
  const zeroDebtLine = out.split('\n').find(l => l.includes('Zero debt')) ?? '';
  assert.doesNotMatch(zeroDebtLine, /amount/, 'amount:0 (default) must be omitted from Zero debt row');
  // Row with amount=40 must render "amount: 40"
  assert.match(out, /amount: 40/);
});
