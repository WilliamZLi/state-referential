import { test } from 'node:test';
import assert from 'node:assert';
import { insertSyntheticAfter, actCompleteMarker, restoreArchive } from '../../src/pipeline/MainlineOps.js';
import { readTrackerMsgId } from '../../src/util/id.js';

function mkShell(chat, meta = {}) {
  const calls = [];
  return {
    calls,
    meta,
    shell: {
      getChat: () => chat,
      getMeta: () => meta,
      saveChat: async () => calls.push(['save']),
      reloadChat: async () => calls.push(['reload']),
      emit: async (name, i) => calls.push(['emit', name, i]),
      eventTypes: { MESSAGE_RECEIVED: 'MR' },
    },
  };
}

test('inserts after the target then saves, emits MESSAGE_RECEIVED, and reloads in order', async () => {
  const chat = [{ state_referential_msgId: 'm-1', mes: 'a', extra: {} }];
  const { shell, calls } = mkShell(chat);
  const { index } = await insertSyntheticAfter(shell, {
    afterTrackerMsgId: 'm-1', kind: 'act-complete', mes: 'done',
  });
  assert.equal(index, 1);
  assert.equal(chat[1].mes, 'done');
  assert.deepEqual(calls, [['save'], ['emit', 'MR', 1], ['reload']]);
});

test('actCompleteMarker summarizes over the chat, persists before inserting, and marks the mainline', async () => {
  const chat = [
    { state_referential_msgId: 'm-1', mes: 'a', extra: {} },
    { state_referential_msgId: 'm-2', mes: 'b', extra: {} },
  ];
  const { shell, calls } = mkShell(chat);
  const chronicleCalls = [];
  const chronicleOps = { actComplete: async (title, opts) => { chronicleCalls.push([title, opts]); return { title, body: 'Chronicle body.' }; } };
  const persistChronicle = async () => { calls.push(['persist']); };
  let injectionRuns = 0;
  const chronicleInjection = { run: () => { injectionRuns++; } };

  const entry = await actCompleteMarker({ shell, chronicleOps, persistChronicle, chronicleInjection }, { title: 'Act I' });

  assert.equal(entry.title, 'Act I');
  assert.equal(chronicleCalls[0][0], 'Act I');
  assert.equal(chronicleCalls[0][1].msgId, 'm-2', 'chronicle entry anchored to latest msg');
  assert.equal(chronicleCalls[0][1].messages, chat, 'must summarize over the chat, not an empty list');
  assert.deepEqual(calls, [['persist'], ['save'], ['emit', 'MR', 2], ['reload']], 'persist must precede the insert reload');
  assert.equal(injectionRuns, 1);
  const marker = chat[chat.length - 1];
  assert.equal(marker.extra.l3Kind, 'act-complete');
  assert.equal(marker.extra.l3Title, 'Act I');
  // Header + the summary, shown inline; summary also kept on extra.l3Body.
  assert.equal(marker.mes, '✓ Act complete: Act I\n\nChronicle body.');
  assert.equal(marker.extra.l3Body, 'Chronicle body.');
  // Normal message (NOT small-sys) so ST keeps the hide/edit/delete controls.
  assert.equal(marker.extra.isSmallSys, undefined);
});

test('restoreArchive replaces the compaction-block with its archived messages', async () => {
  const chat = [
    { state_referential_msgId: 'k', mes: 'keep', extra: {} },
    { state_referential_msgId: 'blk', mes: 'summary', extra: { from: 'state-referential', l3Kind: 'compaction', l3ArchiveId: 'arch-1' } },
    { state_referential_msgId: 'tail', mes: 'tail', extra: {} },
  ];
  const meta = { l3Archives: { 'arch-1': { archiveId: 'arch-1', messages: [
    { state_referential_msgId: 'o1', mes: 'orig 1', extra: {} },
    { state_referential_msgId: 'o2', mes: 'orig 2', extra: {} },
  ] } } };
  const { shell } = mkShell(chat, meta);

  const res = await restoreArchive(shell, 'arch-1');

  assert.equal(res.restored, true);
  assert.equal(res.count, 2);
  assert.deepEqual(chat.map(m => m.mes), ['keep', 'orig 1', 'orig 2', 'tail']);
});

test('restoreArchive returns {restored:false} for an unknown id', async () => {
  const { shell } = mkShell([], { l3Archives: {} });
  const res = await restoreArchive(shell, 'nope');
  assert.equal(res.restored, false);
});

test('restoreArchive saves and reloads but does NOT emit MESSAGE_RECEIVED', async () => {
  const chat = [
    { state_referential_msgId: 'blk', mes: 'summary', extra: { l3Kind: 'compaction', l3ArchiveId: 'arch-2' } },
  ];
  const meta = { l3Archives: { 'arch-2': { archiveId: 'arch-2', messages: [
    { state_referential_msgId: 'x1', mes: 'x1', extra: {} },
  ] } } };
  const { shell, calls } = mkShell(chat, meta);
  await restoreArchive(shell, 'arch-2');
  assert.deepEqual(calls, [['save'], ['reload']]);
});
