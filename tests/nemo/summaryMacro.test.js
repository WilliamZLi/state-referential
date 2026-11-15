import { test } from 'node:test';
import assert from 'node:assert';
import { createSummaryProvider } from '../../src/nemo/summaryMacro.js';

test('serves chapters whenever they exist, even with the toggle off', () => {
  const meta = { nemoCompaction: { enabled: false, chapters: [{ recap: 'R', status: 'live' }], earlier: null, folds: [] } };
  assert.equal(createSummaryProvider({ getMeta: () => meta, getChat: () => [], readUiSummary: () => 'UI' })(), 'R');
});
test('reads the current chat at call time', () => {                                 // Review Focus 5
  let meta = { nemoCompaction: { enabled: true, chapters: [{ recap: 'R', status: 'live' }], earlier: null, folds: [] } };
  const p = createSummaryProvider({ getMeta: () => meta, getChat: () => [], readUiSummary: () => '' });
  assert.equal(p(), 'R'); meta = {}; assert.equal(p(), '');
});
test('fallback: UI summary first, then latest extra.memory skipping the last message', () => {
  const chat = [{ extra: { memory: 'OLD' } }, { extra: { memory: 'NEW' } }, { extra: { memory: 'LAST' } }];
  assert.equal(createSummaryProvider({ getMeta: () => ({}), getChat: () => chat, readUiSummary: () => '  ' })(), 'NEW');
  assert.equal(createSummaryProvider({ getMeta: () => ({}), getChat: () => chat, readUiSummary: () => 'UI' })(), 'UI');
});
test('provider never creates nemo state on meta (R2)', () => {
  const meta = {};
  const p = createSummaryProvider({ getMeta: () => meta, getChat: () => [], readUiSummary: () => '' });
  assert.equal(p(), '');
  assert.deepEqual(meta, {});
});
