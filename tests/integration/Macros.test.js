import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { resolveMacro, resolveListMacro, resolveTagMacro, resolveTrackerBlock, resolveAllTrackers, resolveProbe } from '../../src/integration/Macros.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject' },
    { id: 'items', label: 'Items', type: 'list', describable: true, descriptionScope: 'global' },
  ]});
  return eng;
}

test('maxFromField macro falls back to the companion default when unset', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'rpg', label: 'RPG', fields: [
    { id: 'stamina', label: 'Stamina', type: 'number', min: 0, default: 100, maxFromField: 'max_stamina' },
    { id: 'max_stamina', label: 'Max stamina', type: 'number', min: 0, default: 100 },
  ]});
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'rpg', 'stamina', 75);   // max_stamina value left unset → default 100
  assert.strictEqual(resolveMacro(eng, 'Lyra.rpg.stamina'), '75/100');
});

test('tracker::<subject>.<tracker>.<field> value', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  assert.strictEqual(resolveMacro(eng, 'Lyra.outfit.topwear'), 'red dress');
  assert.strictEqual(resolveMacro(eng, 'protagonist.outfit.topwear'), 'red dress');
});

test('.desc fallback to value when no description cached', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  assert.strictEqual(resolveMacro(eng, 'Lyra.outfit.topwear.desc'), '');
  eng.setDescription(p.id, 'outfit', 'topwear', 'red dress', 'A fitted dress.');
  assert.strictEqual(resolveMacro(eng, 'Lyra.outfit.topwear.desc'), 'A fitted dress.');
});

test('tracker-list with .desc concatenates entry descriptions', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.addListEntry(p.id, 'outfit', 'items', 'sword');
  eng.addListEntry(p.id, 'outfit', 'items', 'potion');
  eng.setDescription(null, 'outfit', 'items', 'sword', 'an old blade');
  eng.setDescription(null, 'outfit', 'items', 'potion', 'a vial');
  const result = resolveListMacro(eng, 'Lyra.outfit.items.desc');
  assert.match(result, /sword.*an old blade/);
  assert.match(result, /potion.*a vial/);
});

test('tag macro variants', () => {
  const eng = mkEngine();
  assert.strictEqual(resolveTagMacro(eng, 'intimate'), '');
  eng.setSceneTag('intimate', true);
  assert.strictEqual(resolveTagMacro(eng, 'intimate'), '1');
  assert.strictEqual(resolveTagMacro(eng, 'intimate::on::Yes'), 'Yes');
  assert.strictEqual(resolveTagMacro(eng, 'intimate::off::No'), '');
});

test('missing subject/tracker/field returns empty string', () => {
  const eng = mkEngine();
  assert.strictEqual(resolveMacro(eng, 'Ghost.outfit.topwear'), '');
  assert.strictEqual(resolveMacro(eng, 'Lyra.nothing.field'), '');
});

test('whole-tracker macro returns rendered block including all enabled fields', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red dress');
  eng.addListEntry(p.id, 'outfit', 'items', 'sword');
  const result = resolveTrackerBlock(eng, 'Lyra.outfit');
  assert.ok(result.includes('Topwear'), 'should include field label');
  assert.ok(result.includes('red dress'), 'should include field value');
  assert.ok(result.includes('sword'), 'should include list entry');
});

test('._probe macro returns stored probe text for subject+tracker, empty when not stored', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const proseStore = {};

  // Not stored yet — should return empty string
  assert.strictEqual(resolveProbe(eng, 'Lyra.outfit._probe', proseStore), '');

  // Store some prose
  proseStore['outfit'] = { [p.id]: 'She wears a flowing red gown.' };
  assert.strictEqual(resolveProbe(eng, 'Lyra.outfit._probe', proseStore), 'She wears a flowing red gown.');

  // Unknown subject should still return empty
  assert.strictEqual(resolveProbe(eng, 'Ghost.outfit._probe', proseStore), '');
});
