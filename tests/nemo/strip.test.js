import { test } from 'node:test';
import assert from 'node:assert';
import { stripForSummary } from '../../src/nemo/strip.js';

test('removes the modular pad, keeps prose and the scene header', () => {
  const t = '<scene>📍 Hall</scene>\nShe waits.\n\n<nemo-pad>\n[[tab Current State|open]]x\n</nemo-pad>';
  assert.equal(stripForSummary(t), '<scene>📍 Hall</scene>\nShe waits.');
});

test('removes the trailing legacy pad', () => {
  const t = 'She waits.\n<div class="nemo-legacy-pad" style="x">\n<details><summary>Scene Scratchpad</summary><div>a</div></details>\n</div>';
  assert.equal(stripForSummary(t), 'She waits.');
});

test('removes cutaways and Mental Projection blocks', () => {
  const t = 'A.<nemo-offscreen>far</nemo-offscreen> B.<nemo-mp-state>s</nemo-mp-state><nemo-mp-retain id="1">r</nemo-mp-retain><mental_state>m</mental_state>';
  assert.equal(stripForSummary(t), 'A. B.');
});

test('plain prose is unchanged', () => {
  assert.equal(stripForSummary('Just prose.'), 'Just prose.');
});

test('two separate pads in one message keep the prose between them', () => {
  const t = '<nemo-pad>one</nemo-pad>\nMiddle prose.\n<nemo-pad>two</nemo-pad>';
  assert.equal(stripForSummary(t), 'Middle prose.');
});

test('handles multi-line and attributed blocks', () => {
  const t = 'Start.\n<nemo-mp-retain id="2">\nline a\n\n\n\nline b\n</nemo-mp-retain>\nEnd.';
  assert.equal(stripForSummary(t), 'Start.\n\nEnd.');
});

test('drops an unclosed pad truncated mid-stream', () => {
  assert.equal(stripForSummary('Prose.\n<nemo-pad>\n[[tab Cur'), 'Prose.');
});

test('drops an unclosed mental_state through end of text', () => {
  assert.equal(stripForSummary('Prose.\n<mental_state>she thinks'), 'Prose.');
});

test('drops unclosed offscreen, mp-state and mp-retain openers', () => {
  assert.equal(stripForSummary('A.<nemo-offscreen>far'), 'A.');
  assert.equal(stripForSummary('A.<nemo-mp-state>s'), 'A.');
  assert.equal(stripForSummary('A.<nemo-mp-retain id="1">r'), 'A.');
});

test('a closed block before an unclosed one is still handled', () => {
  assert.equal(stripForSummary('A.<nemo-pad>x</nemo-pad>B.<nemo-pad>cut'), 'A.B.');
});
