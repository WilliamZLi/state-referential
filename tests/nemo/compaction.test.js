import { test } from 'node:test';
import assert from 'node:assert';
import { NemoCompaction } from '../../src/nemo/compaction.js';
import { getNemoState } from '../../src/nemo/state.js';
import { resolveNemoSettings } from '../../src/nemo/settings.js';
import { getArchive } from '../../src/pipeline/ArchiveStore.js';

let seq = 0;
const msg = (who, mes) => ({ name: who, is_user: who === 'u', is_system: false, mes, extra: {}, state_referential_msgId: `id-${++seq}` });
const chat20 = () => Array.from({ length: 20 }, (_, i) => msg(i % 2 === 0 ? 'u' : 'a', `m${i}`));

function deps(chat, over = {}) {
  let n = 0;
  const d = {
    meta: {}, saved: false, reloaded: false,
    getChat: () => chat,
    getMeta: () => d.meta,
    saveChat: async () => { d.saved = true; },
    reloadChat: async () => { d.reloaded = true; },
    summarize: async () => 'R'.repeat(500),
    consent: () => [],
    settings: () => resolveNemoSettings(),
    genId: () => `gen-${++n}`,
    now: () => 1234,
    waitForIdle: async () => {},
    ...over,
  };
  return d;
}

test('compacts the older region into one hidden-marker chapter; keeps the last 12', async () => {
  const chat = chat20(); const d = deps(chat); const r = await new NemoCompaction(d).compactNow();
  assert.deepStrictEqual(r, { compacted: true, chapters: 1, folded: false, messages: 8 });
  assert.equal(chat.length, 13); assert.equal(chat[0].is_system, true); assert.equal(chat[0].extra.l3Kind, 'nemo-chapter');
  assert.equal(chat[0].extra.isSmallSys, undefined);
  const st = getNemoState(d.meta); assert.equal(st.chapters.length, 1); assert.equal(st.chapters[0].count, 8);
  assert.equal(st.chapters[0].status, 'live'); assert.equal(st.chapters[0].createdAt, 1234);
  assert.equal(st.chapters[0].recap, 'R'.repeat(500));
  assert.equal(chat[0].extra.nemoChapterId, st.chapters[0].id);
  assert.equal(chat[0].extra.l3ArchiveId, st.chapters[0].archiveId);
  assert.equal(getArchive(d.meta, st.chapters[0].archiveId).messages.length, 8); assert.ok(d.saved && d.reloaded);
});
test('hidden messages stay in place after the marker and stay out of the archive', async () => {
  const chat = chat20(); chat[3].is_system = true; const hiddenMes = chat[3].mes; const d = deps(chat);
  await new NemoCompaction(d).compactNow();
  assert.equal(chat[1].mes, hiddenMes); assert.equal(chat[1].is_system, true);
  const a = getArchive(d.meta, getNemoState(d.meta).chapters[0].archiveId);
  assert.equal(a.messages.length, 7); assert.deepStrictEqual(a.sequence[3], { kind: 'hidden', id: chat[1].state_referential_msgId });
});
test('an invalid summary aborts with the chat unchanged', async () => {
  const chat = chat20(); const before = structuredClone(chat); const d = deps(chat, { summarize: async () => 'short' });
  assert.deepStrictEqual(await new NemoCompaction(d).compactNow(), { compacted: false, chapters: 0, folded: false, messages: 0, reason: 'summary-failed' });
  assert.deepStrictEqual(chat, before); assert.ok(!d.saved);
});
test('waits for idle; messages appended meanwhile are never compacted', async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => { chat.push(msg('u', 'late1'), msg('a', 'late2')); } });
  await new NemoCompaction(d).compactNow();
  assert.deepStrictEqual(chat.slice(-2).map(m => m.mes), ['late1', 'late2']); assert.equal(getNemoState(d.meta).chapters[0].count, 8);
});
test('discards when the range changed during summarizing', async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => { chat[3] = msg('a', 'edited'); } });
  const r = await new NemoCompaction(d).compactNow();
  assert.deepStrictEqual(r, { compacted: false, chapters: 0, folded: false, messages: 0, reason: 'changed' });
  assert.equal(chat.length, 20); assert.equal(getNemoState(d.meta).chapters.length, 0); assert.ok(!d.saved);
});
test('discards when the user hides a message in the range during summarizing', async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => { chat[5].is_system = true; } });
  const r = await new NemoCompaction(d).compactNow();
  assert.equal(r.reason, 'changed'); assert.equal(chat.length, 20); assert.equal(chat[5].is_system, true);
  assert.equal(getNemoState(d.meta).chapters.length, 0); assert.deepStrictEqual(d.meta.l3Archives ?? {}, {}); assert.ok(!d.saved);
});
test('nothing eligible gives no-eligible-range and leaves chat alone; isBusy is false before and after', async () => {
  const chat = chat20().slice(0, 4); const before = structuredClone(chat); const d = deps(chat);
  const c = new NemoCompaction(d);
  assert.equal(c.isBusy(), false);
  const r = await c.compactNow();
  assert.deepStrictEqual(r, { compacted: false, chapters: 0, folded: false, messages: 0, reason: 'no-eligible-range' });
  assert.equal(c.isBusy(), false); assert.deepStrictEqual(chat, before); assert.ok(!d.saved);
});
test('isBusy is true during summarize and waitForIdle, false after', async () => {
  const chat = chat20(); let c; const seen = [];
  const d = deps(chat, { summarize: async () => { seen.push(c.isBusy()); return 'R'.repeat(500); }, waitForIdle: async () => { seen.push(c.isBusy()); } });
  c = new NemoCompaction(d); await c.compactNow();
  assert.deepStrictEqual(seen, [true, true]); assert.equal(c.isBusy(), false);
});
test('multiple runs apply newest-first and chapters are stored chronologically', async () => {
  const chat = chat20(); chat[3].extra = { from: 'state-referential', l3Kind: 'x' }; // our marker splits runs
  const d = deps(chat); let k = 0; d.summarize = async () => 'R'.repeat(500) + (++k);
  const r = await new NemoCompaction(d).compactNow();
  assert.equal(r.chapters, 2); assert.equal(r.messages, 7);
  const st = getNemoState(d.meta);
  assert.ok(st.chapters[0].recap.endsWith('1')); assert.ok(st.chapters[1].recap.endsWith('2'));
  assert.equal(chat[0].extra.nemoChapterId, st.chapters[0].id);
});
