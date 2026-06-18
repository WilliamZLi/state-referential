import { test } from 'node:test';
import assert from 'node:assert';
import { registerAnchorCount } from '../../src/integration/Macros.js';

test('registers anchor-count and returns the anchored message count as a string', () => {
  let handler;
  const registry = { registerMacro: (name, def) => { if (name === 'anchor-count') handler = def.handler; } };
  const chat = [{ l3Anchor: { anchoredAt: 1 } }, { mes: 'x' }, { l3Anchor: { anchoredAt: 2 } }];
  registerAnchorCount(registry, () => chat);
  assert.equal(typeof handler, 'function');
  assert.equal(handler(), '2');
});

test('returns "0" with no chat', () => {
  let handler;
  const registry = { registerMacro: (name, def) => { handler = def.handler; } };
  registerAnchorCount(registry, () => null);
  assert.equal(handler(), '0');
});
