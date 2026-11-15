import { test } from 'node:test';
import assert from 'node:assert';
import { NemoCompaction } from '../../src/nemo/compaction.js';
import { getNemoState, liveChapters, buildSlotText } from '../../src/nemo/state.js';
import { resolveNemoSettings } from '../../src/nemo/settings.js';
import { restoreChapter, unfoldLatest, restoreAll, unfoldAndRestore, dropChapter } from '../../src/nemo/restore.js';
import { getArchive } from '../../src/pipeline/ArchiveStore.js';
import { msg, chat20, deps, seedChapters } from './fixtures.js';

const foldAlways = () => ({ ...resolveNemoSettings(), keepRecaps: 0 });
const mesOf = chat => chat.map(m => m.mes);
const idOf = m => m.state_referential_msgId;
const markerAt = (chat, id) => chat.findIndex(m => m.extra?.nemoChapterId === id);
const eight = p => [0, 1, 2, 3, 4, 5, 6, 7].map(i => msg(i % 2 === 0 ? 'u' : 'a', `${p}${i}`));

async function compactedWithHidden(hideAt, over = {}) {
  const chat = chat20();
  if (hideAt !== null) chat[hideAt].is_system = true;
  const original = structuredClone(chat);
  const d = deps(chat, over);
  await new NemoCompaction(d).compactNow();
  return { chat, d, original };
}

// Two chapters: first covers m0..m7 (m3 hidden), second covers m8..m15 (m10 hidden).
async function twoChapters(over = {}) {
  const chat = chat20(); chat[3].is_system = true;
  const d = deps(chat, over);
  await new NemoCompaction(d).compactNow();
  const extra = [0, 1, 2, 3, 4, 5, 6, 7].map(i => msg(i % 2 === 0 ? 'u' : 'a', `x${i}`));
  chat.push(...extra);
  chat.find(m => m.mes === 'm10').is_system = true;
  const original = [...chat20().map(m => ({ mes: m.mes })), ...extra.map(m => ({ mes: m.mes }))];
  await new NemoCompaction(d).compactNow();
  return { chat, d, original };
}

test('restore puts messages back in order around a hidden message', async () => {
  const { chat, d, original } = await compactedWithHidden(3);
  const id = getNemoState(d.meta).chapters[0].id;
  d.saved = d.reloaded = false;
  assert.deepStrictEqual(await restoreChapter(d, id), { restored: true, count: 1 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(chat[3].is_system, true);
  assert.equal(getNemoState(d.meta).chapters.length, 0);
  assert.equal(buildSlotText(getNemoState(d.meta)), '');
  assert.ok(d.saved && d.reloaded);
});

test('restoring an older chapter also restores the newer ones', async () => {
  const { chat, d, original } = await twoChapters();
  const st = getNemoState(d.meta);
  assert.equal(st.chapters.length, 2);
  const r = await restoreChapter(d, st.chapters[0].id);
  assert.deepStrictEqual(r, { restored: true, count: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(chat.find(m => m.mes === 'm3').is_system, true);
  assert.equal(chat.find(m => m.mes === 'm10').is_system, true);
  assert.equal(getNemoState(d.meta).chapters.length, 0);
  assert.ok(!chat.some(m => m.extra?.nemoChapterId));
});

test('restoring only the newest chapter leaves the older one in place', async () => {
  const { chat, d } = await twoChapters();
  const st = getNemoState(d.meta);
  const firstId = st.chapters[0].id;
  const r = await restoreChapter(d, st.chapters[1].id);
  assert.deepStrictEqual(r, { restored: true, count: 1 });
  assert.equal(getNemoState(d.meta).chapters.length, 1);
  assert.equal(chat[0].extra.nemoChapterId, firstId);
  assert.equal(chat.filter(m => m.extra?.nemoChapterId).length, 1);
});

test('a hidden message deleted before restore is skipped', async () => {
  const { chat, d, original } = await compactedWithHidden(3);
  chat.splice(1, 1);
  await restoreChapter(d, getNemoState(d.meta).chapters[0].id);
  assert.deepStrictEqual(mesOf(chat), mesOf(original.filter((_, i) => i !== 3)));
});

test('a folded chapter reports unfolds needed; unfoldLatest reverts the fold', async () => {
  const { chat, d } = await compactedWithHidden(null, { settings: foldAlways });
  const st = getNemoState(d.meta);
  const c = st.chapters[0];
  assert.equal(c.status, 'folded');
  assert.deepStrictEqual(await restoreChapter(d, c.id), { restored: false, reason: 'folded', unfoldsNeeded: 1 });
  assert.equal(chat.length, 13);
  assert.deepStrictEqual(await unfoldLatest(d), { unfolded: true });
  assert.equal(c.status, 'live');
  assert.equal(st.earlier, null);
  assert.equal(st.folds.length, 0);
  assert.equal(chat[0].mes, 'Compacted 8 messages');
  assert.equal(liveChapters(st).length, 1);
});

test('unfoldsNeeded counts the folds above the containing one', async () => {
  const { d } = await twoChapters({ settings: foldAlways });
  const st = getNemoState(d.meta);
  assert.equal(st.folds.length, 2);
  const r = await restoreChapter(d, st.chapters[0].id);
  assert.deepStrictEqual(r, { restored: false, reason: 'folded', unfoldsNeeded: 2 });
});

test('unfoldLatest restores prevEarlier text from the previous fold', async () => {
  const { d } = await twoChapters({ settings: foldAlways });
  const st = getNemoState(d.meta);
  const prev = st.folds[1].prevEarlier;
  assert.ok(prev);
  await unfoldLatest(d);
  assert.deepStrictEqual(st.earlier, { text: prev });
  assert.equal(st.folds.length, 1);
  assert.equal(st.chapters[1].status, 'live');
  assert.equal(st.chapters[0].status, 'folded');
});

test('restoreAll returns the chat to fully verbatim', async () => {
  const { chat, d, original } = await compactedWithHidden(3, { settings: foldAlways });
  let saves = 0; let reloads = 0;
  d.saveChat = async () => { saves++; }; d.reloadChat = async () => { reloads++; };
  assert.deepStrictEqual(await restoreAll(d), { restored: 1 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  const st = getNemoState(d.meta);
  assert.equal(st.chapters.length, 0); assert.equal(st.folds.length, 0); assert.equal(st.earlier, null);
  assert.equal(saves, 1); assert.equal(reloads, 1);
});

test('restoreAll handles several chapters and folds in one save', async () => {
  const { chat, d, original } = await twoChapters({ settings: foldAlways });
  let saves = 0;
  d.saveChat = async () => { saves++; };
  assert.deepStrictEqual(await restoreAll(d), { restored: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(saves, 1);
});

test('an unknown chapter id is not-found and changes nothing', async () => {
  const { chat, d } = await compactedWithHidden(null);
  const before = structuredClone(chat);
  d.saved = false;
  assert.deepStrictEqual(await restoreChapter(d, 'nope'), { restored: false, reason: 'not-found' });
  assert.deepStrictEqual(chat, before); assert.ok(!d.saved);
});

test('a missing marker with no anchor and no newer chapter is not-found and the chat is unchanged', async () => {
  const { chat, d } = await twoChapters();
  const st = getNemoState(d.meta);
  chat.splice(markerAt(chat, st.chapters[1].id), 1);
  chat.splice(chat.findIndex(m => idOf(m) === st.chapters[1].anchorId), 1);
  const before = structuredClone(chat);
  d.saved = false;
  assert.deepStrictEqual(await restoreChapter(d, st.chapters[0].id), { restored: false, reason: 'not-found' });
  assert.deepStrictEqual(chat, before);
  assert.equal(st.chapters.length, 2); assert.ok(!d.saved);
});

test('unfoldLatest with no folds does nothing', async () => {
  const { d } = await compactedWithHidden(null);
  d.saved = false;
  assert.deepStrictEqual(await unfoldLatest(d), { unfolded: false });
  assert.ok(!d.saved);
});

test('restoreAll on an empty state returns 0 without saving', async () => {
  const d = deps(chat20());
  assert.deepStrictEqual(await restoreAll(d), { restored: 0 });
  assert.ok(!d.saved && !d.reloaded);
});

// --- Final-review fix wave: anchors (I3), archive deletion (I5), unfoldAndRestore (M11), idle handshake (I2), no-op state (M2) ---
test('a deleted marker: restore goes back via the anchor, in the original order', async () => {
  const { chat, d, original } = await compactedWithHidden(3);
  const c = getNemoState(d.meta).chapters[0];
  assert.equal(c.anchorId, idOf(original[8]));
  chat.splice(markerAt(chat, c.id), 1);
  assert.deepStrictEqual(await restoreChapter(d, c.id), { restored: true, count: 1 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(chat[3].is_system, true);
});

test('the newest marker deleted: restoring the older chapter places both via marker and anchor, in order', async () => {
  const { chat, d, original } = await twoChapters();
  const st = getNemoState(d.meta);
  chat.splice(markerAt(chat, st.chapters[1].id), 1);
  assert.deepStrictEqual(await restoreChapter(d, st.chapters[0].id), { restored: true, count: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.ok(!chat.some(m => m.extra?.nemoChapterId));
});

test('marker and anchor deleted, a newer marker present: restored right before it', async () => {
  const chat = chat20(); chat[8].is_system = true; // hidden, stays in the chat: chapter 1's anchor
  const d = deps(chat);
  await new NemoCompaction(d).compactNow();
  chat.push(...eight('x'));
  await new NemoCompaction(d).compactNow();
  const [a, b] = getNemoState(d.meta).chapters;
  assert.equal(a.anchorId, idOf(chat.find(m => m.mes === 'm8')));
  chat.splice(markerAt(chat, a.id), 1);
  chat.splice(chat.findIndex(m => idOf(m) === a.anchorId), 1);
  assert.equal(markerAt(chat, b.id), 0);
  assert.deepStrictEqual(await restoreChapter(d, a.id), { restored: true, count: 2 });
  const expected = [...Array.from({ length: 20 }, (_, i) => `m${i}`).filter(x => x !== 'm8'), ...eight('x').map(m => m.mes)];
  assert.deepStrictEqual(mesOf(chat), expected);
});

test('an older marker deleted after its anchor was compacted into a newer chapter: placed before that chapter, hidden messages re-interleaved', async () => {
  const { chat, d, original } = await twoChapters();
  const [a] = getNemoState(d.meta).chapters;
  assert.ok(!chat.some(m => idOf(m) === a.anchorId));
  chat.splice(markerAt(chat, a.id), 1);
  assert.deepStrictEqual(await restoreAll(d), { restored: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(chat.find(m => m.mes === 'm3').is_system, true);
});

test("restore deletes the restored chapters' archives and keeps the others", async () => {
  const { d } = await twoChapters();
  const st = getNemoState(d.meta); const [a, b] = st.chapters;
  await restoreChapter(d, b.id);
  assert.equal(getArchive(d.meta, b.archiveId), undefined);
  assert.ok(getArchive(d.meta, a.archiveId));
  await restoreChapter(d, a.id);
  assert.equal(getArchive(d.meta, a.archiveId), undefined);
});

test('a failed (not-found) restore keeps every archive', async () => {
  const { chat, d } = await twoChapters();
  const st = getNemoState(d.meta);
  chat.splice(markerAt(chat, st.chapters[1].id), 1);
  chat.splice(chat.findIndex(m => idOf(m) === st.chapters[1].anchorId), 1);
  const before = structuredClone(d.meta.l3Archives);
  assert.equal((await restoreChapter(d, st.chapters[0].id)).reason, 'not-found');
  assert.equal((await restoreAll(d)).restored, 0);
  assert.deepStrictEqual(d.meta.l3Archives, before);
});

test('restoreAll deletes every restored archive', async () => {
  const { d } = await twoChapters({ settings: foldAlways });
  await restoreAll(d);
  assert.deepStrictEqual(d.meta.l3Archives, {});
});

const countedSummaries = () => { let k = 0; return async () => 'R'.repeat(500) + (++k); };

test('unfoldAndRestore: unfolds and restores a folded chapter with one save and one reload', async () => {
  const { chat, d, original } = await compactedWithHidden(3, { settings: foldAlways });
  const st = getNemoState(d.meta); const c = st.chapters[0];
  let saves = 0; let reloads = 0;
  d.saveChat = async () => { saves++; }; d.reloadChat = async () => { reloads++; };
  assert.deepStrictEqual(await unfoldAndRestore(d, c.id), { restored: true, count: 1 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(st.chapters.length, 0); assert.equal(st.folds.length, 0); assert.equal(st.earlier, null);
  assert.equal(getArchive(d.meta, c.archiveId), undefined);
  assert.equal(saves, 1); assert.equal(reloads, 1);
});

test('unfoldAndRestore across two folds restores everything in one save', async () => {
  const { chat, d, original } = await twoChapters({ settings: foldAlways });
  let saves = 0; d.saveChat = async () => { saves++; };
  const st = getNemoState(d.meta);
  assert.equal(st.folds.length, 2);
  assert.deepStrictEqual(await unfoldAndRestore(d, st.chapters[0].id), { restored: true, count: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
  assert.equal(st.folds.length, 0); assert.equal(st.earlier, null); assert.equal(saves, 1);
});

test('unfoldAndRestore of the newest folded chapter undoes only the folds it needs', async () => {
  const { chat, d } = await twoChapters({ settings: foldAlways, summarize: countedSummaries() });
  const st = getNemoState(d.meta); const [a, b] = st.chapters; const prev = st.folds[1].prevEarlier;
  assert.notEqual(st.earlier.text, prev);
  assert.deepStrictEqual(await unfoldAndRestore(d, b.id), { restored: true, count: 1 });
  assert.deepStrictEqual(st.chapters.map(c => c.id), [a.id]); assert.equal(a.status, 'folded');
  assert.equal(st.folds.length, 1); assert.deepStrictEqual(st.earlier, { text: prev });
  assert.equal(chat.filter(m => m.extra?.nemoChapterId).length, 1);
});

test('unfoldAndRestore is all-or-nothing: an unplaceable chapter leaves folds, chat and archives untouched', async () => {
  const { chat, d } = await twoChapters({ settings: foldAlways });
  const st = getNemoState(d.meta); const [a, b] = st.chapters;
  chat.splice(markerAt(chat, b.id), 1);
  chat.splice(chat.findIndex(m => idOf(m) === b.anchorId), 1);
  const chatBefore = structuredClone(chat); const stBefore = structuredClone(st); const archBefore = structuredClone(d.meta.l3Archives);
  d.saved = false;
  assert.deepStrictEqual(await unfoldAndRestore(d, a.id), { restored: false, reason: 'not-found' });
  assert.deepStrictEqual(chat, chatBefore); assert.deepStrictEqual(st, stBefore);
  assert.deepStrictEqual(d.meta.l3Archives, archBefore); assert.ok(!d.saved);
});

test('unfoldAndRestore on a live chapter restores it and the newer ones; an unknown id is not-found', async () => {
  const { chat, d, original } = await twoChapters();
  assert.deepStrictEqual(await unfoldAndRestore(d, 'nope'), { restored: false, reason: 'not-found' });
  assert.deepStrictEqual(await unfoldAndRestore(d, getNemoState(d.meta).chapters[0].id), { restored: true, count: 2 });
  assert.deepStrictEqual(mesOf(chat), mesOf(original));
});

test('restore commit: a reply that starts during the save is waited out and saved again before the reload', async () => {
  const { d } = await compactedWithHidden(null);
  const log = [];
  d.saveChat = async () => { log.push('save'); }; d.reloadChat = async () => { log.push('reload'); };
  d.waitForIdle = async () => { log.push('wait'); return 'waited'; };
  await restoreChapter(d, getNemoState(d.meta).chapters[0].id);
  assert.deepStrictEqual(log, ['save', 'wait', 'save', 'reload']);
});

test('restore without a waitForIdle dep saves once, then reloads', async () => {
  const { d } = await compactedWithHidden(null);
  const log = [];
  const bare = { getChat: d.getChat, getMeta: d.getMeta, saveChat: async () => { log.push('save'); }, reloadChat: async () => { log.push('reload'); } };
  assert.equal((await restoreChapter(bare, getNemoState(d.meta).chapters[0].id)).restored, true);
  assert.deepStrictEqual(log, ['save', 'reload']);
});

test('dropChapter forgets a stranded chapter: state entry, archive, marker; hidden messages stay; saves', async () => {
  const { chat, d } = await compactedWithHidden(3);
  const st = getNemoState(d.meta); const c = st.chapters[0];
  d.saved = d.reloaded = false;
  assert.deepStrictEqual(await dropChapter(d, c.id), { dropped: true });
  assert.equal(st.chapters.length, 0); assert.equal(getArchive(d.meta, c.archiveId), undefined);
  assert.equal(markerAt(chat, c.id), -1);
  assert.equal(chat[0].mes, 'm3'); assert.equal(chat[0].is_system, true);
  assert.ok(d.saved && d.reloaded);
});

test('dropChapter removes the chapter from its fold, and removes a fold left empty', async () => {
  const d = deps(chat20()); const [s0, s1, s2] = seedChapters(d, 3); const st = getNemoState(d.meta);
  s0.status = s1.status = 'folded';
  st.folds.push({ id: 'f1', prevEarlier: null, chapterIds: [s0.id, s1.id], createdAt: 1 });
  st.earlier = { text: 'E1' };
  assert.deepStrictEqual(await dropChapter(d, s0.id), { dropped: true });
  assert.deepStrictEqual(st.chapters.map(c => c.id), [s1.id, s2.id]);
  assert.deepStrictEqual(st.folds.map(f => f.chapterIds), [[s1.id]]);
  assert.deepStrictEqual(st.earlier, { text: 'E1' });
  assert.equal(getArchive(d.meta, s0.archiveId), undefined); assert.equal(markerAt(d.getChat(), s0.id), -1);
  await dropChapter(d, s1.id);
  assert.equal(st.folds.length, 0); assert.equal(st.earlier, null);
  assert.deepStrictEqual(st.chapters.map(c => c.id), [s2.id]);
});

test('dropChapter emptying a lower fold hands its prevEarlier to the fold above, so unfolding still ends clean', async () => {
  const d = deps(chat20()); const [s0, s1] = seedChapters(d, 2); const st = getNemoState(d.meta);
  s0.status = s1.status = 'folded';
  st.folds.push({ id: 'f1', prevEarlier: null, chapterIds: [s0.id], createdAt: 1 }, { id: 'f2', prevEarlier: 'E1', chapterIds: [s1.id], createdAt: 2 });
  st.earlier = { text: 'E2' };
  await dropChapter(d, s0.id);
  assert.deepStrictEqual(st.folds.map(f => [f.id, f.prevEarlier]), [['f2', null]]);
  assert.deepStrictEqual(st.earlier, { text: 'E2' });
  await unfoldLatest(d);
  assert.equal(st.earlier, null); assert.equal(s1.status, 'live');
});

test('dropChapter on an unknown id changes nothing', async () => {
  const { chat, d } = await compactedWithHidden(null);
  const before = structuredClone(chat); d.saved = false;
  assert.deepStrictEqual(await dropChapter(d, 'nope'), { dropped: false });
  assert.deepStrictEqual(chat, before); assert.ok(!d.saved);
});

test('no-op restore paths on a fresh chat create no state and do not save', async () => {
  const ops = [d => restoreChapter(d, 'x'), d => unfoldLatest(d), d => restoreAll(d), d => unfoldAndRestore(d, 'x'), d => dropChapter(d, 'x')];
  for (const op of ops) {
    const d = deps(chat20()); await op(d);
    assert.deepStrictEqual(d.meta, {}); assert.ok(!d.saved && !d.reloaded);
  }
});

test("a chapter anchored on another chapter's marker is placed before it without clobbering it", async () => {
  const d = deps([]); const [p, q] = seedChapters(d, 2); const chat = d.getChat();
  chat.splice(markerAt(chat, q.id), 1);
  q.anchorId = idOf(chat[markerAt(chat, p.id)]);
  chat.push(msg('u', 'kept'));
  assert.deepStrictEqual(await restoreAll(d), { restored: 2 });
  assert.deepStrictEqual(mesOf(chat), ['s1a', 's1b', 's0a', 's0b', 'kept']);
});

test('placements that would overlap refuse the whole restore and change nothing', async () => {
  const d = deps([]); const [p, q] = seedChapters(d, 2); const chat = d.getChat();
  getArchive(d.meta, p.archiveId).sequence.push({ kind: 'hidden', id: 'h-1' });
  chat.splice(1, 0, { ...msg('u', 'H'), is_system: true, state_referential_msgId: 'h-1' }); // P's hidden message
  chat.splice(markerAt(chat, q.id), 1);
  q.anchorId = 'h-1'; // inside P's range [marker, H]
  const before = structuredClone(chat);
  assert.deepStrictEqual(await restoreAll(d), { restored: 0 });
  assert.deepStrictEqual(chat, before); assert.ok(!d.saved);
});
