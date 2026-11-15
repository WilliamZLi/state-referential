import { test } from 'node:test';
import assert from 'node:assert';
import { NemoCompaction } from '../../src/nemo/compaction.js';
import { getNemoState, liveChapters, buildSlotText } from '../../src/nemo/state.js';
import { resolveNemoSettings } from '../../src/nemo/settings.js';
import { buildSyntheticMessage } from '../../src/pipeline/L3Insert.js';
import { getArchive, saveNemoArchive } from '../../src/pipeline/ArchiveStore.js';
import { msg, chat20, deps, seedChapters, seqSummaries } from './fixtures.js';

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
test('isBusy is true during summarize and both waitForIdle calls, false after', async () => {
  const chat = chat20(); let c; const seen = [];
  const d = deps(chat, { summarize: async () => { seen.push(c.isBusy()); return 'R'.repeat(500); }, waitForIdle: async () => { seen.push(c.isBusy()); return 'idle'; } });
  c = new NemoCompaction(d); await c.compactNow();
  assert.deepStrictEqual(seen, [true, true, true]); assert.equal(c.isBusy(), false);
});

// --- Final-review fix wave: apply-time verification (I1), idle handshake (I2), minMessages (I4), no-op state (M2) ---
const unchangedNothingWritten = (r, chat, d) => {
  assert.deepStrictEqual(r, { compacted: false, chapters: 0, folded: false, messages: 0, reason: 'changed' });
  assert.equal(chat.length, 20); assert.ok(!d.saved && !d.reloaded); assert.deepStrictEqual(d.meta, {});
};
test('an in-place edit of a member mes during summarizing → changed, nothing written', async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => { chat[3].mes = 'edited in place'; return 'idle'; } });
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, d);
  assert.equal(chat[3].mes, 'edited in place');
});
test('a swipe on a member during summarizing → changed, nothing written', async () => {
  const chat = chat20(); chat[5].swipe_id = 0; chat[5].swipes = ['m5', 'alt'];
  const d = deps(chat, { waitForIdle: async () => { chat[5].swipe_id = 1; return 'idle'; } });
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, d);
});
test('a chat switch (getChatId changes) during summarizing → changed, nothing written', async () => {
  const chat = chat20(); let id = 'chat-1';
  const d = deps(chat, { getChatId: () => id, waitForIdle: async () => { id = 'chat-1 - Branch #2'; return 'idle'; } });
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, d);
});
test('a different metadata object at apply time → changed, nothing written to either', async () => {
  const chat = chat20(); const other = {};
  const d = deps(chat); const first = d.meta;
  d.waitForIdle = async () => { d.meta = other; return 'idle'; };
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, { ...d, meta: first });
  assert.deepStrictEqual(other, {});
});
test('toggling Nemo off during summarizing → changed, nothing written', async () => {
  const chat = chat20(); let on = true;
  const d = deps(chat, { isEnabled: () => on, waitForIdle: async () => { on = false; return 'idle'; } });
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, d);
});
test('deleting the 3 newest messages during summarizing → changed (run now reaches the kept window)', async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => { chat.splice(-3, 3); return 'idle'; } });
  const r = await new NemoCompaction(d).compactNow();
  assert.equal(r.reason, 'changed'); assert.equal(chat.length, 17); assert.ok(!d.saved); assert.deepStrictEqual(d.meta, {});
});
test("waitForIdle 'timeout' before apply → changed, nothing written", async () => {
  const chat = chat20(); const d = deps(chat, { waitForIdle: async () => 'timeout' });
  unchangedNothingWritten(await new NemoCompaction(d).compactNow(), chat, d);
});
test("a reply that starts during the save ('waited' on the second wait) → saved again before reload", async () => {
  const chat = chat20(); const log = []; let waits = 0;
  const d = deps(chat, {
    saveChat: async () => { log.push('save'); },
    reloadChat: async () => { log.push('reload'); },
    waitForIdle: async () => { waits++; log.push(`wait:${waits === 1 ? 'idle' : 'waited'}`); return waits === 1 ? 'idle' : 'waited'; },
  });
  assert.equal((await new NemoCompaction(d).compactNow()).compacted, true);
  assert.deepStrictEqual(log, ['wait:idle', 'save', 'wait:waited', 'save', 'reload']);
});
test("idle after the save → one save, then reload", async () => {
  const chat = chat20(); const log = [];
  const d = deps(chat, { saveChat: async () => { log.push('save'); }, reloadChat: async () => { log.push('reload'); } });
  await new NemoCompaction(d).compactNow();
  assert.deepStrictEqual(log, ['save', 'reload']);
});
test('minMessages: 8 eligible members with minMessages 12 → no-eligible-range, summarize never called', async () => {
  const chat = chat20(); const before = structuredClone(chat); const sum = seqSummaries(['R'.repeat(500)]);
  const d = deps(chat, { summarize: sum });
  const r = await new NemoCompaction(d).compactNow({ minMessages: 12 });
  assert.deepStrictEqual(r, { compacted: false, chapters: 0, folded: false, messages: 0, reason: 'no-eligible-range' });
  assert.equal(sum.calls.length, 0); assert.deepStrictEqual(chat, before); assert.ok(!d.saved); assert.deepStrictEqual(d.meta, {});
});
test('minMessages counts members across all runs; meeting it compacts', async () => {
  const chat = chat20(); chat[3].extra = { from: 'state-referential', l3Kind: 'x' }; // splits into runs of 3 + 4
  const d = deps(chat);
  assert.equal((await new NemoCompaction(d).compactNow({ minMessages: 8 })).reason, 'no-eligible-range');
  const r = await new NemoCompaction(d).compactNow({ minMessages: 7 });
  assert.equal(r.compacted, true); assert.equal(r.messages, 7);
});
test('no eligible range on a fresh chat leaves meta without nemoCompaction', async () => {
  const d = deps(chat20().slice(0, 4));
  await new NemoCompaction(d).compactNow();
  assert.equal(Object.prototype.hasOwnProperty.call(d.meta, 'nemoCompaction'), false);
});
test('a summary failure on a fresh chat leaves meta without nemoCompaction', async () => {
  const d = deps(chat20(), { summarize: async () => 'short' });
  assert.equal((await new NemoCompaction(d).compactNow()).reason, 'summary-failed');
  assert.deepStrictEqual(d.meta, {});
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

// --- Task 7: rolling Earlier history ---
test('the 5th chapter folds the oldest into Earlier history', async () => {
  const chat = chat20(); const d = deps(chat, { summarize: seqSummaries(['NEW'.repeat(200), 'FOLD'.repeat(200)]) });
  const oldest = seedChapters(d, 4)[0];
  const r = await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  assert.equal(r.folded, true); assert.equal(st.earlier.text, 'FOLD'.repeat(200));
  assert.deepStrictEqual(st.folds[0].chapterIds, [oldest.id]); assert.equal(st.folds[0].prevEarlier, null);
  assert.equal(liveChapters(st).length, 4); assert.ok(st.chapters.find(c => c.id === oldest.id).recap);
  assert.equal(st.chapters.find(c => c.id === oldest.id).status, 'folded');
  assert.match(chat.find(m => m.extra?.nemoChapterId === oldest.id).mes, /folded into Earlier history/);
  assert.ok(buildSlotText(st).startsWith('Earlier history:'));
});
test('a second fold passes the previous Earlier history and records it', async () => {
  const chat = chat20(); const sum = seqSummaries(['NEW'.repeat(200), 'FOLD2'.repeat(200)]); const d = deps(chat, { summarize: sum });
  seedChapters(d, 4); getNemoState(d.meta).earlier = { text: 'E1' };
  const r = await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  assert.equal(r.folded, true);
  assert.equal(sum.calls.length, 2);
  assert.ok(JSON.stringify(sum.calls[1]).includes('E1'));
  assert.equal(st.folds.at(-1).prevEarlier, 'E1'); assert.equal(st.earlier.text, 'FOLD2'.repeat(200));
});
test('an invalid fold summary keeps the chapters and skips the fold', async () => {
  const chat = chat20(); const d = deps(chat, { summarize: seqSummaries(['NEW'.repeat(200), 'x']) });
  seedChapters(d, 4); getNemoState(d.meta).earlier = { text: 'E1' };
  const r = await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  assert.equal(r.compacted, true); assert.equal(r.folded, false);
  assert.equal(liveChapters(st).length, 5); assert.equal(st.earlier.text, 'E1'); assert.equal(st.folds.length, 0);
});
test('several folding chapters cost one fold call', async () => {
  const chat = chat20(); const sum = seqSummaries(['A'.repeat(500)]); const d = deps(chat, { summarize: sum });
  seedChapters(d, 4);
  const at = chat.findIndex(m => m.mes === 'm3');
  chat[at] = buildSyntheticMessage({ kind: 'other', name: 'X', mes: 'x', extra: {}, smallSys: true });
  const r = await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  assert.equal(r.chapters, 2); assert.equal(sum.calls.length, 3); assert.equal(r.folded, true);
  assert.deepStrictEqual(st.folds[0].chapterIds, ['seed-0', 'seed-1']); assert.equal(liveChapters(st).length, 4);
});
test('a new chapter folded immediately gets the folded marker text', async () => {
  const chat = chat20(); const d = deps(chat, { settings: () => ({ ...resolveNemoSettings(), keepRecaps: 0 }) });
  const r = await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  assert.equal(r.folded, true); assert.equal(st.chapters[0].status, 'folded');
  assert.equal(chat.find(m => m.extra?.nemoChapterId === st.chapters[0].id).mes, 'Compacted 8 messages (folded into Earlier history)');
});
test('summary failure makes no fold call and a changed range applies no fold', async () => {
  let chat = chat20(); let sum = seqSummaries(['short']); let d = deps(chat, { summarize: sum }); seedChapters(d, 4);
  assert.equal((await new NemoCompaction(d).compactNow()).reason, 'summary-failed'); assert.equal(sum.calls.length, 1);
  chat = chat20(); d = deps(chat, { summarize: seqSummaries(['A'.repeat(500)]), waitForIdle: async () => { chat[7] = msg('a', 'edited'); } }); seedChapters(d, 4);
  assert.equal((await new NemoCompaction(d).compactNow()).reason, 'changed');
  const st = getNemoState(d.meta); assert.equal(st.earlier, null); assert.equal(st.folds.length, 0); assert.equal(liveChapters(st).length, 4);
});
test('our own seeded markers are never pulled into a new chapter', async () => {
  const chat = chat20(); const d = deps(chat); const seeded = seedChapters(d, 4);
  await new NemoCompaction(d).compactNow(); const st = getNemoState(d.meta);
  for (const c of seeded) assert.ok(chat.some(m => m.extra?.nemoChapterId === c.id));
  const added = st.chapters.at(-1);
  assert.ok(!getArchive(d.meta, added.archiveId).messages.some(m => m.extra?.from === 'state-referential'));
});
