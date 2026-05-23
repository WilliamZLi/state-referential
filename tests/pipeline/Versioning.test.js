import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { Versioning } from '../../src/pipeline/Versioning.js';

function mkRig() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', autoUpdate: true, fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', inclusion: { rule: 'always' } },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });

  let autoUpdateResult = 'NONE';
  const autoUpdate = { run: async ({ msgId }) => { return eng.applyCommands(autoUpdateResult, { source: 'auto-update', msgId }); } };
  const descProbe = { enqueue: () => {}, drain: async () => {} };
  const standalone = { run: async () => {} };
  const injection = { run: () => {} };

  const events = [];
  const emit = async (name, ...args) => {
    const promises = [];
    for (const h of (eventBus[name] ?? [])) {
      const result = h(...args);
      if (result && typeof result.then === 'function') promises.push(result);
    }
    await Promise.all(promises);
  };
  const eventBus = {};
  const eventSource = { on: (n, fn) => { (eventBus[n] ??= []).push(fn); } };
  const chat = [{ extra: { trackerMsgId: 'm-1' }, mes: 'Hello world.', is_user: false }];
  const v = new Versioning(eng, {
    eventSource,
    event_types: { MESSAGE_RECEIVED: 'MR', MESSAGE_SWIPED: 'MSW', MESSAGE_EDITED: 'MED', MESSAGE_DELETED: 'MDEL', CHAT_CHANGED: 'CC' },
    getChat: () => chat,
    autoUpdate, descProbe, standalone, injection,
    throttleMs: 0,
  });
  v.register();
  return { eng, p, chat, emit, set: (cmd) => { autoUpdateResult = cmd; }, v };
}

test('MESSAGE_RECEIVED snapshots, runs auto-update, then probes/injection', async () => {
  const r = mkRig();
  r.set(`SET Lyra outfit.topwear = "red dress"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'outfit', 'topwear'), 'red dress');
  assert.ok(r.eng.loadSnapshot('m-1'));
});

test('MESSAGE_SWIPED reverts to snapshot then re-runs auto-update', async () => {
  const r = mkRig();
  r.set(`SET Lyra outfit.topwear = "red"`);
  await r.emit('MR', 0);
  r.set(`SET Lyra outfit.topwear = "blue"`);
  await r.emit('MSW', 0);
  // After swipe, state should have been reverted to the m-1 snapshot, then re-run produces blue.
  assert.strictEqual(r.eng.getField(r.p.id, 'outfit', 'topwear'), 'blue');
});

test('MESSAGE_DELETED drops snapshots from deleted onwards', async () => {
  const r = mkRig();
  r.set(`NONE`);
  r.chat.push({ extra: { trackerMsgId: 'm-2' }, mes: 'second', is_user: false });
  await r.emit('MR', 0);
  await r.emit('MR', 1);
  r.chat.pop();
  await r.emit('MDEL', 1);
  assert.strictEqual(r.eng.loadSnapshot('m-2'), undefined);
});

test('CHAT_CHANGED clears IS_BUSY', async () => {
  const r = mkRig();
  r.v._busy = true;
  await r.emit('CC');
  assert.strictEqual(r.v._busy, false);
});

test('IS_BUSY blocks reentry', async () => {
  const r = mkRig();
  r.v._busy = true;
  r.set(`SET Lyra outfit.topwear = "x"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'outfit', 'topwear'), undefined);
});
