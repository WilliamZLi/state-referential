import { test } from 'node:test';
import assert from 'node:assert';
import { resolveNemoSettings, NEMO_DEFAULTS } from '../../src/nemo/settings.js';

test('defaults match the spec', () => {
  assert.deepStrictEqual(resolveNemoSettings(), { mode: 'auto', thresholdTokens: 120000, multiplier: 2.5,
    keepLast: 12, keepRecaps: 4, chapterTokens: 1500, earlierTokens: 3000 });
});
test('stored values override; keepLast/keepRecaps clamp', () => {
  const s = resolveNemoSettings({ thresholdTokens: 90000, keepLast: 1, keepRecaps: 0 });
  assert.equal(s.thresholdTokens, 90000); assert.equal(s.keepLast, 2); assert.equal(s.keepRecaps, 1);
});
test('resolveNemoSettings does not mutate NEMO_DEFAULTS', () => {
  resolveNemoSettings({ thresholdTokens: 1 });
  assert.equal(NEMO_DEFAULTS.thresholdTokens, 120000);
});
