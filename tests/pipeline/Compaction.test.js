import { test } from 'node:test';
import assert from 'node:assert';
import { Compaction } from '../../src/pipeline/Compaction.js';
import { getArchive } from '../../src/pipeline/ArchiveStore.js';

function mkChat() {
  const chat = [];
  for (let i = 0; i < 6; i++) chat.push({ state_referential_msgId: `m${i}`, mes: `line ${i}`, extra: {} });
  chat.extra = {};
  return chat;
}

function mkDeps(chat) {
  const emitted = [];
  const dropped = [];
  let n = 0;
  return {
    deps: {
      getChat: () => chat,
      saveChat: async () => {},
      reloadChat: async () => {},
      emit: async (name, ...a) => { emitted.push([name, ...a]); },
      eventTypes: { MESSAGE_RECEIVED: 'MR', MESSAGE_DELETED: 'MDEL' },
      generateSummary: async () => 'A terse summary.',
      dropSnapshots: (ids) => { dropped.push(...ids); },
      genId: () => `arch-${++n}`,
      settings: () => ({ recentWindow: 2, minSize: 2, tokenCap: 400 }),
      now: () => 1700,
    },
    emitted, dropped,
  };
}

test('compacts the oldest run into a single compaction-block and drops their snapshots', async () => {
  const chat = mkChat();
  const { deps, dropped } = mkDeps(chat);
  const res = await new Compaction(deps).run();

  assert.equal(res.compacted, true);
  assert.equal(chat.length, 3);
  assert.equal(chat[0].extra.l3Kind, 'compaction');
  assert.equal(chat[0].mes, 'A terse summary.');
  assert.equal(chat[0].extra.l3ArchiveId, res.archiveId);
  assert.equal(chat[1].mes, 'line 4');
  assert.deepEqual(dropped, ['m0', 'm1', 'm2', 'm3']);
  // The archive must actually hold the verbatim pre-compaction messages.
  const archive = getArchive(chat, res.archiveId);
  assert.equal(archive.messages.length, 4);
  assert.equal(archive.messages[0].mes, 'line 0');
  assert.equal(archive.messages[3].mes, 'line 3');
  // The returned blockMsgId must match the inserted block's id.
  assert.equal(res.blockMsgId, chat[0].state_referential_msgId);
});

test('NEVER emits MESSAGE_DELETED (would trigger Layer 1 restore)', async () => {
  const chat = mkChat();
  const { deps, emitted } = mkDeps(chat);
  await new Compaction(deps).run();
  // Compaction must be event-SILENT: it mutates the array and relies on
  // reloadChat(), never emitting per-message events. Asserting zero emissions
  // is a regression tripwire if anyone later wires emit() into the orchestrator.
  assert.equal(emitted.length, 0, 'compaction must not emit any events');
  assert.equal(emitted.some(e => e[0] === 'MDEL'), false);
});

test('returns {compacted:false} when nothing is eligible', async () => {
  const chat = mkChat().slice(0, 2); chat.extra = {};
  const { deps } = mkDeps(chat);
  const res = await new Compaction(deps).run();
  assert.equal(res.compacted, false);
});

test('manual count caps how many messages are compacted', async () => {
  const chat = mkChat();
  const { deps } = mkDeps(chat);
  const res = await new Compaction(deps).run({ count: 2 });
  assert.equal(res.compacted, true);
  assert.equal(chat.length, 5);
});
