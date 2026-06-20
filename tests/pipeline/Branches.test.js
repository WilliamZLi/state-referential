import { test } from 'node:test';
import assert from 'node:assert';
import { splitForSeed, buildBranchMeta, isBranchOpen, addBranchRecord, setBranchStatus, playRange, foldbackAnchorId, buildFoldbackMarker, sceneChatName } from '../../src/pipeline/Branches.js';

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

test('buildBranchMeta carries all fields (no seed/purpose — branches are seamless)', () => {
  const m = buildBranchMeta({ mainlineChatId: 'main', branchFromMessageId: 'x', snapshotKey: 'snap', title: 'Dungeon', lastN: 10, seedMessageCount: 12, now: 1700 });
  assert.deepEqual(m, { mainlineChatId: 'main', branchFromMessageId: 'x', snapshotKey: 'snap', title: 'Dungeon', lastN: 10, seedMessageCount: 12, createdAt: 1700 });
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

test('playRange returns the branch messages after seedMessageCount', () => {
  const branch = [{ mes: 'seed0' }, { mes: 'seed1' }, { mes: 'play0' }, { mes: 'play1' }];
  assert.deepEqual(playRange(branch, { seedMessageCount: 2 }).map(m => m.mes), ['play0', 'play1']);
});

test('playRange: a branch that never advanced → empty', () => {
  assert.deepEqual(playRange([{ mes: 'seed0' }, { mes: 'seed1' }], { seedMessageCount: 2 }), []);
});

test('playRange: missing seedMessageCount → whole chat', () => {
  assert.deepEqual(playRange([{ mes: 'a' }], {}).map(m => m.mes), ['a']);
  assert.deepEqual(playRange(null, undefined), []);
});

test('foldbackAnchorId returns the branch point when present in the mainline', () => {
  const main = [{ state_referential_msgId: 'a' }, { state_referential_msgId: 'b' }];
  assert.equal(foldbackAnchorId(main, 'a'), 'a');
});

test('foldbackAnchorId falls back to the last message id on drift (branch point gone)', () => {
  const main = [{ state_referential_msgId: 'a' }, { state_referential_msgId: 'b' }];
  assert.equal(foldbackAnchorId(main, 'gone'), 'b');
});

test('foldbackAnchorId: empty mainline → null', () => {
  assert.equal(foldbackAnchorId([], 'a'), null);
  assert.equal(foldbackAnchorId(null, null), null);
});

test('buildFoldbackMarker is a clean recap — no fold-back label in name or mes', () => {
  const m = buildFoldbackMarker({ title: 'Dungeon', recap: 'They fought and won.', branchChatId: 'c1', name: 'Cersia' });
  assert.equal(m.kind, 'fold-back');
  assert.equal(m.smallSys, false);
  assert.equal(m.mes, 'They fought and won.');      // recap only — no header line
  assert.equal(m.name, 'Cersia');                    // narration author, not a meta-label
  assert.doesNotMatch(m.mes, /Folded from branch/);
  assert.deepEqual(m.extra, { l3BranchChatId: 'c1', l3BranchTitle: 'Dungeon' }); // branch link kept (invisible)
});

test('buildFoldbackMarker defaults name to Narrator', () => {
  assert.equal(buildFoldbackMarker({ title: 'X', recap: 'r', branchChatId: 'c' }).name, 'Narrator');
});

test('sceneChatName composes "<mainline> - scene - <timestamp>" reusing the auto timestamp', () => {
  assert.equal(
    sceneChatName('CersiaWorld', 'Assistant - 2026-06-19@01h13m36s994ms'),
    'CersiaWorld - scene - 2026-06-19@01h13m36s994ms',
  );
});

test('sceneChatName falls back to the whole auto name when it has no " - " separator', () => {
  assert.equal(sceneChatName('Main', 'weirdname'), 'Main - scene - weirdname');
});
