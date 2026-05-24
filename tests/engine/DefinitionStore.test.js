import { test } from 'node:test';
import assert from 'node:assert';
import { DefinitionStore } from '../../src/engine/DefinitionStore.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkBus() {
  const events = [];
  return { events, emit: (n, p) => events.push([n, p]), on() {}, off() {} };
}

test('define+get+list', () => {
  const b = new InMemoryBackend();
  const bus = mkBus();
  const store = new DefinitionStore(b, bus);
  store.define({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist'], fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', default: '' }
  ]});
  assert.strictEqual(store.get('outfit').label, 'Outfit');
  assert.deepStrictEqual(store.list().map(d => d.id), ['outfit']);
  assert.deepStrictEqual(bus.events[0], ['tracker:schema-changed', { trackerId: 'outfit' }]);
});

test('define throws on missing id or duplicate', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  assert.throws(() => store.define({ label: 'x', fields: [] }), /id/);
  store.define({ id: 'x', label: 'x', fields: [] });
  assert.throws(() => store.define({ id: 'x', label: 'x', fields: [] }), /exists/);
});

test('update merges and emits', () => {
  const bus = mkBus();
  const store = new DefinitionStore(new InMemoryBackend(), bus);
  store.define({ id: 'a', label: 'A', fields: [] });
  store.update('a', { label: 'A!' });
  assert.strictEqual(store.get('a').label, 'A!');
});

test('delete drops and emits', () => {
  const bus = mkBus();
  const store = new DefinitionStore(new InMemoryBackend(), bus);
  store.define({ id: 'a', label: 'A', fields: [] });
  store.delete('a');
  assert.strictEqual(store.get('a'), undefined);
  assert.ok(bus.events.find(e => e[0] === 'tracker:schema-changed' && e[1].trackerId === 'a'));
});

test('appliesToRoles defaults to all roles', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  store.define({ id: 'a', label: 'A', fields: [] });
  assert.deepStrictEqual(store.get('a').appliesToRoles.sort(), ['faction','location','npc','object','protagonist']);
});

test('field validation: list/enum require options/default rules', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  assert.throws(() => store.define({ id: 'a', label: 'A', fields: [{ id: 'x', type: 'enum' }] }), /options/);
  assert.throws(() => store.define({ id: 'b', label: 'B', fields: [{ id: 'x', type: 'number' }] }), /min|max/);
});

test('persists via backend.saveDefinitions', () => {
  const b = new InMemoryBackend();
  const store = new DefinitionStore(b, mkBus());
  store.define({ id: 'a', label: 'A', fields: [] });
  assert.strictEqual(b.loadDefinitions()[0].id, 'a');
});

test('normalizeDef preserves unknown top-level keys', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  store.define({
    id: 'tk', label: 'TK', fields: [],
    userNotes: 'some note', customMetadata: { foo: 42 },
  });
  const d = store.get('tk');
  assert.strictEqual(d.userNotes, 'some note');
  assert.deepStrictEqual(d.customMetadata, { foo: 42 });
});

test('normalizeDef preserves unknown field-level keys', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  store.define({
    id: 'tk', label: 'TK',
    fields: [
      { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, fieldNote: 'track carefully', customTag: 'vital' },
    ],
  });
  const d = store.get('tk');
  assert.strictEqual(d.fields[0].fieldNote, 'track carefully');
  assert.strictEqual(d.fields[0].customTag, 'vital');
});

test('normalizeDef: tracker-level injection block; field injection strips to enabled only', () => {
  const store = new DefinitionStore(new InMemoryBackend(), mkBus());
  store.define({
    id: 'tk', label: 'TK',
    injection: { enabled: true, trigger: 'tag', tags: ['combat'], position: 'system', depth: 1, template: '{{fields}}' },
    fields: [
      { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100,
        injection: { enabled: true, trigger: 'tag', tags: ['x'], position: 'system', depth: 9, template: 'IGNORE' } },
      { id: 'name', label: 'Name', type: 'text' },
    ],
  });
  const d = store.get('tk');
  // tracker-level injection
  assert.deepStrictEqual(d.injection, {
    enabled: true, trigger: 'tag', tags: ['combat'],
    position: 'system', depth: 1, template: '{{fields}}',
  });
  // field-level injection: only enabled key, extra keys stripped
  assert.deepStrictEqual(d.fields.find(f => f.id === 'hp').injection, { enabled: true });
  // field with no injection: defaults to enabled:true
  assert.deepStrictEqual(d.fields.find(f => f.id === 'name').injection, { enabled: true });
});
