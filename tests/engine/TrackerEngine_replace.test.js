import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

export function mkEngine() {
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
