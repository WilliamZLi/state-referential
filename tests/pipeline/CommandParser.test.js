// state-referential/tests/pipeline/CommandParser.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { parseCommands } from '../../src/pipeline/CommandParser.js';

test('SET with quoted value', () => {
  const r = parseCommands(`SET Lyra outfit.topwear = "red silk dress"`);
  assert.deepStrictEqual(r, [{ op: 'SET', subject: 'Lyra', tracker: 'outfit', field: 'topwear', value: 'red silk dress' }]);
});

test('SET with unquoted single-word value', () => {
  const r = parseCommands(`SET Lyra outfit.topwear = red`);
  assert.deepStrictEqual(r, [{ op: 'SET', subject: 'Lyra', tracker: 'outfit', field: 'topwear', value: 'red' }]);
});

test('DELTA positive and negative', () => {
  const r = parseCommands(`DELTA Lyra stats.hp -10\nDELTA Lyra stats.hp +5`);
  assert.deepStrictEqual(r, [
    { op: 'DELTA', subject: 'Lyra', tracker: 'stats', field: 'hp', delta: -10 },
    { op: 'DELTA', subject: 'Lyra', tracker: 'stats', field: 'hp', delta: 5 },
  ]);
});

test('ADD and REMOVE list entries', () => {
  const r = parseCommands(`ADD Lyra inv.items "obsidian amulet"\nREMOVE Lyra inv.items rope`);
  assert.deepStrictEqual(r, [
    { op: 'ADD', subject: 'Lyra', tracker: 'inv', field: 'items', entry: 'obsidian amulet' },
    { op: 'REMOVE', subject: 'Lyra', tracker: 'inv', field: 'items', entry: 'rope' },
  ]);
});

test('ADD pair-list with = "<descriptor>" tail', () => {
  const r = parseCommands(`ADD Lyra rel.bonds "Marcus" = "childhood friend turned rival"`);
  assert.deepStrictEqual(r, [
    { op: 'ADD', subject: 'Lyra', tracker: 'rel', field: 'bonds', entry: 'Marcus', descriptor: 'childhood friend turned rival' },
  ]);
});

test('ADD pair-list without descriptor still parses (legacy list path)', () => {
  const r = parseCommands(`ADD Lyra rel.bonds "Marcus"`);
  assert.deepStrictEqual(r, [
    { op: 'ADD', subject: 'Lyra', tracker: 'rel', field: 'bonds', entry: 'Marcus' },
  ]);
});

test('NEW_SUBJECT with role', () => {
  const r = parseCommands(`NEW_SUBJECT "Cult Priest" npc`);
  assert.deepStrictEqual(r, [{ op: 'NEW_SUBJECT', name: 'Cult Priest', role: 'npc' }]);
});

test('NONE produces empty result', () => {
  assert.deepStrictEqual(parseCommands(`NONE`), []);
});

test('smart quotes accepted', () => {
  const r = parseCommands(`SET Lyra outfit.topwear = "red dress"`);
  assert.strictEqual(r[0].value, 'red dress');
});

test('unknown lines ignored', () => {
  const r = parseCommands(`SET Lyra outfit.topwear = "red"\nThis is gibberish\n\nNONE`);
  assert.strictEqual(r.length, 1);
});

test('command cap honored', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `DELTA Lyra stats.hp +1`).join('\n');
  assert.strictEqual(parseCommands(lines, { cap: 5 }).length, 5);
});

test('multi-word subject not supported in SET subject slot (single token)', () => {
  const r = parseCommands(`NEW_SUBJECT "Cult Priest" npc\nSET Cult outfit.topwear = "robes"`);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].subject, 'Cult');
});
