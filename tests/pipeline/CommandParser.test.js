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

test('SET unescapes an escaped inner quote (inch mark) in the value', () => {
  const r = parseCommands(`SET Cersia outfit.footwear = "3\\" stiletto high heels"`);
  assert.deepStrictEqual(r, [{ op: 'SET', subject: 'Cersia', tracker: 'outfit', field: 'footwear', value: '3" stiletto high heels' }]);
});

test('ADD list entry unescapes an escaped inner quote', () => {
  const r = parseCommands(`ADD Cersia inv.items "3\\" dagger"`);
  assert.deepStrictEqual(r, [{ op: 'ADD', subject: 'Cersia', tracker: 'inv', field: 'items', entry: '3" dagger' }]);
});

test('ADD pair-list with an escaped quote in the name still finds the = descriptor', () => {
  const r = parseCommands(`ADD Cersia rel.bonds "the 6\\" knife" = "trusty"`);
  assert.deepStrictEqual(r, [{ op: 'ADD', subject: 'Cersia', tracker: 'rel', field: 'bonds', entry: 'the 6" knife', descriptor: 'trusty' }]);
});

test('NEW_SUBJECT with role', () => {
  const r = parseCommands(`NEW_SUBJECT "Cult Priest" npc`);
  assert.deepStrictEqual(r, [{ op: 'NEW_SUBJECT', name: 'Cult Priest', role: 'npc' }]);
});

test('NONE produces empty result', () => {
  assert.deepStrictEqual(parseCommands(`NONE`), []);
});

test('smart (curly) double quotes are normalized in a SET value', () => {
  const r = parseCommands('SET Lyra outfit.topwear = “red dress”');
  assert.strictEqual(r[0].value, 'red dress');
});

test('smart (curly) double quotes are normalized in an ADD entry', () => {
  const r = parseCommands('ADD Lyra inv.items “obsidian amulet”');
  assert.deepStrictEqual(r, [{ op: 'ADD', subject: 'Lyra', tracker: 'inv', field: 'items', entry: 'obsidian amulet' }]);
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

test('REPLACE with quoted old and new', () => {
  const r = parseCommands(`REPLACE Cersia inv.items "magic staff" WITH "magic staff (broken)"`);
  assert.deepStrictEqual(r, [{ op: 'REPLACE', subject: 'Cersia', tracker: 'inv', field: 'items', oldEntry: 'magic staff', newEntry: 'magic staff (broken)' }]);
});

test('REPLACE accepts lowercase "with"', () => {
  const r = parseCommands(`REPLACE Cersia outfit.topwear "red dress" with "red dress (torn)"`);
  assert.deepStrictEqual(r, [{ op: 'REPLACE', subject: 'Cersia', tracker: 'outfit', field: 'topwear', oldEntry: 'red dress', newEntry: 'red dress (torn)' }]);
});

test('REPLACE with an unquoted single-word old', () => {
  const r = parseCommands(`REPLACE Cersia inv.items staff WITH "broken staff"`);
  assert.deepStrictEqual(r, [{ op: 'REPLACE', subject: 'Cersia', tracker: 'inv', field: 'items', oldEntry: 'staff', newEntry: 'broken staff' }]);
});

test('REPLACE unescapes an inner quote in the values', () => {
  const r = parseCommands(`REPLACE Cersia inv.items "3\\" pole" WITH "3\\" pole (bent)"`);
  assert.deepStrictEqual(r, [{ op: 'REPLACE', subject: 'Cersia', tracker: 'inv', field: 'items', oldEntry: '3" pole', newEntry: '3" pole (bent)' }]);
});

test('malformed REPLACE without WITH is ignored', () => {
  const r = parseCommands(`REPLACE Cersia inv.items "magic staff" "broken"`);
  assert.deepStrictEqual(r, []);
});

test('ADD with key=value tail parses struct-list sub-fields', () => {
  const [c] = parseCommands('ADD Cersia ledger.threads "Merchant debt" detail="owed for lantern" amount=50 status=open');
  assert.equal(c.op, 'ADD'); assert.equal(c.entry, 'Merchant debt');
  assert.deepEqual(c.fields, { detail: 'owed for lantern', amount: '50', status: 'open' });
});

test('ADD with "name" = "descriptor" still parses as pair-list (not struct)', () => {
  const [c] = parseCommands('ADD Cersia rel.bonds "Khola" = "a merchant"');
  assert.equal(c.descriptor, 'a merchant');
  assert.equal(c.fields, undefined);
});

test('SET "name" key=value parses struct-list update', () => {
  const [c] = parseCommands('SET Cersia ledger.threads "Merchant debt" status=fulfilled');
  assert.equal(c.op, 'SET'); assert.equal(c.entry, 'Merchant debt');
  assert.deepEqual(c.fields, { status: 'fulfilled' });
});

test('SET scalar form (= value) is unchanged', () => {
  const [c] = parseCommands('SET Cersia stats.mood = "calm"');
  assert.equal(c.value, 'calm'); assert.equal(c.entry, undefined);
});

test('DELTA "name" sub ±N parses struct-list sub-field delta', () => {
  const [c] = parseCommands('DELTA Cersia ledger.threads "Merchant debt" amount -10');
  assert.equal(c.op, 'DELTA'); assert.equal(c.entry, 'Merchant debt');
  assert.equal(c.subField, 'amount'); assert.equal(c.delta, -10);
});

test('DELTA scalar form is unchanged', () => {
  const [c] = parseCommands('DELTA Cersia stats.arousal +5');
  assert.equal(c.delta, 5); assert.equal(c.entry, undefined);
});
