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
  // Injection spy: records how many times run() fired and captures a snapshot of
  // engine state at each run, mirroring how the real Injection renders the
  // itemized block from current state. Lets tests assert the *injected* prompt
  // reflects the live (post-restore) state, not just the engine state.
  let injectionRuns = 0;
  let lastInjected = null;
  const injection = { run: () => { injectionRuns++; lastInjected = eng.snapshot(); } };

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
  return {
    eng, p, chat, emit, set: (cmd) => { autoUpdateResult = cmd; }, v,
    injectionRuns: () => injectionRuns,
    lastInjected: () => lastInjected,
  };
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

test('MESSAGE_RECEIVED re-fired on same msgId (regenerate) restores from existing snapshot', async () => {
  // ST's regenerate button replaces msg.mes in-place and fires MESSAGE_RECEIVED
  // again with the SAME index/message — no MESSAGE_SWIPED. Without an explicit
  // restore step in _onReceived, the prior snapshot would get OVERWRITTEN with
  // the dirty post-update state, and outfit changes from the old gen would
  // permanently stick.
  const r = mkRig();
  // First gen of msg N: AI adds a red dress
  r.set(`SET Lyra outfit.topwear = "red dress"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'outfit', 'topwear'), 'red dress');
  // User regenerates msg N. ST swaps msg.mes to the new gen and re-fires MR.
  // New gen says nothing about clothes → autoupdate emits NONE.
  r.chat[0].mes = 'They walked through a field.';
  r.set(`NONE`);
  await r.emit('MR', 0);
  // Outfit must revert to pre-N state (no dress), NOT retain the previous gen's red dress.
  const v = r.eng.getField(r.p.id, 'outfit', 'topwear');
  assert.ok(v === undefined || v === '', `expected outfit cleared after regenerate with NONE, got: ${JSON.stringify(v)}`);
});

test('MESSAGE_SWIPED with empty new variant removes additions from the original variant', async () => {
  // Scenario the user reported: turn adds a field (e.g. "bra"), user swipes,
  // new variant doesn't mention it — addition should disappear.
  const r = mkRig();
  // Define an extra field so we can simulate the "bra" addition path
  r.eng.defineTracker({ id: 'extra', label: 'Extra', autoUpdate: true, fields: [
    { id: 'topunderwear', label: 'Top underwear', type: 'text', inclusion: { rule: 'always' } },
  ]});
  // Pre-turn state: nothing set on topunderwear
  assert.strictEqual(r.eng.getField(r.p.id, 'extra', 'topunderwear'), undefined);
  // Turn N: AI adds "bra"
  r.set(`SET Lyra extra.topunderwear = "bra"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'extra', 'topunderwear'), 'bra');
  // User swipes → new variant says nothing relevant (NONE)
  r.set(`NONE`);
  await r.emit('MSW', 0);
  // bra should be gone — the snapshot taken before the original variant did not have it,
  // and the new variant didn't re-add it.
  const v = r.eng.getField(r.p.id, 'extra', 'topunderwear');
  assert.ok(v === undefined || v === '', `expected topunderwear cleared after swipe with empty new variant, got: ${JSON.stringify(v)}`);
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

test('MESSAGE_DELETED with pre-splice ST behavior (msg still in chat) still restores', async () => {
  // Some ST versions emit MESSAGE_DELETED BEFORE removing the message from
  // chat[]. liveIds would still include the deleted msg's id → no orphans
  // → previous logic skipped restore. Fix: fall back to chat[index]'s snapshot.
  const r = mkRig();
  r.eng.defineTracker({ id: 'extra', label: 'Extra', autoUpdate: true, fields: [
    { id: 'thing', label: 'Thing', type: 'text', inclusion: { rule: 'always' } },
  ]});
  r.set(`SET Lyra extra.thing = "bra"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'extra', 'thing'), 'bra');
  // Pre-splice: ST fires MDEL but chat[0] STILL contains the message.
  await r.emit('MDEL', 0);
  const v = r.eng.getField(r.p.id, 'extra', 'thing');
  assert.ok(v === undefined || v === '', `pre-splice MDEL should restore, got: ${JSON.stringify(v)}`);
});

test('CHAT_CHANGED drops stale orphan snapshots', async () => {
  // Simulate pre-fix accumulated orphans: snapshots whose msgIds aren't in chat.
  const r = mkRig();
  r.set(`NONE`);
  await r.emit('MR', 0); // creates snapshot for m-1
  // Manually inject a stale orphan snapshot (no longer in chat).
  r.eng.snapshots.save('ghost-msg-id', r.eng.snapshot('ghost-msg-id'));
  assert.ok(r.eng.loadSnapshot('ghost-msg-id'), 'precondition: ghost snapshot exists');
  await r.emit('CC');
  // After CHAT_CHANGED, the ghost snapshot should be gone but m-1's snapshot retained.
  assert.strictEqual(r.eng.loadSnapshot('ghost-msg-id'), undefined, 'orphan should be dropped');
  assert.ok(r.eng.loadSnapshot('m-1'), 'live msg snapshot should remain');
});

test('MESSAGE_DELETED restores state to before the deleted message ran', async () => {
  // User scenario: AI message N introduced a value (e.g. "bra"). User deletes N.
  // Engine state must revert to as-if-N-never-happened.
  const r = mkRig();
  r.eng.defineTracker({ id: 'extra', label: 'Extra', autoUpdate: true, fields: [
    { id: 'thing', label: 'Thing', type: 'text', inclusion: { rule: 'always' } },
  ]});
  // First turn: AI adds "bra"
  r.set(`SET Lyra extra.thing = "bra"`);
  await r.emit('MR', 0);
  assert.strictEqual(r.eng.getField(r.p.id, 'extra', 'thing'), 'bra');
  // User deletes the message; ST removes it from chat first, then fires MDEL
  r.chat.shift();
  await r.emit('MDEL', 0);
  const v = r.eng.getField(r.p.id, 'extra', 'thing');
  assert.ok(v === undefined || v === '', `expected thing cleared after delete, got: ${JSON.stringify(v)}`);
});

test('MESSAGE_DELETED refreshes the injected itemization after restoring state', async () => {
  // User repro: delete the last N generations; engine state reverts via snapshot
  // restore, but the *injected* state block (setExtensionPrompt) was never
  // refreshed, so the prompt itemization still listed the deleted gens' values.
  // ST bulk delete truncates chat THEN emits MESSAGE_DELETED once (post-splice).
  const r = mkRig();
  r.eng.defineTracker({ id: 'extra', label: 'Extra', autoUpdate: true, fields: [
    { id: 'thing', label: 'Thing', type: 'text', inclusion: { rule: 'always' } },
  ]});
  // Two AI generations, each adds to the field.
  r.chat.push({ extra: { trackerMsgId: 'm-2' }, mes: 'second', is_user: false });
  r.set(`SET Lyra extra.thing = "bra"`);
  await r.emit('MR', 0);   // m-1
  r.set(`SET Lyra extra.thing = "corset"`);
  await r.emit('MR', 1);   // m-2
  assert.strictEqual(r.eng.getField(r.p.id, 'extra', 'thing'), 'corset');
  const runsBefore = r.injectionRuns();
  // Bulk delete both generations: ST truncates chat, then fires MDEL once.
  r.chat.length = 0;
  await r.emit('MDEL', 0);
  // Engine state reverted to before m-1 ran.
  const v = r.eng.getField(r.p.id, 'extra', 'thing');
  assert.ok(v === undefined || v === '', `expected thing cleared after delete, got: ${JSON.stringify(v)}`);
  // The injection must have re-run so the itemized prompt reflects the revert.
  assert.ok(r.injectionRuns() > runsBefore, 'injection.run() must fire after a delete restore');
  const injectedThing = r.lastInjected()?.values?.[r.p.id]?.extra?.thing?.v;
  assert.ok(
    injectedThing === undefined || injectedThing === '',
    `injected itemization must not still list the deleted value, got: ${JSON.stringify(injectedThing)}`,
  );
});

test('MESSAGE_EDITED on a non-tail (older) message does NOT re-run auto-update', async () => {
  // Editing a past generation must not roll state back to that point or re-extract
  // changes from it (which spuriously re-adds clothing/items). Only the latest
  // message re-derives.
  const r = mkRig();
  r.chat.push({ extra: { trackerMsgId: 'm-2' }, mes: 'second', is_user: false });
  r.set(`NONE`);
  await r.emit('MR', 0); // process m-1
  await r.emit('MR', 1); // process m-2 (the tail)
  // User edits the OLDER message (index 0, not the tail). Its content would set a
  // dress if processed — but an older-message edit must not run auto-update.
  r.set(`SET Lyra outfit.topwear = "red dress"`);
  await r.emit('MED', 0);
  const v = r.eng.getField(r.p.id, 'outfit', 'topwear');
  assert.ok(v === undefined || v === '', `editing a non-tail message must not change state, got: ${JSON.stringify(v)}`);
});

test('MESSAGE_EDITED on a middle AI message (trailing user msg) does NOT re-run auto-update', async () => {
  // Exact user repro: layout <user> <AI gen> <user> (a later generation was deleted).
  // Editing the middle AI generation must not re-run the pipeline — that was leaking
  // re-extracted state from the edited message.
  const r = mkRig();
  r.chat.length = 0;
  r.chat.push({ mes: 'I walk in.', is_user: true });
  r.chat.push({ extra: { trackerMsgId: 'm-1' }, mes: 'The room is quiet.', is_user: false });
  r.chat.push({ mes: 'I look around.', is_user: true });
  r.set(`NONE`);
  await r.emit('MR', 1); // process the AI message at index 1
  // Edit that AI message (index 1) — NOT the tail (index 2 is a user message).
  r.set(`SET Lyra outfit.topwear = "red dress"`);
  await r.emit('MED', 1);
  const v = r.eng.getField(r.p.id, 'outfit', 'topwear');
  assert.ok(v === undefined || v === '', `editing a middle AI message must not change state, got: ${JSON.stringify(v)}`);
});

test('MESSAGE_EDITED on the tail message does NOT re-derive (editing is a prose tweak)', async () => {
  const r = mkRig();
  r.set(`NONE`);
  await r.emit('MR', 0); // process the only/tail message m-1
  // Editing the tail message must NOT re-derive, even though its content now sets a dress.
  r.set(`SET Lyra outfit.topwear = "red dress"`);
  await r.emit('MED', 0); // index 0 IS the tail (chat length 1)
  const v = r.eng.getField(r.p.id, 'outfit', 'topwear');
  assert.ok(v === undefined || v === '', `editing the tail must not change state, got: ${JSON.stringify(v)}`);
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
