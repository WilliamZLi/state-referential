import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript } from '../../src/util/transcript.js';

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
