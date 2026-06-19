import { test } from 'node:test';
import assert from 'node:assert';
import { register } from '../../src/integration/L3SlashCommands.js';

function mkRig() {
  const registered = {};
  const SlashCommandParser = { addCommandObject: (o) => { registered[o.name] = o.callback; } };
  const SlashCommand = { fromProps: (p) => p };
  const log = [];
  const deps = {
    SlashCommandParser, SlashCommand,
    compaction: { run: async (o) => { log.push(['compact', o]); return { compacted: true, count: 3 }; } },
    restore: async (id) => { log.push(['restore', id]); return { restored: true, count: 2 }; },
    actComplete: async (title) => { log.push(['act', title]); return { title }; },
    toggleAnchorAtSlash: (reason) => { log.push(['anchor', reason]); return true; },
    gotoMainline: async () => { log.push(['goto']); },
    branchCreate: async (o) => { log.push(['branchCreate', o]); },
    branchDiscard: async () => { log.push(['branchDiscard']); },
    branchLastN: () => 10,
  };
  register(deps);
  return { registered, log };
}

test('registers all five L3 commands', () => {
  const { registered } = mkRig();
  for (const name of ['anchor', 'compact-now', 'compact-restore', 'act-complete', 'mainline-go']) {
    assert.equal(typeof registered[name], 'function', `missing /${name}`);
  }
});

test('/compact-now passes a numeric count when provided', async () => {
  const { registered, log } = mkRig();
  await registered['compact-now']({}, '5');
  assert.deepStrictEqual(log[0], ['compact', { count: 5 }]);
});

test('/compact-now with no value runs auto-range', async () => {
  const { registered, log } = mkRig();
  await registered['compact-now']({}, '');
  assert.deepStrictEqual(log[0], ['compact', {}]);
});

test('/compact-restore forwards the archive id', async () => {
  const { registered, log } = mkRig();
  await registered['compact-restore']({}, 'arch-9');
  assert.deepStrictEqual(log[0], ['restore', 'arch-9']);
});

test('/act-complete forwards the title', async () => {
  const { registered, log } = mkRig();
  await registered['act-complete']({}, 'The Fall of Eldoria');
  assert.deepStrictEqual(log[0], ['act', 'The Fall of Eldoria']);
});

test('/anchor forwards the optional reason', async () => {
  const { registered, log } = mkRig();
  await registered['anchor']({}, 'pivotal');
  assert.deepStrictEqual(log[0], ['anchor', 'pivotal']);
});

test('/compact-now returns the success summary string', async () => {
  const { registered } = mkRig();
  const out = await registered['compact-now']({}, '');
  assert.equal(out, 'Compacted 3 messages.');
});

test('/compact-now reports when nothing is eligible', async () => {
  const registered = {};
  const SlashCommandParser = { addCommandObject: (o) => { registered[o.name] = o.callback; } };
  const SlashCommand = { fromProps: (p) => p };
  register({
    SlashCommandParser, SlashCommand,
    compaction: { run: async () => ({ compacted: false }) },
    restore: async () => ({}), actComplete: async () => ({}),
    toggleAnchorAtSlash: () => {}, gotoMainline: async () => {},
  });
  assert.equal(await registered['compact-now']({}, ''), 'Nothing to compact.');
});

test('/compact-restore reports a missing archive', async () => {
  const registered = {};
  const SlashCommandParser = { addCommandObject: (o) => { registered[o.name] = o.callback; } };
  const SlashCommand = { fromProps: (p) => p };
  register({
    SlashCommandParser, SlashCommand,
    compaction: { run: async () => ({}) },
    restore: async () => ({ restored: false }), actComplete: async () => ({}),
    toggleAnchorAtSlash: () => {}, gotoMainline: async () => {},
  });
  assert.equal(await registered['compact-restore']({}, 'nope'), 'Archive not found.');
});

test('registers /branch-here and /branch-discard', () => {
  const { registered } = mkRig();
  assert.equal(typeof registered['branch-here'], 'function');
  assert.equal(typeof registered['branch-discard'], 'function');
});

test('/branch-here forwards the title and the configured lastN', async () => {
  const { registered, log } = mkRig();
  await registered['branch-here']({}, 'Dungeon A');
  assert.deepEqual(log[0], ['branchCreate', { title: 'Dungeon A', lastN: 10, inheritTags: true }]);
});

test('/branch-here defaults the title when empty', async () => {
  const { registered, log } = mkRig();
  await registered['branch-here']({}, '');
  assert.equal(log[0][1].title, 'Branch');
});

test('/branch-discard calls branchDiscard', async () => {
  const { registered, log } = mkRig();
  await registered['branch-discard']({}, '');
  assert.deepEqual(log[0], ['branchDiscard']);
});
