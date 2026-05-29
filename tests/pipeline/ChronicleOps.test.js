// tests/pipeline/ChronicleOps.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ChronicleOps } from '../../src/pipeline/ChronicleOps.js';
import { ChronicleStore } from '../../src/engine/ChronicleStore.js';

function mkStore(opts = {}) {
  return ChronicleStore.hydrate({
    bigPicture: opts.bigPicture ?? '',
    entries: opts.entries ?? [],
    config: {
      verbatimWindow: opts.verbatimWindow ?? 3,
      updateStrategy: opts.updateStrategy ?? 'lazy',
      bigPictureTokenCap: 300,
      entryTokenCap: 200,
    },
  });
}

function mkOps(chronicle, generateResponses = {}) {
  let callCount = 0;
  const generateQuietPrompt = async (prompt) => {
    callCount++;
    if (generateResponses[callCount]) return generateResponses[callCount];
    return `Generated summary #${callCount}`;
  };
  return {
    ops: new ChronicleOps(chronicle, { generateQuietPrompt }),
    getCallCount: () => callCount,
  };
}

test('actComplete appends entry with AI-generated body', async () => {
  const chronicle = mkStore({ verbatimWindow: 5 });
  const { ops, getCallCount } = mkOps(chronicle, { 1: 'Lyra fought the guards.' });
  const entry = await ops.actComplete('The Guard Confrontation', { messages: [
    { name: 'Lyra', mes: 'I draw my sword.' },
    { name: 'Narrator', mes: 'The guards advance.' },
  ], msgId: 'tmsg-10' });
  assert.strictEqual(entry.title, 'The Guard Confrontation');
  assert.strictEqual(entry.body, 'Lyra fought the guards.');
  assert.strictEqual(entry.createdByMessageId, 'tmsg-10');
  assert.strictEqual(chronicle.getEntries().length, 1);
  assert.strictEqual(getCallCount(), 1, 'one generate call for summary');
});

test('actComplete with lazy strategy and entries > verbatimWindow folds oldest', async () => {
  const chronicle = mkStore({ verbatimWindow: 2, updateStrategy: 'lazy' });
  chronicle.appendEntry('Old1', 'old1', null);
  chronicle.appendEntry('Old2', 'old2', null);
  // entries.length == 2, verbatimWindow == 2 => not yet overflowing

  const { ops } = mkOps(chronicle, {
    1: 'New act body.', // summary for the new entry
    2: 'Updated big picture.', // big picture regeneration
  });
  await ops.actComplete('New Act', { messages: [] }); // entries.length becomes 3 > 2 → fold

  assert.ok(chronicle.getBigPicture().length > 0, 'big picture updated');
  assert.strictEqual(chronicle.getEntries().length, 2, 'oldest entry folded out');
  assert.ok(!chronicle.getEntries().find(e => e.title === 'Old1'), 'Old1 should be folded');
});

test('actComplete with eager strategy always regenerates big picture', async () => {
  const chronicle = mkStore({ verbatimWindow: 5, updateStrategy: 'eager' });
  const { ops, getCallCount } = mkOps(chronicle);
  await ops.actComplete('Act I', { messages: [] });
  // call 1 = summary, call 2 = bigPicture regeneration
  assert.strictEqual(getCallCount(), 2, 'eager always triggers big picture regen');
  assert.ok(chronicle.getBigPicture().length > 0);
});

test('actComplete with manual strategy never triggers big picture regen', async () => {
  const chronicle = mkStore({ verbatimWindow: 1, updateStrategy: 'manual' });
  chronicle.appendEntry('Prior', 'x', null); // length already at verbatimWindow
  const { ops, getCallCount } = mkOps(chronicle);
  await ops.actComplete('New Act', { messages: [] });
  assert.strictEqual(getCallCount(), 1, 'only one call: summary, no big picture update');
});
