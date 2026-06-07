import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { register } from '../../src/integration/EventHooks.js';

function setup(probeDesc = true) {
  const eng = new TrackerEngine(new InMemoryBackend());
  const enqueued = [];
  const deps = {
    versioning: { register() {} },
    descProbe: { enqueue: (items) => enqueued.push(...items) },
    getSettings: () => ({ probeDesc }),
    injection: { run() {} },
    hasActiveChat: () => false,
  };
  register(eng, deps);
  return { eng, enqueued };
}

test('value-changed with source "replace" does not enqueue a generic probe', () => {
  const { eng, enqueued } = setup();
  eng.bus.emit('tracker:value-changed', { subject: 's', tracker: 't', field: 'f', oldValue: [], newValue: ['x'], source: 'replace' });
  assert.strictEqual(enqueued.length, 0);
});

test('value-changed from the AI still enqueues a generic probe', () => {
  const { eng, enqueued } = setup();
  eng.bus.emit('tracker:value-changed', { subject: 's', tracker: 't', field: 'f', oldValue: [], newValue: ['x'], source: 'auto-update' });
  assert.strictEqual(enqueued.length, 1);
  assert.deepStrictEqual(enqueued[0].value, ['x']);
});

test('entry-replaced enqueues one probe carrying prior context', () => {
  const { eng, enqueued } = setup();
  eng.bus.emit('tracker:entry-replaced', { subject: 's', tracker: 't', field: 'f', oldValue: 'old', newValue: 'new', priorDescription: 'prior desc' });
  assert.strictEqual(enqueued.length, 1);
  assert.strictEqual(enqueued[0].value, 'new');
  assert.strictEqual(enqueued[0].priorValue, 'old');
  assert.strictEqual(enqueued[0].priorDescription, 'prior desc');
});

test('entry-replaced respects the probeDesc master toggle', () => {
  const { eng, enqueued } = setup(false);
  eng.bus.emit('tracker:entry-replaced', { subject: 's', tracker: 't', field: 'f', oldValue: 'old', newValue: 'new', priorDescription: 'd' });
  assert.strictEqual(enqueued.length, 0);
});

test('end-to-end: a REPLACE via applyCommands yields exactly one prior-context probe', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'inv', label: 'Inventory', appliesToRoles: ['protagonist'], fields: [
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'per-subject' },
  ]});
  const enqueued = [];
  register(eng, {
    versioning: { register() {} },
    descProbe: { enqueue: (items) => enqueued.push(...items) },
    getSettings: () => ({ probeDesc: true }),
    injection: { run() {} },
    hasActiveChat: () => false,
  });
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['magic staff']);
  eng.setDescription(p.id, 'inv', 'items', 'magic staff', 'a carved oak staff with a glowing gem');
  enqueued.length = 0; // ignore anything from the setup writes above
  eng.applyCommands('REPLACE Cersia inv.items "magic staff" WITH "magic staff (broken)"');
  assert.strictEqual(enqueued.length, 1, 'exactly one probe enqueued for the REPLACE');
  assert.strictEqual(enqueued[0].value, 'magic staff (broken)');
  assert.strictEqual(enqueued[0].priorValue, 'magic staff');
  assert.strictEqual(enqueued[0].priorDescription, 'a carved oak staff with a glowing gem');
});
