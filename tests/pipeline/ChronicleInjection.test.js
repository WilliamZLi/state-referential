// tests/pipeline/ChronicleInjection.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ChronicleInjection } from '../../src/pipeline/ChronicleInjection.js';
import { ChronicleStore } from '../../src/engine/ChronicleStore.js';

function mkChronicle(opts = {}) {
  const c = new ChronicleStore({
    bigPicture: opts.bigPicture ?? 'Lyra has become an outlaw.',
    entries: opts.entries ?? [],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  if (opts.entries) {
    // entries already hydrated via constructor
  }
  return c;
}

test('run calls setExtensionPrompt with rendered chronicle text', () => {
  const chronicle = mkChronicle({
    bigPicture: 'Lyra arrived.',
    entries: [
      { id: 'e1', createdAt: 1, title: 'Act I', body: 'She crossed the border.', createdByMessageId: null },
    ],
  });
  const chronicle2 = ChronicleStore.hydrate({
    bigPicture: 'Lyra arrived.',
    entries: [{ id: 'e1', createdAt: 1, title: 'Act I', body: 'She crossed the border.', createdByMessageId: null }],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle2, {
    setExtensionPrompt: (key, text, pos, depth) => calls.push({ key, text, pos, depth }),
  });
  inj.run();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].key, 'world:chronicle');
  assert.match(calls[0].text, /Lyra arrived\./);
  assert.match(calls[0].text, /Act I/);
  assert.match(calls[0].text, /She crossed the border\./);
});

test('run clears injection when chronicle is empty', () => {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: '', entries: [],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, {
    setExtensionPrompt: (k, t) => calls.push({ k, t }),
  });
  inj.run();
  const cleared = calls.find(c => c.k === 'world:chronicle' && c.t === '');
  assert.ok(cleared, 'should clear injection when empty');
});

test('run only shows verbatimWindow entries', () => {
  const entries = [
    { id: 'e1', createdAt: 1, title: 'Old Act', body: 'old', createdByMessageId: null },
    { id: 'e2', createdAt: 2, title: 'Recent Act', body: 'recent', createdByMessageId: null },
  ];
  const chronicle = ChronicleStore.hydrate({
    bigPicture: 'Summary.',
    entries,
    config: { verbatimWindow: 1, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const c = calls.find(x => x.k === 'world:chronicle');
  assert.ok(c, 'should emit');
  assert.ok(!c.t.includes('Old Act'), 'old act should not appear');
  assert.ok(c.t.includes('Recent Act'), 'recent act should appear');
});

test('position defaults to 2 (BEFORE_PROMPT)', () => {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: 'x',
    entries: [],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, { setExtensionPrompt: (k, t, pos, d) => calls.push({ pos, d }) });
  inj.run();
  assert.strictEqual(calls[0].pos, 2);
  assert.strictEqual(calls[0].d, 0);
});
