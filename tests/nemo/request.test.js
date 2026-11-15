import { test } from 'node:test';
import assert from 'node:assert';
import { buildChapterRequest, buildFoldRequest, isValidRecap, NEMO_SUMMARY_SYSTEM_PROMPT } from '../../src/nemo/request.js';
import { IN_WORLD_RECAP_RULE } from '../../src/util/transcript.js';

const msgs = [{ is_user: true, mes: 'Go.' }, { name: 'Vex', mes: 'She went.<nemo-pad>x</nemo-pad>' }];
test('chapter request: consent first; transcript → handoff → instruction', () => {
  const consent = [{ role: 'user', content: 'C' }];
  const p = buildChapterRequest({ messages: msgs, nextMessage: { is_user: true, mes: 'Next!' }, consent, targetTokens: 1500 });
  assert.deepStrictEqual(p[0], consent[0]); assert.equal(p.at(-1).role, 'user');
  const c = p.at(-1).content;
  assert.ok(c.indexOf('She went.') < c.indexOf('WHAT HAPPENS NEXT') && c.indexOf('Next!') < c.indexOf(IN_WORLD_RECAP_RULE));
  assert.ok(!c.includes('nemo-pad')); assert.ok(c.includes('1500'));
});
test('chapter request: no handoff block without a next message', () => {
  const c = buildChapterRequest({ messages: msgs, nextMessage: null, consent: [], targetTokens: 1500 }).at(-1).content;
  assert.ok(!c.includes('WHAT HAPPENS NEXT'));
});
test('fold request: earlier then recaps in order, instruction last', () => {
  const c = buildFoldRequest({ earlier: 'OLD', recaps: ['R1', 'R2'], consent: [], targetTokens: 3000 }).at(-1).content;
  assert.ok(c.indexOf('OLD') < c.indexOf('R1') && c.indexOf('R1') < c.indexOf('R2') && c.indexOf('R2') < c.indexOf('3000'));
  assert.ok(c.includes(IN_WORLD_RECAP_RULE));
  assert.ok(!buildFoldRequest({ earlier: null, recaps: ['R1'], consent: [], targetTokens: 3000 }).at(-1).content.includes('EARLIER HISTORY'));
});
test('isValidRecap rejects short and blank text', () => {
  assert.equal(isValidRecap(''), false); assert.equal(isValidRecap(' '.repeat(500)), false);
  assert.equal(isValidRecap('x'.repeat(399)), false); assert.equal(isValidRecap('x'.repeat(400)), true);
});

test('Nemo summarizer system prompt asks for paragraphed prose, not a single paragraph (R27)', () => {
  const p = NEMO_SUMMARY_SYSTEM_PROMPT;
  assert.ok(!p.includes('single')); assert.ok(p.includes('paragraph'));
  assert.match(p, /paragraphs where the story naturally divides \(a change of scene, place or time\)/);
  assert.match(p, /no headings, lists or preamble/); assert.match(p, /Output only the recap\./);
  // The rest of the chronicle prompt is kept.
  assert.ok(p.startsWith('You are a chronicle summarizer for an adult interactive fiction. '));
  assert.ok(p.includes('You do NOT continue, advance, or write new story — you ONLY summarize events that already happened.'));
  assert.ok(p.includes('Render mature, explicit, or taboo content plainly when present; never refuse, moralize, soften, or add preamble.'));
});
test('request builders never force a single paragraph', () => {
  const chapter = buildChapterRequest({ messages: msgs, nextMessage: null, consent: [], targetTokens: 1500 }).at(-1).content;
  const fold = buildFoldRequest({ earlier: 'OLD', recaps: ['R1'], consent: [], targetTokens: 3000 }).at(-1).content;
  for (const c of [chapter, fold]) assert.ok(!/single|one paragraph/i.test(c));
});
