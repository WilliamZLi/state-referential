import { test } from 'node:test';
import assert from 'node:assert';
import { splitForSeed, seedPromptForPurpose, buildBranchMeta, isBranchOpen, addBranchRecord, setBranchStatus } from '../../src/pipeline/Branches.js';

const chat = (n) => Array.from({ length: n }, (_, i) => ({ mes: `m${i}` }));

test('splitForSeed puts the last N in verbatim and the rest in toRecap', () => {
  const r = splitForSeed(chat(5), 2);
  assert.deepEqual(r.toRecap.map(m => m.mes), ['m0', 'm1', 'm2']);
  assert.deepEqual(r.verbatim.map(m => m.mes), ['m3', 'm4']);
});

test('splitForSeed: chat shorter than N → no recap, all verbatim', () => {
  const r = splitForSeed(chat(2), 5);
  assert.deepEqual(r.toRecap, []);
  assert.deepEqual(r.verbatim.map(m => m.mes), ['m0', 'm1']);
});

test('seedPromptForPurpose returns a non-empty string per known purpose and a generic default otherwise', () => {
  for (const p of ['exploratory', 'combat', 'social', 'flashback', 'time-skip']) {
    assert.ok(seedPromptForPurpose(p).length > 0);
  }
  assert.ok(seedPromptForPurpose('???').length > 0);
});

test('buildBranchMeta carries all fields', () => {
  const m = buildBranchMeta({ mainlineChatId: 'main', branchFromMessageId: 'x', snapshotKey: 'snap', title: 'Dungeon', purpose: 'combat', lastN: 10, seedMessageCount: 12, now: 1700 });
  assert.deepEqual(m, { mainlineChatId: 'main', branchFromMessageId: 'x', snapshotKey: 'snap', title: 'Dungeon', purpose: 'combat', lastN: 10, seedMessageCount: 12, createdAt: 1700 });
});

test('isBranchOpen reflects world.openBranchChatId', () => {
  assert.equal(isBranchOpen({}), false);
  assert.equal(isBranchOpen({ openBranchChatId: 'c1' }), true);
});

test('addBranchRecord + setBranchStatus maintain world.branches', () => {
  const w = {};
  addBranchRecord(w, { chatId: 'c1', title: 'D', status: 'open', branchFromMessageId: 'x', createdAt: 1 });
  assert.equal(w.branches.length, 1);
  setBranchStatus(w, 'c1', 'discarded', { discardedAt: 2 });
  assert.equal(w.branches[0].status, 'discarded');
  assert.equal(w.branches[0].discardedAt, 2);
});
