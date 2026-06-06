// state-referential/tests/engine/ValueStore.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ValueStore } from '../../src/engine/ValueStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { DefinitionStore } from '../../src/engine/DefinitionStore.js';

function mkBus() { const e=[]; return { events:e, emit:(n,p)=>e.push([n,p]), on(){}, off(){} }; }
function mkDefs() {
  const ds = new DefinitionStore(new InMemoryBackend(), mkBus());
  ds.define({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', default: '', describable: true, descriptionScope: 'per-subject' },
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'global' },
  ]});
  ds.define({ id: 'stats', label: 'Stats', fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100, allowDelta: true },
  ]});
  ds.define({ id: 'state', label: 'State', fields: [
    { id: 'mood', label: 'Mood', type: 'enum', options: ['happy','sad'], default: 'happy' },
  ]});
  ds.define({ id: 'rel', label: 'Rel', fields: [
    { id: 'dyn', label: 'Dynamic', type: 'prose', default: '', describable: true },
    { id: 'bonds', label: 'Bonds', type: 'pair-list', default: [] },
  ]});
  ds.define({ id: 'rpg', label: 'RPG', fields: [
    { id: 'stamina', label: 'Stamina', type: 'number', min: 0, default: 100, allowDelta: true, maxFromField: 'max_stamina' },
    { id: 'max_stamina', label: 'Max stamina', type: 'number', min: 0, default: 100, allowDelta: true },
  ]});
  return ds;
}

test('setField writes + emits', () => {
  const bus = mkBus();
  const vs = new ValueStore(new InMemoryBackend(), bus, mkDefs());
  vs.setField('p1', 'outfit', 'topwear', 'red dress', { source: 'manual', msgId: 'tm-1' });
  assert.strictEqual(vs.getField('p1', 'outfit', 'topwear'), 'red dress');
  assert.strictEqual(vs.getStored('p1', 'outfit', 'topwear').lastTouchedMsg, 'tm-1');
  assert.strictEqual(bus.events[0][0], 'tracker:value-changed');
});

test('enum validation', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  assert.throws(() => vs.setField('p1', 'state', 'mood', 'fuming'), /enum/);
});

test('applyDelta clamps', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'stats', 'hp', 50);
  vs.applyDelta('p1', 'stats', 'hp', -100);
  assert.strictEqual(vs.getField('p1', 'stats', 'hp'), 0);
  vs.applyDelta('p1', 'stats', 'hp', 9999);
  assert.strictEqual(vs.getField('p1', 'stats', 'hp'), 100);
});

test('number field accepts missing max (uncapped — used by sensitivities preset)', () => {
  const ds = new DefinitionStore(new InMemoryBackend(), mkBus());
  // No max: must not throw at define time.
  ds.define({ id: 'sens', label: 'Sensitivities', fields: [
    { id: 'breasts', label: 'Breasts', type: 'number', min: 0, default: 100 },
  ]});
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), ds);
  // Any positive integer above the legacy 100 ceiling is accepted.
  vs.setField('p1', 'sens', 'breasts', 250);
  assert.strictEqual(vs.getField('p1', 'sens', 'breasts'), 250);
  vs.setField('p1', 'sens', 'breasts', 9999);
  assert.strictEqual(vs.getField('p1', 'sens', 'breasts'), 9999);
  // min still floors.
  vs.setField('p1', 'sens', 'breasts', -5);
  assert.strictEqual(vs.getField('p1', 'sens', 'breasts'), 0);
});

test('list add/remove unique', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.addListEntry('p1', 'outfit', 'items', 'sword');
  vs.addListEntry('p1', 'outfit', 'items', 'sword');
  vs.addListEntry('p1', 'outfit', 'items', 'potion');
  assert.deepStrictEqual(vs.getField('p1', 'outfit', 'items'), ['sword','potion']);
  vs.removeListEntry('p1', 'outfit', 'items', 'sword');
  assert.deepStrictEqual(vs.getField('p1', 'outfit', 'items'), ['potion']);
});

test('pair-list setPair upserts by name, removePair drops by name', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setPair('p1', 'rel', 'bonds', 'Marcus', 'childhood friend');
  vs.setPair('p1', 'rel', 'bonds', 'Lyra', 'distrusts after Vellmoor');
  assert.deepStrictEqual(vs.getField('p1', 'rel', 'bonds'), [
    { name: 'Marcus', descriptor: 'childhood friend' },
    { name: 'Lyra', descriptor: 'distrusts after Vellmoor' },
  ]);
  // upsert: re-adding Marcus replaces descriptor in place (preserves order)
  vs.setPair('p1', 'rel', 'bonds', 'Marcus', 'rival now');
  assert.deepStrictEqual(vs.getField('p1', 'rel', 'bonds'), [
    { name: 'Marcus', descriptor: 'rival now' },
    { name: 'Lyra', descriptor: 'distrusts after Vellmoor' },
  ]);
  // remove by name
  vs.removePair('p1', 'rel', 'bonds', 'Marcus');
  assert.deepStrictEqual(vs.getField('p1', 'rel', 'bonds'), [
    { name: 'Lyra', descriptor: 'distrusts after Vellmoor' },
  ]);
});

test('pair-list setField normalizes mixed input and dedups by name', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rel', 'bonds', [
    { name: 'Marcus', descriptor: 'rival' },
    'Bare String',                               // coerced to {name, descriptor: ''}
    { name: 'Marcus', descriptor: 'duplicate' }, // dropped (dedup by name, first wins)
    { name: '', descriptor: 'unnamed' },          // dropped (empty name)
  ]);
  assert.deepStrictEqual(vs.getField('p1', 'rel', 'bonds'), [
    { name: 'Marcus', descriptor: 'rival' },
    { name: 'Bare String', descriptor: '' },
  ]);
});

test('pair-list setPair ignores empty name', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setPair('p1', 'rel', 'bonds', '', 'orphan descriptor');
  assert.strictEqual(vs.getField('p1', 'rel', 'bonds'), undefined);
});

test('description per-subject', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setDescription('p1', 'outfit', 'topwear', 'red dress', 'A fitted crimson silk dress.');
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'topwear', 'red dress'), 'A fitted crimson silk dress.');
  assert.strictEqual(vs.getDescription('p2', 'outfit', 'topwear', 'red dress'), null);
});

test('description global for list', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setDescription(null, 'outfit', 'items', 'sword', 'an old blade');
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'items', 'sword'), 'an old blade');
});

test('prose description uses __prose__', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rel', 'dyn', 'they are friends');
  assert.strictEqual(vs.getDescription('p1', 'rel', 'dyn'), 'they are friends');
});

test('invalidateDescription clears', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setDescription('p1', 'outfit', 'topwear', 'red dress', 'd');
  vs.invalidateDescription('p1', 'outfit', 'topwear', 'red dress');
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'topwear', 'red dress'), null);
});

test('clearSubject drops values+descriptions', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'outfit', 'topwear', 'red');
  vs.setDescription('p1', 'outfit', 'topwear', 'red', 'd');
  vs.clearSubject('p1');
  assert.strictEqual(vs.getField('p1', 'outfit', 'topwear'), undefined);
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'topwear', 'red'), null);
});

test('round-trip via backend', () => {
  const b = new InMemoryBackend();
  const defs = mkDefs();
  const vs = new ValueStore(b, mkBus(), defs);
  vs.setField('p1', 'outfit', 'topwear', 'red');
  vs.setDescription('p1', 'outfit', 'topwear', 'red', 'd');
  const vs2 = new ValueStore(b, mkBus(), defs);
  assert.strictEqual(vs2.getField('p1', 'outfit', 'topwear'), 'red');
  assert.strictEqual(vs2.getDescription('p1', 'outfit', 'topwear', 'red'), 'd');
});

test('purgeField removes values and per-subject descriptions for that field only', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'outfit', 'topwear', 'red');
  vs.setField('p1', 'outfit', 'items', ['sword']);
  vs.setDescription('p1', 'outfit', 'topwear', 'red', 'a red top');
  // purge topwear only
  vs.purgeField('outfit', 'topwear');
  assert.strictEqual(vs.getField('p1', 'outfit', 'topwear'), undefined);
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'topwear', 'red'), null);
  // items should be untouched
  assert.deepStrictEqual(vs.getField('p1', 'outfit', 'items'), ['sword']);
});

test('purgeField removes global descriptions for that field only', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setDescription(null, 'outfit', 'items', 'sword', 'an old blade');
  vs.setDescription(null, 'outfit', 'items', 'potion', 'a healing potion');
  vs.purgeField('outfit', 'items');
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'items', 'sword'), null);
  assert.strictEqual(vs.getDescription('p1', 'outfit', 'items', 'potion'), null);
});

test('maxFromField clamps the value to the companion value', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rpg', 'max_stamina', 150);
  vs.setField('p1', 'rpg', 'stamina', 200);   // over the cap
  assert.strictEqual(vs.getField('p1', 'rpg', 'stamina'), 150);
});

test('raising the companion first lets the value climb higher', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rpg', 'max_stamina', 100);
  vs.setField('p1', 'rpg', 'stamina', 100);
  vs.setField('p1', 'rpg', 'max_stamina', 180);
  vs.setField('p1', 'rpg', 'stamina', 160);
  assert.strictEqual(vs.getField('p1', 'rpg', 'stamina'), 160);
});

test('maxFromField with an unset companion is not clamped at 100', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rpg', 'stamina', 250);   // companion never set → no clamp
  assert.strictEqual(vs.getField('p1', 'rpg', 'stamina'), 250);
});

