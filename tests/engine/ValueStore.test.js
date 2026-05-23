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

test('list add/remove unique', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.addListEntry('p1', 'outfit', 'items', 'sword');
  vs.addListEntry('p1', 'outfit', 'items', 'sword');
  vs.addListEntry('p1', 'outfit', 'items', 'potion');
  assert.deepStrictEqual(vs.getField('p1', 'outfit', 'items'), ['sword','potion']);
  vs.removeListEntry('p1', 'outfit', 'items', 'sword');
  assert.deepStrictEqual(vs.getField('p1', 'outfit', 'items'), ['potion']);
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
