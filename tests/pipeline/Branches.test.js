import { test } from 'node:test';
import assert from 'node:assert';
import { splitForSeed, buildBranchMeta, isBranchOpen, addBranchRecord, setBranchStatus, playRange, foldbackAnchorId, buildFoldbackMarker } from '../../src/pipeline/Branches.js';

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

test('buildFoldbackMarker builds a fold-back synthetic-message descriptor', () => {
  const m = buildFoldbackMarker({ title: 'Dungeon', recap: 'They fought and won.', branchChatId: 'c1', playCount: 3 });
  assert.equal(m.kind, 'fold-back');
  assert.equal(m.smallSys, false);
  assert.equal(m.name, '↳ Folded from branch: Dungeon (3 msgs)');
  assert.match(m.mes, /Folded from branch: Dungeon/);
  assert.match(m.mes, /They fought and won\./);
  assert.deepEqual(m.extra, { l3BranchChatId: 'c1', l3BranchTitle: 'Dungeon' });
});

test('buildFoldbackMarker singularizes a one-message count', () => {
  const m = buildFoldbackMarker({ title: 'X', recap: 'r', branchChatId: 'c', playCount: 1 });
  assert.match(m.name, /\(1 msg\)/);
});
