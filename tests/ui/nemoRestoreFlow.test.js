import test from 'node:test';
import assert from 'node:assert/strict';
import { runRestoreFlow } from '../../src/ui/nemoRestoreFlow.js';
import { NEMO_BUSY_TEXT } from '../../src/ui/nemoUiLogic.js';

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
    unfoldAndRestore: async id => { log.push(['unfoldAndRestore', id]); return { restored: true, count: 3 }; },
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
  assert.deepEqual(s.toasts, [['info', NEMO_BUSY_TEXT]]);
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

test('folded chapter: confirm names the newer chapters, then one unfoldAndRestore call', async () => {
  const s = setup();
  await runRestoreFlow(s.deps, 'c1', s.refresh);
  assert.deepEqual(names(s.log), ['confirm', 'unfoldAndRestore', 'refresh']);
  assert.equal(s.log[0][1], 'Unfold 2 time(s) and restore this chapter and the 2 newer chapter(s)?');
  assert.deepEqual(s.log[1], ['unfoldAndRestore', 'c1']);
  assert.deepEqual(s.toasts, [['success', 'Restored 3 chapter(s).']]);
});

test('folded restore that cannot be placed warns and still refreshes', async () => {
  const s = setup({ unfoldAndRestore: async () => ({ restored: false, reason: 'not-found' }) });
  await runRestoreFlow(s.deps, 'c1', s.refresh);
  assert.deepEqual(s.toasts, [['warning', "Couldn't restore — the chapter's marker is missing."]]);
  assert.equal(names(s.log).at(-1), 'refresh');
});

for (const id of ['c3', 'c1']) {
  test(`busy flipping true between confirm and the call refuses without mutating (${id})`, async () => {
    let busy = false;
    const s = setup({ isBusy: () => busy, confirm: async m => { s.log.push(['confirm', m]); busy = true; return true; } });
    await runRestoreFlow(s.deps, id, s.refresh);
    assert.deepEqual(names(s.log), ['confirm']);
    assert.deepEqual(s.toasts, [['info', NEMO_BUSY_TEXT]]);
  });
}

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
