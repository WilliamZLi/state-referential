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
