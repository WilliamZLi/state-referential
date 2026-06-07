import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist'], fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject' },
  ]});
  eng.defineTracker({ id: 'inv', label: 'Inventory', appliesToRoles: ['protagonist'], fields: [
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'per-subject' },
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', appliesToRoles: ['protagonist'], fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100 },
  ]});
  eng.defineTracker({ id: 'rel', label: 'Rel', appliesToRoles: ['protagonist'], fields: [
    { id: 'bonds', label: 'Bonds', type: 'pair-list', default: [] },
  ]});
  return eng;
}

test('replaceListEntry swaps in place, preserving order', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['a', 'b', 'c']);
  eng.values.replaceListEntry(p.id, 'inv', 'items', 'b', 'B2', { source: 'replace' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['a', 'B2', 'c']);
});

test('replaceListEntry appends when the old entry is absent', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['a']);
  eng.values.replaceListEntry(p.id, 'inv', 'items', 'zzz', 'b', { source: 'replace' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['a', 'b']);
});

test('replaceListEntry de-dups when the new value already exists', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['a', 'b']);
  eng.values.replaceListEntry(p.id, 'inv', 'items', 'a', 'b', { source: 'replace' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['b']);
});

test('replaceListEntry fires value-changed with the given source', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['a']);
  const sources = [];
  eng.on('tracker:value-changed', e => sources.push(e.source));
  eng.values.replaceListEntry(p.id, 'inv', 'items', 'a', 'b', { source: 'replace' });
  assert.ok(sources.includes('replace'));
});

test('replaceListEntry throws on a non-list field', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  assert.throws(() => eng.values.replaceListEntry(p.id, 'outfit', 'topwear', 'x', 'y', {}));
});

test('replaceListEntry stamps fresh itemMeta on a timed list field and drops the old', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'state', label: 'State', appliesToRoles: ['protagonist'], fields: [
    { id: 'effects', label: 'Effects', type: 'list', default: [], describable: true, descriptionScope: 'per-subject', inclusion: { rule: 'active', activeWindow: 3 } },
  ]});
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.addListEntry(p.id, 'state', 'effects', 'mild curse', { msgId: 'm1' });
  eng.values.replaceListEntry(p.id, 'state', 'effects', 'mild curse', 'intense curse', { source: 'replace', msgId: 'm5' });
  const meta = eng.getListMeta(p.id, 'state', 'effects');
  assert.ok(meta['intense curse'], 'new entry has itemMeta');
  assert.strictEqual(meta['intense curse'].addedAtMsg, 'm5', 'new entry stamped with the replace msgId');
  assert.ok(!meta['mild curse'], 'old entry itemMeta dropped');
  assert.deepStrictEqual(eng.getField(p.id, 'state', 'effects'), ['intense curse']);
});

test('REPLACE swaps a list entry in place and emits entry-replaced with prior description', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['torch', 'magic staff', 'rope']);
  eng.setDescription(p.id, 'inv', 'items', 'magic staff', 'a carved oak staff with a glowing gem');
  const events = [];
  eng.on('tracker:entry-replaced', e => events.push(e));
  const res = eng.applyCommands('REPLACE Cersia inv.items "magic staff" WITH "magic staff (broken)"');
  assert.strictEqual(res.applied, 1);
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['torch', 'magic staff (broken)', 'rope']);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].oldValue, 'magic staff');
  assert.strictEqual(events[0].newValue, 'magic staff (broken)');
  assert.strictEqual(events[0].priorDescription, 'a carved oak staff with a glowing gem');
  assert.strictEqual(eng.getDescription(p.id, 'inv', 'items', 'magic staff'), 'a carved oak staff with a glowing gem');
});

test('REPLACE on a scalar text field sets the new value and emits prior description', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  eng.setDescription(p.id, 'outfit', 'topwear', 'red dress', 'a slinky red silk dress');
  const events = [];
  eng.on('tracker:entry-replaced', e => events.push(e));
  const res = eng.applyCommands('REPLACE Cersia outfit.topwear "red dress" WITH "red dress (torn)"');
  assert.strictEqual(res.applied, 1);
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'red dress (torn)');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].priorDescription, 'a slinky red silk dress');
});

test('REPLACE with a missing old value degrades to add with null prior description', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['torch']);
  const events = [];
  eng.on('tracker:entry-replaced', e => events.push(e));
  const res = eng.applyCommands('REPLACE Cersia inv.items "ghost item" WITH "new item"');
  assert.strictEqual(res.applied, 1);
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['torch', 'new item']);
  assert.strictEqual(events[0].priorDescription, null);
});

test('REPLACE fires value-changed with source "replace"', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['magic staff']);
  const sources = [];
  eng.on('tracker:value-changed', e => sources.push(e.source));
  eng.applyCommands('REPLACE Cersia inv.items "magic staff" WITH "magic staff (broken)"');
  assert.ok(sources.includes('replace'));
});

test('REPLACE is rejected for number and pair-list fields', () => {
  const eng = mkEngine();
  eng.addSubject('Cersia', { role: 'protagonist' });
  const r1 = eng.applyCommands('REPLACE Cersia stats.hp "100" WITH "50"');
  assert.strictEqual(r1.applied, 0);
  assert.ok(r1.errors.some(e => /REPLACE unsupported/i.test(e)));
  const r2 = eng.applyCommands('REPLACE Cersia rel.bonds "Marcus" WITH "Marcus (rival)"');
  assert.strictEqual(r2.applied, 0);
  assert.ok(r2.errors.some(e => /REPLACE unsupported/i.test(e)));
});
