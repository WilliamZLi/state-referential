import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, wrapRecap } from '../../src/util/transcript.js';

test('buildTranscript labels user turns "User" and others by name', () => {
  const t = buildTranscript([
    { is_user: true, name: 'Cersia', mes: 'I open the door.' },
    { is_user: false, name: 'Narrator', mes: 'The door creaks.' },
  ]);
  assert.equal(t, 'User: I open the door.\nNarrator: The door creaks.');
});

test('buildTranscript falls back to Narrator when name is missing', () => {
  assert.equal(buildTranscript([{ is_user: false, mes: 'x' }]), 'Narrator: x');
});

test('buildTranscript guards null/blank message bodies', () => {
  assert.equal(buildTranscript([{ is_user: false, name: 'A' }]), 'A: ');
});

test('buildTranscript: empty / nullish input → empty string', () => {
  assert.equal(buildTranscript([]), '');
  assert.equal(buildTranscript(null), '');
});

test('buildTranscript joins lines with single newlines', () => {
  assert.equal(buildTranscript([{ mes: 'a' }, { mes: 'b' }]), 'Narrator: a\nNarrator: b');
});

test('wrapRecap wraps non-empty text in a <recap> block', () => {
  assert.equal(wrapRecap('She weighed her options.'), '<recap>\nShe weighed her options.\n</recap>');
  assert.equal(wrapRecap('  trims edges  '), '<recap>\ntrims edges\n</recap>');
});

test('wrapRecap returns empty string for empty/blank/nullish input (no empty tag)', () => {
  assert.equal(wrapRecap(''), '');
  assert.equal(wrapRecap('   \n  '), '');
  assert.equal(wrapRecap(null), '');
  assert.equal(wrapRecap(undefined), '');
});
