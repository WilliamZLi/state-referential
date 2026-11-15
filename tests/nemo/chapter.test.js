import { test } from 'node:test';
import assert from 'node:assert';
import { writeChapterRecap, nextMessageAfter } from '../../src/nemo/chapter.js';

const chat = [{ is_user: true, mes: 'a' }, { mes: 'b' }, { is_system: true, mes: 'hidden' }, { is_user: true, mes: 'next' }];
test('summarizes the run, hands off to the next visible message', async () => {
  let seen; const text = await writeChapterRecap({ chat, run: { startIndex: 0, endIndex: 1, indices: [0, 1] },
    consent: [], targetTokens: 1500, summarize: async p => { seen = p.at(-1).content; return 'x'.repeat(500); } });
  assert.equal(text.length, 500); assert.ok(seen.includes('next')); assert.ok(!seen.includes('hidden'));
});
test('returns null for an invalid recap', async () => {
  assert.equal(await writeChapterRecap({ chat, run: { startIndex: 0, endIndex: 1, indices: [0, 1] },
    consent: [], targetTokens: 1500, summarize: async () => 'short' }), null);
});
test('nextMessageAfter skips hidden messages and our markers', () => {
  assert.equal(nextMessageAfter(chat, 1).mes, 'next');
  assert.equal(nextMessageAfter([{}, { extra: { from: 'state-referential' } }], 0), null);
});
