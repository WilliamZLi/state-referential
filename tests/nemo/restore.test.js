import { test } from 'node:test';
import assert from 'node:assert';
import { NemoCompaction } from '../../src/nemo/compaction.js';
import { getNemoState, liveChapters, buildSlotText } from '../../src/nemo/state.js';
import { resolveNemoSettings } from '../../src/nemo/settings.js';
import { restoreChapter, unfoldLatest, restoreAll } from '../../src/nemo/restore.js';
import { msg, chat20, deps } from './fixtures.js';

const foldAlways = () => ({ ...resolveNemoSettings(), keepRecaps: 0 });
const mesOf = chat => chat.map(m => m.mes);

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

test('a missing marker is not-found and the chat is unchanged', async () => {
  const { chat, d } = await twoChapters();
  const st = getNemoState(d.meta);
  const at = chat.findIndex(m => m.extra?.nemoChapterId === st.chapters[1].id);
  chat.splice(at, 1);
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
