import { test } from 'node:test';
import assert from 'node:assert';
import { estimateChatTokens } from '../../src/pipeline/TokenBudget.js';

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
