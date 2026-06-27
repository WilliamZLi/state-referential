// state-referential/tests/engine/ValueStore.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ValueStore } from '../../src/engine/ValueStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { DefinitionStore } from '../../src/engine/DefinitionStore.js';

function mkBus() { const e=[]; return { events:e, emit:(n,p)=>e.push([n,p]), on(){}, off(){} }; }

function mkLedger() {
  const ds = new DefinitionStore(new InMemoryBackend(), mkBus());
  ds.define({ id: 'ledger', label: 'Ledger', fields: [
    { id: 'threads', label: 'Threads', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', min: 0, default: 0 },
      { id: 'status', label: 'Status', type: 'enum', options: ['open', 'fulfilled', 'failed'], default: 'open' },
    ]},
  ]});
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), ds);
  const S = 'protagonist';
  return { vs, S };
}

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

test('maxFromField with an unset companion clamps to the companion default', () => {
  const vs = new ValueStore(new InMemoryBackend(), mkBus(), mkDefs());
  vs.setField('p1', 'rpg', 'stamina', 250);   // max_stamina value unset → falls back to its default (100)
  assert.strictEqual(vs.getField('p1', 'rpg', 'stamina'), 100);
});

test('struct-list: setStruct upserts by case-insensitive name, defaults applied', () => {
  const { vs, S } = mkLedger();
  vs.setStruct(S, 'ledger', 'threads', 'Merchant debt', { detail: 'lantern', amount: 50, status: 'open' });
  vs.setStruct(S, 'ledger', 'threads', 'merchant debt', { amount: 40 }); // re-case → same row, merge
  const rows = vs.getField(S, 'ledger', 'threads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Merchant debt');     // original casing kept
  assert.equal(rows[0].amount, 40);                // merged
  assert.equal(rows[0].detail, 'lantern');         // preserved
  assert.equal(rows[0].status, 'open');
});

test('struct-list: deltaStructField does engine math, clamps to min', () => {
  const { vs, S } = mkLedger();
  vs.setStruct(S, 'ledger', 'threads', 'Debt', { amount: 50, status: 'open' });
  vs.deltaStructField(S, 'ledger', 'threads', 'debt', 'amount', -10);
  assert.equal(vs.getField(S, 'ledger', 'threads')[0].amount, 40);
  vs.deltaStructField(S, 'ledger', 'threads', 'Debt', 'amount', -999);
  assert.equal(vs.getField(S, 'ledger', 'threads')[0].amount, 0); // clamped to min 0
});

test('struct-list: setStruct rejects an invalid enum sub-value (keeps prior)', () => {
  const { vs, S } = mkLedger();
  vs.setStruct(S, 'ledger', 'threads', 'Q', { status: 'open' });
  vs.setStruct(S, 'ledger', 'threads', 'Q', { status: 'bogus' });
  assert.equal(vs.getField(S, 'ledger', 'threads')[0].status, 'open');
});

test('struct-list: removeStruct deletes by case-insensitive name', () => {
  const { vs, S } = mkLedger();
  vs.setStruct(S, 'ledger', 'threads', 'Q', { status: 'open' });
  vs.removeStruct(S, 'ledger', 'threads', 'q');
  assert.deepEqual(vs.getField(S, 'ledger', 'threads'), []);
});

test('struct-list: _validate normalizes strings + applies defaults on direct setField', () => {
  const { vs, S } = mkLedger();
  vs.setField(S, 'ledger', 'threads', ['Bare', { name: 'Full', amount: 5 }]);
  const rows = vs.getField(S, 'ledger', 'threads');
  assert.equal(rows[0].name, 'Bare');
  assert.equal(rows[0].status, 'open');   // default applied
  assert.equal(rows[1].amount, 5);
});

