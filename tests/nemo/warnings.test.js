import { test } from 'node:test';
import assert from 'node:assert';
import { hasEnabledSummarySlot, chatUsesBuiltinSummary } from '../../src/nemo/warnings.js';

test('slot check only counts enabled prompts', () => {
  const prompts = [{ identifier: 'a', content: '<recap>{{summary}}</recap>' }];
  assert.equal(hasEnabledSummarySlot(prompts, () => false), true); assert.equal(hasEnabledSummarySlot(prompts, () => true), false);
});
test('detects built-in summary use', () => {
  assert.equal(chatUsesBuiltinSummary([{ extra: { memory: 'x' } }]), true); assert.equal(chatUsesBuiltinSummary([{}]), false);
});
