import { test } from 'node:test';
import assert from 'node:assert';
import { flattenPromptText, estimateRealTokens } from '../../src/nemo/estimate.js';

test('estimate = ST count × multiplier', () => assert.equal(estimateRealTokens(37182, 2.5), 92955));
test('flattens string and part-array contents', () => {
  assert.equal(flattenPromptText([{ content: 'a' }, { content: [{ type: 'text', text: 'b' }] }]), 'a\nb');
});
test('skips non-text parts', () => {
  assert.equal(flattenPromptText([{ content: [{ type: 'image_url', image_url: {} }, { type: 'text', text: 'b' }] }]), 'b');
});
