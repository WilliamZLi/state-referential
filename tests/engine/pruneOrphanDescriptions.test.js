import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist'], fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject' },
  ]});
  eng.defineTracker({ id: 'wardrobe', label: 'Wardrobe', appliesToRoles: ['protagonist'], fields: [
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'per-subject' },
  ]});
  eng.defineTracker({ id: 'gear', label: 'Gear', appliesToRoles: ['protagonist'], fields: [
    { id: 'weapon', label: 'Weapon', type: 'text', describable: true, descriptionScope: 'global' },
  ]});
  return eng;
}

test('prune removes per-subject descriptions no longer referenced, keeps worn + wardrobe', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'blue tunic');
  eng.setDescription(p.id, 'outfit', 'topwear', 'blue tunic', 'a fitted blue tunic'); // worn → keep
  eng.setDescription(p.id, 'outfit', 'topwear', 'red dress', 'a slinky red dress');   // orphan → nuke
  eng.setField(p.id, 'wardrobe', 'items', ['mage robes']);
  eng.setDescription(p.id, 'wardrobe', 'items', 'mage robes', 'soaked wool robes');    // in wardrobe → keep

  const removed = eng.pruneOrphanDescriptions();

  assert.strictEqual(removed, 1, 'only the orphaned red dress is removed');
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'blue tunic'), 'a fitted blue tunic');
  assert.strictEqual(eng.getDescription(p.id, 'outfit', 'topwear', 'red dress'), null);
  assert.strictEqual(eng.getDescription(p.id, 'wardrobe', 'items', 'mage robes'), 'soaked wool robes');
});

test('prune removes orphaned global descriptions, keeps referenced', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'gear', 'weapon', 'longsword');
  eng.setDescription(p.id, 'gear', 'weapon', 'longsword', 'a steel longsword');
  eng.setDescription(p.id, 'gear', 'weapon', 'rusty dagger', 'an old dagger'); // orphan
  const removed = eng.pruneOrphanDescriptions();
  assert.strictEqual(removed, 1);
  assert.strictEqual(eng.getDescription(p.id, 'gear', 'weapon', 'longsword'), 'a steel longsword');
  assert.strictEqual(eng.getDescription(p.id, 'gear', 'weapon', 'rusty dagger'), null);
});

test('prune keeps a global value still referenced by a different subject', () => {
  const eng = mkEngine();
  const a = eng.addSubject('Cersia', { role: 'protagonist' });
  const b = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(b.id, 'gear', 'weapon', 'longsword'); // Lyra still wields it
  eng.setDescription(a.id, 'gear', 'weapon', 'longsword', 'a steel longsword');
  const removed = eng.pruneOrphanDescriptions();
  assert.strictEqual(removed, 0, 'still referenced by Lyra → kept');
  assert.strictEqual(eng.getDescription(a.id, 'gear', 'weapon', 'longsword'), 'a steel longsword');
});

test('prune never nukes prose (__prose__) descriptions', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'bio', label: 'Bio', appliesToRoles: ['protagonist'], fields: [
    { id: 'backstory', label: 'Backstory', type: 'prose', describable: true, descriptionScope: 'per-subject' },
  ]});
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'bio', 'backstory', 'Once a court mage...');
  const removed = eng.pruneOrphanDescriptions();
  assert.strictEqual(removed, 0);
  assert.strictEqual(eng.getDescription(p.id, 'bio', 'backstory', null), 'Once a court mage...');
});

test('prune returns 0 when nothing is orphaned', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'blue tunic');
  eng.setDescription(p.id, 'outfit', 'topwear', 'blue tunic', 'a fitted blue tunic');
  assert.strictEqual(eng.pruneOrphanDescriptions(), 0);
});
