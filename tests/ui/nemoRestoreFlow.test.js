import test from 'node:test';
import assert from 'node:assert/strict';
import { runRestoreFlow } from '../../src/ui/nemoRestoreFlow.js';

function setup(over = {}) {
  const log = [];
  const toasts = [];
  const meta = { nemoCompaction: { enabled: true, earlier: null,
    folds: [{ id: 'f1', chapterIds: ['c1'] }, { id: 'f2', chapterIds: ['c2'] }],
    chapters: [{ id: 'c1', status: 'folded' }, { id: 'c2', status: 'folded' }, { id: 'c3', status: 'live' }] } };
  const toast = {};
  for (const l of ['success', 'info', 'warning', 'error']) toast[l] = m => toasts.push([l, m]);
  const deps = {
    getMeta: () => meta, toast, isBusy: () => false,
    confirm: async m => { log.push(['confirm', m]); return true; },
    unfoldLatest: async () => { log.push(['unfold']); return { unfolded: true }; },
    restoreChapter: async id => { log.push(['restore', id]); return { restored: true, count: 3 }; },
    ...over,
  };
  const refresh = () => log.push(['refresh']);
  return { deps, log, toasts, refresh };
}
const names = log => log.map(e => e[0]);

test('busy refuses before confirm', async () => {
  const s = setup({ isBusy: () => true });
  await runRestoreFlow(s.deps, 'c3', s.refresh);
  assert.deepEqual(names(s.log), []);
  assert.deepEqual(s.toasts, [['info', 'Compaction in progress']]);
});

test('confirm false does nothing', async () => {
  const s = setup({ confirm: async () => false });
  await runRestoreFlow(s.deps, 'c3', s.refresh);
  assert.deepEqual(names(s.log), []);
  assert.deepEqual(s.toasts, []);
});

test('live chapter restores once with success toast', async () => {
  const s = setup();
  await runRestoreFlow(s.deps, 'c3', s.refresh);
  assert.deepEqual(names(s.log), ['confirm', 'restore', 'refresh']);
  assert.deepEqual(s.toasts, [['success', 'Restored 3 chapter(s).']]);
});

test('folded chapter unfolds twice then restores', async () => {
  const s = setup();
  await runRestoreFlow(s.deps, 'c1', s.refresh);
  assert.deepEqual(names(s.log), ['confirm', 'unfold', 'unfold', 'restore', 'refresh']);
});

test('failed unfold stops early', async () => {
  const s = setup({ unfoldLatest: async () => ({ unfolded: false }) });
  await runRestoreFlow(s.deps, 'c1', s.refresh);
  assert.ok(!names(s.log).includes('restore'));
  assert.deepEqual(s.toasts, [['warning', "Couldn't unfold — nothing left to unfold."]]);
  assert.equal(names(s.log).at(-1), 'refresh');
});

test('not-found warns', async () => {
  const s = setup({ restoreChapter: async () => ({ restored: false, reason: 'not-found' }) });
  await runRestoreFlow(s.deps, 'c3', s.refresh);
  assert.deepEqual(s.toasts, [['warning', "Couldn't restore — the chapter's marker is missing."]]);
});

test('restoreChapter throwing toasts error and still refreshes', async () => {
  const s = setup({ restoreChapter: async () => { throw new Error('boom'); } });
  const orig = console.error; console.error = () => {};
  try { await runRestoreFlow(s.deps, 'c3', s.refresh); } finally { console.error = orig; }
  assert.equal(s.toasts[0][0], 'error');
  assert.equal(names(s.log).at(-1), 'refresh');
});
