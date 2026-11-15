import { test } from 'node:test';
import assert from 'node:assert';
import {
  getNemoState, peekNemoState, isNemoEnabled, setNemoEnabled,
  hasChapters, liveChapters, buildSlotText,
} from '../../src/nemo/state.js';

test('getNemoState initializes once on meta', () => {
  const meta = {}; const s = getNemoState(meta);
  assert.deepStrictEqual(s, { enabled: false, chapters: [], earlier: null, folds: [] });
  assert.strictEqual(getNemoState(meta), s); assert.strictEqual(meta.nemoCompaction, s);
});
test('peekNemoState and isNemoEnabled never create state', () => {
  const meta = {};
  assert.equal(peekNemoState(meta), null);
  assert.equal(isNemoEnabled(meta), false);
  assert.equal(Object.prototype.hasOwnProperty.call(meta, 'nemoCompaction'), false);
});
test('enable works only on unbound chats', () => {
  const free = {}; assert.equal(setNemoEnabled(free, true), true); assert.equal(isNemoEnabled(free), true);
  const bound = { trackerWorldId: 'w1' }; assert.equal(setNemoEnabled(bound, true), false);
  getNemoState(bound).enabled = true; assert.equal(isNemoEnabled(bound), false);
});
test('hasChapters and liveChapters', () => {
  assert.equal(hasChapters({ chapters: [], earlier: null }), false);
  assert.equal(hasChapters({ chapters: [], earlier: { text: 'E' } }), true);
  assert.equal(hasChapters({ chapters: [{ status: 'folded' }], earlier: null }), true);
  const live = liveChapters({ chapters: [{ id: 1, status: 'folded' }, { id: 2, status: 'live' }] });
  assert.deepStrictEqual(live.map(c => c.id), [2]);
});
test('slot text = Earlier history, then live recaps oldest-first; folded excluded', () => {
  const st = { earlier: { text: 'E' }, folds: [], chapters: [
    { recap: 'A', status: 'folded' }, { recap: 'B', status: 'live' }, { recap: 'C', status: 'live' }] };
  assert.equal(buildSlotText(st), 'Earlier history:\nE\n\nB\n\nC');
});
test('slot text is empty when nothing is compacted', () => {
  assert.equal(buildSlotText({ earlier: null, chapters: [], folds: [] }), '');
});
