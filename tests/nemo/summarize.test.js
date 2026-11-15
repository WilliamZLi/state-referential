import { test } from 'node:test';
import assert from 'node:assert';
import { makeSummarizer } from '../../src/nemo/summarize.js';

test('passes prompt, system prompt and 16000 response length; trims', async () => {
  let got; const s = makeSummarizer({ generateRaw: async o => { got = o; return '  R  '; }, systemPrompt: 'SYS' });
  assert.equal(await s([{ role: 'user', content: 'x' }]), 'R');
  assert.deepStrictEqual(got, { prompt: [{ role: 'user', content: 'x' }], systemPrompt: 'SYS', responseLength: 16000 });
});
test('returns empty string when generateRaw throws', async () => {
  assert.equal(await makeSummarizer({ generateRaw: async () => { throw new Error('x'); }, systemPrompt: '' })([]), '');
});
