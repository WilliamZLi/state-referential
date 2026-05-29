// tests/integration/WorldMacros.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveWorldMacro } from '../../src/integration/Macros.js';
import { ChronicleStore } from '../../src/engine/ChronicleStore.js';

function mkState(opts = {}) {
  const chronicle = ChronicleStore.hydrate({
    bigPicture: opts.bigPicture ?? 'Lyra is an outlaw.',
    entries: opts.entries ?? [],
    config: { verbatimWindow: opts.verbatimWindow ?? 3, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 },
  });
  const worldMeta = opts.worldMeta ?? { id: 'w1', name: 'Eldoria' };
  return { chronicle, worldMeta };
}

test('world::name returns world name', () => {
  const { chronicle, worldMeta } = mkState();
  assert.strictEqual(resolveWorldMacro('name', worldMeta, chronicle), 'Eldoria');
});

test('world::id returns world id', () => {
  const { chronicle, worldMeta } = mkState();
  assert.strictEqual(resolveWorldMacro('id', worldMeta, chronicle), 'w1');
});

test('world::bigpicture returns big picture text', () => {
  const { chronicle, worldMeta } = mkState({ bigPicture: 'Big story so far.' });
  assert.strictEqual(resolveWorldMacro('bigpicture', worldMeta, chronicle), 'Big story so far.');
});

test('world::recent returns concatenated verbatim entries', () => {
  const { chronicle, worldMeta } = mkState({
    verbatimWindow: 5,
    entries: [
      { id: 'e1', createdAt: 1, title: 'Act I', body: 'First act.', createdByMessageId: null },
      { id: 'e2', createdAt: 2, title: 'Act II', body: 'Second act.', createdByMessageId: null },
    ],
  });
  const result = resolveWorldMacro('recent', worldMeta, chronicle);
  assert.match(result, /Act I/);
  assert.match(result, /Act II/);
});

test('world::recent::1 returns only the last 1 entry', () => {
  const { chronicle, worldMeta } = mkState({
    verbatimWindow: 5,
    entries: [
      { id: 'e1', createdAt: 1, title: 'Act I', body: 'First act.', createdByMessageId: null },
      { id: 'e2', createdAt: 2, title: 'Act II', body: 'Second act.', createdByMessageId: null },
    ],
  });
  const result = resolveWorldMacro('recent::1', worldMeta, chronicle);
  assert.ok(!result.includes('First act.'), 'Act I body should not appear');
  assert.match(result, /Act II/);
});

test('world::chronicle returns bigpicture + recent combined', () => {
  const { chronicle, worldMeta } = mkState({
    bigPicture: 'Overview.',
    entries: [{ id: 'e1', createdAt: 1, title: 'Act I', body: 'First.', createdByMessageId: null }],
  });
  const result = resolveWorldMacro('chronicle', worldMeta, chronicle);
  assert.match(result, /Overview\./);
  assert.match(result, /Act I/);
});

test('resolves to empty string when worldMeta is null (unbound chat)', () => {
  const { chronicle } = mkState();
  assert.strictEqual(resolveWorldMacro('name', null, chronicle), '');
  assert.strictEqual(resolveWorldMacro('bigpicture', null, chronicle), '');
});
