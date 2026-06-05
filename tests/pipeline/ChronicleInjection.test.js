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
    entries: [{ id: 'e1', createdAt: 1, title: 'Act I', body: 'She crossed the border.', createdByMessageId: null, inject: true }],
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

test('run injects only acts flagged inject:true, regardless of verbatimWindow', () => {
  const entries = [
    { id: 'e1', createdAt: 1, title: 'Old Act', body: 'old', createdByMessageId: null, inject: true },
    { id: 'e2', createdAt: 2, title: 'Recent Act', body: 'recent', createdByMessageId: null, inject: false },
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
  assert.ok(c.t.includes('Old Act'), 'inject:true act shows even though it is outside verbatimWindow=1');
  assert.ok(!c.t.includes('Recent Act'), 'inject:false act excluded even though it is the most recent');
});

test('position defaults to 0 (IN_PROMPT)', () => {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: 'x',
    entries: [],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, { setExtensionPrompt: (k, t, pos, d) => calls.push({ pos, d }) });
  inj.run();
  assert.strictEqual(calls[0].pos, 0);
  assert.strictEqual(calls[0].d, 0);
});

test('injectBigPicture:false omits the big picture line', () => {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: 'Big summary text.',
    entries: [{ id: 'e1', createdAt: 1, title: 'A', body: 'b', createdByMessageId: null, inject: true }],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200, injectBigPicture: false },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const c = calls.find(x => x.k === 'world:chronicle');
  assert.ok(!c.t.includes('Big summary text.'), 'big picture omitted when toggle off');
  assert.ok(c.t.includes('A'), 'acts still injected');
});

test('injectPosition maps labels to numeric; in-chat carries depth', () => {
  const mk = (pos) => ChronicleStore.hydrate({
    bigPicture: 'x', entries: [],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200, injectPosition: pos, injectDepth: 6 },
  });
  const run = (pos) => { const calls = []; new ChronicleInjection(mk(pos), { setExtensionPrompt: (k, t, p, d) => calls.push({ p, d }) }).run(); return calls[0]; };
  assert.strictEqual(run('in-prompt').p, 0);
  assert.strictEqual(run('top').p, 2);
  const ic = run('in-chat');
  assert.strictEqual(ic.p, 1);
  assert.strictEqual(ic.d, 6);
});

test('run clears injection when nothing is toggled on', () => {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: 'Present but disabled.',
    entries: [{ id: 'e1', createdAt: 1, title: 'A', body: 'b', createdByMessageId: null, inject: false }],
    config: { verbatimWindow: 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200, injectBigPicture: false },
  });
  const calls = [];
  const inj = new ChronicleInjection(chronicle, { setExtensionPrompt: (k, t) => calls.push({ k, t }) });
  inj.run();
  const c = calls.find(x => x.k === 'world:chronicle');
  assert.strictEqual(c.t, '', 'empty when big picture off and no acts toggled on');
});
