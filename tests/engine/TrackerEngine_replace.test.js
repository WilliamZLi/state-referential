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
