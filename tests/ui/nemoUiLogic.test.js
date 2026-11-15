import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNemoNumber, restoreIntent, compactResultMessage, renderChapterList, escapeHtml, restoreConfirmText } from '../../src/ui/nemoUiLogic.js';

test('parseNemoNumber', () => {
  assert.equal(parseNemoNumber('keepLast', 'abc'), null);
  assert.equal(parseNemoNumber('multiplier', '1.5'), 1.5);
  assert.equal(parseNemoNumber('multiplier', '0'), null);
  assert.equal(parseNemoNumber('keepLast', '1'), null);
  assert.equal(parseNemoNumber('keepLast', '12'), 12);
  assert.equal(parseNemoNumber('thresholdTokens', '999'), null);
  assert.equal(parseNemoNumber('thresholdTokens', '1000'), 1000);
  assert.equal(parseNemoNumber('keepRecaps', '0'), null);
  assert.equal(parseNemoNumber('chapterTokens', '99'), null);
  assert.equal(parseNemoNumber('earlierTokens', '100'), 100);
});

const st = () => ({
  earlier: { text: 'E' },
  folds: [{ id: 'f1', chapterIds: ['c1'] }, { id: 'f2', chapterIds: ['c2'] }],
  chapters: [
    { id: 'c1', count: 8, status: 'folded' }, { id: 'c2', count: 8, status: 'folded' },
    { id: 'c3', count: 8, status: 'live' }, { id: 'c4', count: 8, status: 'live' },
  ],
});

test('restoreIntent', () => {
  assert.deepEqual(restoreIntent(st(), 'c3'), { kind: 'live', newer: 1 });
  assert.deepEqual(restoreIntent(st(), 'c4'), { kind: 'live', newer: 0 });
  assert.deepEqual(restoreIntent(st(), 'c1'), { kind: 'folded', unfolds: 2 });
  assert.deepEqual(restoreIntent(st(), 'c2'), { kind: 'folded', unfolds: 1 });
  assert.equal(restoreIntent(st(), 'zz'), null);
  assert.equal(restoreIntent(null, 'c1'), null);
});

test('restoreConfirmText', () => {
  assert.equal(restoreConfirmText({ kind: 'live', newer: 2 }), 'Restore this chapter and the 2 newer chapter(s)?');
  assert.equal(restoreConfirmText({ kind: 'live', newer: 0 }), 'Restore this chapter?');
  assert.equal(restoreConfirmText({ kind: 'folded', unfolds: 3 }), 'Unfold 3 time(s) and restore?');
});

test('compactResultMessage', () => {
  assert.deepEqual(compactResultMessage({ compacted: true, messages: 20, chapters: 2, folded: false }),
    { level: 'success', text: 'Compacted 20 messages into 2 chapter(s)' });
  assert.equal(compactResultMessage({ compacted: true, messages: 20, chapters: 2, folded: true }).text,
    'Compacted 20 messages into 2 chapter(s) and folded older recaps into Earlier history');
  assert.deepEqual(compactResultMessage({ compacted: false, reason: 'no-eligible-range' }), { level: 'info', text: 'Nothing to compact yet.' });
  assert.deepEqual(compactResultMessage({ compacted: false, reason: 'summary-failed' }), { level: 'warning', text: 'Summary failed — nothing changed.' });
  assert.deepEqual(compactResultMessage({ compacted: false, reason: 'changed' }), { level: 'info', text: 'Chat changed while summarizing — nothing changed.' });
});

test('chapter list: live and folded rows, restore buttons, unfold only with folds, escaped', () => {
  const s = { earlier: { text: 'E' }, folds: [{ id: 'f1' }], chapters: [
    { id: 'c1', count: 8, status: 'folded', recap: 'x' }, { id: 'c2', count: 16, status: 'live', recap: '<b>' }] };
  const html = renderChapterList(s);
  assert.ok(html.includes('data-nemo-restore="c1"') && html.includes('data-nemo-restore="c2"'));
  assert.ok(html.includes('folded') && html.includes('live') && html.includes('data-nemo-unfold'));
  assert.ok(!html.includes('<b>'));
  assert.ok(!renderChapterList({ ...s, folds: [] }).includes('data-nemo-unfold'));
});

test('chapter list: null/empty state shows empty line; ids escaped', () => {
  assert.ok(renderChapterList(null).includes('No chapters yet.'));
  assert.ok(renderChapterList({ chapters: [], folds: [], earlier: null }).includes('No chapters yet.'));
  const html = renderChapterList({ earlier: null, folds: [], chapters: [{ id: 'a"><i>', count: 1, status: 'live', recap: '' }] });
  assert.ok(!html.includes('<i>'));
});

test('escapeHtml', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
