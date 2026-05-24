// state-referential/tests/engine/TrackerEngine_cascade.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', default: '' },
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100 },
  ]});
  eng.defineTracker({ id: 'inv', label: 'Inv', fields: [
    { id: 'items', label: 'Items', type: 'list', default: [] },
  ]});
  return eng;
}

test('deleteTracker removes orphaned values', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  // Value exists before delete
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'red');
  eng.deleteTracker('outfit');
  // After delete, values for the tracker should be gone
  assert.strictEqual(eng.values._values[p.id]?.['outfit'], undefined);
});

test('deleteTracker removes orphaned descriptions', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  // Set a description for the field value
  eng.setDescription(p.id, 'outfit', 'topwear', 'red', 'A red top');
  // Confirm description exists
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'red'), 'A red top');
  eng.deleteTracker('outfit');
  // After delete, per-subject description should be gone
  const subjDescs = eng.values._desc.perSubject?.[p.id] ?? {};
  const hasOutfitKeys = Object.keys(subjDescs).some(k => k.startsWith('outfit.'));
  assert.strictEqual(hasOutfitKeys, false);
});

test('removeSubject removes that subject\'s values', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'stats', 'hp', 80);
  // Values exist
  assert.strictEqual(eng.getField(p.id, 'stats', 'hp'), 80);
  eng.removeSubject('Lyra');
  // After remove, values for the subject should be gone
  assert.strictEqual(eng.values._values[p.id], undefined);
});

test('removeSubject removes that subject\'s descriptions', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'blue');
  eng.setDescription(p.id, 'outfit', 'topwear', 'blue', 'A blue shirt');
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'blue'), 'A blue shirt');
  eng.removeSubject('Lyra');
  // After remove, descriptions for the subject should be gone
  assert.strictEqual(eng.values._desc.perSubject?.[p.id], undefined);
});

test('updateTracker migrates list→text value to first entry', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.addListEntry(p.id, 'inv', 'items', 'sword');
  eng.addListEntry(p.id, 'inv', 'items', 'shield');
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['sword', 'shield']);
  // Change the field type from list to text
  eng.updateTracker('inv', { fields: [
    { id: 'items', label: 'Items', type: 'text', default: '' },
  ]});
  // After migration, value should be first element as string
  assert.strictEqual(eng.getField(p.id, 'inv', 'items'), 'sword');
});

test('updateTracker migrates text→list by wrapping in array', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  // Change field type from text to list
  eng.updateTracker('outfit', { fields: [
    { id: 'topwear', label: 'Topwear', type: 'list', default: [] },
  ]});
  // After migration, value should be wrapped in array
  assert.deepStrictEqual(eng.getField(p.id, 'outfit', 'topwear'), ['red dress']);
});

test('updateTracker migrates number→text by stringifying', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'stats', 'hp', 75);
  // Change field type from number to text
  eng.updateTracker('stats', { fields: [
    { id: 'hp', label: 'HP', type: 'text', default: '' },
  ]});
  // After migration, value should be a string
  assert.strictEqual(eng.getField(p.id, 'stats', 'hp'), '75');
});
