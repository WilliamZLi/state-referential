import { test } from 'node:test';
import assert from 'node:assert';
import { decideAutoCompact } from '../../src/pipeline/AutoCompact.js';

const S = (over = {}) => ({ auto: 'nudge', thresholdPct: 80, ...over });

test('null when off, even over threshold', () => {
  assert.equal(decideAutoCompact({ chatTokens: 999, contextSize: 100, settings: S({ auto: 'off' }) }), null);
});

test('null when at or below threshold', () => {
  assert.equal(decideAutoCompact({ chatTokens: 80, contextSize: 100, settings: S() }), null);
  assert.equal(decideAutoCompact({ chatTokens: 79, contextSize: 100, settings: S() }), null);
});

test('returns the mode when over threshold', () => {
  assert.equal(decideAutoCompact({ chatTokens: 81, contextSize: 100, settings: S({ auto: 'nudge' }) }), 'nudge');
  assert.equal(decideAutoCompact({ chatTokens: 81, contextSize: 100, settings: S({ auto: 'silent' }) }), 'silent');
});

test('null when contextSize is missing/zero (cannot decide)', () => {
  assert.equal(decideAutoCompact({ chatTokens: 5000, contextSize: 0, settings: S() }), null);
});

test('REGRESSION (stale-context bug): a 12k chat in the real 64k context does NOT nudge', () => {
  // The nudge used getContext().maxContext (the text-completion `max_context`
  // global = 8192) as the denominator on a chat-completion API whose real
  // context is 64000. 12108/8192 = 148% > 80% → false nudge. With the correct
  // API-aware 64000: 12108/64000 = 19% → no nudge.
  assert.equal(decideAutoCompact({ chatTokens: 12108, contextSize: 64000, settings: S() }), null);
  // ...and the wrong denominator is what fired the bogus nudge:
  assert.equal(decideAutoCompact({ chatTokens: 12108, contextSize: 8192, settings: S() }), 'nudge');
});
