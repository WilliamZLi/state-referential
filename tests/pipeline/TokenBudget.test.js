import { test } from 'node:test';
import assert from 'node:assert';
import { estimateChatTokens, resolveContextSize } from '../../src/pipeline/TokenBudget.js';

const mk = (id, mes) => ({ state_referential_msgId: id, mes });

test('sums per-message counts', async () => {
  const chat = [mk('a', 'one'), mk('b', 'two')];
  const total = await estimateChatTokens(chat, m => m.mes.length);
  assert.equal(total, 6); // 3 + 3
});

test('uses the cache and only counts uncached messages', async () => {
  const chat = [mk('a', 'one'), mk('b', 'two')];
  const cache = new Map();
  let calls = 0;
  const countFn = m => { calls++; return m.mes.length; };
  assert.equal(await estimateChatTokens(chat, countFn, cache), 6);
  assert.equal(calls, 2);
  assert.equal(await estimateChatTokens(chat, countFn, cache), 6);
  assert.equal(calls, 2);
});

test('recounts a message whose text changed', async () => {
  const chat = [mk('a', 'one')];
  const cache = new Map();
  await estimateChatTokens(chat, m => m.mes.length, cache);
  chat[0].mes = 'longer';
  const total = await estimateChatTokens(chat, m => m.mes.length, cache);
  assert.equal(total, 6);
});

test('awaits async countFn', async () => {
  const chat = [mk('a', 'one')];
  const total = await estimateChatTokens(chat, async m => m.mes.length);
  assert.equal(total, 3);
});

test('resolveContextSize prefers the API-aware context over the stale fallback', () => {
  // chat-completion: getMaxContextTokens() = 64000; getContext().maxContext = 8192
  // (the stale text-completion global). The nudge denominator must be 64000.
  assert.equal(resolveContextSize(64000, 8192), 64000);
});

test('resolveContextSize falls back to the second arg when the API value is missing/invalid', () => {
  assert.equal(resolveContextSize(undefined, 8192), 8192);
  assert.equal(resolveContextSize(0, 8192), 8192);
  assert.equal(resolveContextSize(Number.NaN, 8192), 8192);
  assert.equal(resolveContextSize(-5, 8192), 8192);
});

test('resolveContextSize returns 0 when neither value is usable', () => {
  assert.equal(resolveContextSize(undefined, undefined), 0);
  assert.equal(resolveContextSize(0, 0), 0);
});
