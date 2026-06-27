// state-referential/tests/engine/TrackerEngine.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';
import { parseCommands } from '../../src/pipeline/CommandParser.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', default: '' }
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100, allowDelta: true }
  ]});
  eng.defineTracker({ id: 'inv', label: 'Inv', fields: [
    { id: 'items', label: 'Items', type: 'list', default: [] }
  ]});
  return eng;
}

test('events bubble', () => {
  const eng = mkEngine();
  const seen = [];
  eng.on('tracker:value-changed', e => seen.push(e));
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  assert.strictEqual(seen.length, 1);
});

test('snapshot+restore', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const s1 = eng.snapshot();
  eng.setField(p.id, 'outfit', 'topwear', 'blue');
  eng.restoreSnapshot(s1);
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'red');
});

test('restoreSnapshot does NOT revert scene tags (sticky user controls)', () => {
  const eng = mkEngine();
  const s1 = eng.snapshot();             // snapshot with no tags active
  eng.setSceneTag('intimate', true);      // user enables a tag afterward
  eng.restoreSnapshot(s1);                 // undo to the older snapshot...
  // ...tag must survive — tags are sticky across swipe/delete/regen
  assert.deepStrictEqual(eng.listActiveTags(), ['intimate']);
});

test('diffSnapshots reports value/list/subject changes', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const a = eng.snapshot();
  eng.setField(p.id, 'outfit', 'topwear', 'blue');
  eng.applyDelta(p.id, 'stats', 'hp', -10);
  eng.addListEntry(p.id, 'inv', 'items', 'sword');
  eng.addSubject('Maya', { role: 'npc' });
  const b = eng.snapshot();
  const d = eng.diffSnapshots(a, b);
  assert.strictEqual(d.subjectsAdded[0].name, 'Maya');
  assert.strictEqual(d.fieldChanges.find(c => c.fieldId === 'topwear').newValue, 'blue');
  assert.strictEqual(d.fieldChanges.find(c => c.fieldId === 'hp').delta, -10);
  assert.strictEqual(d.fieldChanges.find(c => c.fieldId === 'items').entry, 'sword');
});

test('renderDiffAsCommands canonical form', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const a = eng.snapshot();
  eng.setField(p.id, 'outfit', 'topwear', 'red silk dress');
  eng.applyDelta(p.id, 'stats', 'hp', -10);
  eng.addListEntry(p.id, 'inv', 'items', 'sword');
  const b = eng.snapshot();
  const cmds = eng.renderDiffAsCommands(eng.diffSnapshots(a, b)).split('\n').filter(Boolean);
  assert.ok(cmds.includes(`SET Lyra outfit.topwear = "red silk dress"`));
  assert.ok(cmds.includes(`DELTA Lyra stats.hp -10`));
  assert.ok(cmds.includes(`ADD Lyra inv.items "sword"`));
});

test('setStorageBackend swaps state', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  eng.setField(p.id, 'outfit', 'topwear', 'red');
  const fresh = new InMemoryBackend({
    subjects: { subjects: [{ id: 'X', name: 'X', role: 'protagonist', traits: {} }], protagonistId: 'X' },
    values: { X: { outfit: { topwear: { v: 'green', lastTouchedMsg: null } } } },
  });
  // Definitions must be re-applied (engine reloads defs from backend; backend has none)
  fresh.saveDefinitions(eng.listTrackers());
  eng.setStorageBackend(fresh);
  assert.strictEqual(eng.getField('X', 'outfit', 'topwear'), 'green');
  assert.strictEqual(eng.listSubjects()[0].name, 'X');
});

function mkLedgerEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'ledger', label: 'Ledger', fields: [
    { id: 'threads', label: 'Threads', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
      { id: 'status', label: 'Status', type: 'text', default: '' },
    ]},
  ]});
  eng.addSubject('Cersia', { role: 'protagonist' });
  return eng;
}

test('applyCommands: struct-list ADD/DELTA/SET round-trip', () => {
  const eng = mkLedgerEngine(); // helper per this file's conventions
  eng.applyCommands('ADD Cersia ledger.threads "Merchant debt" detail="lantern" amount=50 status=open');
  eng.applyCommands('DELTA Cersia ledger.threads "merchant debt" amount -10');
  eng.applyCommands('SET Cersia ledger.threads "Merchant debt" status=fulfilled');
  const rows = eng.values.getField(eng.protagonist().id, 'ledger', 'threads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 40);
  assert.equal(rows[0].status, 'fulfilled');
  assert.equal(rows[0].detail, 'lantern');
});

test('applyCommands: struct-list REMOVE drops the row', () => {
  const eng = mkLedgerEngine();
  eng.applyCommands('ADD Cersia ledger.threads "Q" status=open');
  eng.applyCommands('REMOVE Cersia ledger.threads "q"');
  assert.deepEqual(eng.values.getField(eng.protagonist().id, 'ledger', 'threads'), []);
});

// Migration regression tests: struct-list coercion must run BEFORE generic list/pair-list fallbacks

test('migration: pair-list → struct-list preserves name and maps descriptor to detail', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'allies', label: 'Allies', fields: [
    { id: 'contacts', label: 'Contacts', type: 'pair-list', default: [] },
  ]});
  const subj = eng.addSubject('Bob', { role: 'protagonist' });
  eng.setField(subj.id, 'allies', 'contacts', [{ name: 'Bob', descriptor: 'ally' }]);
  // Migrate: pair-list → struct-list
  eng.updateTracker('allies', { id: 'allies', label: 'Allies', fields: [
    { id: 'contacts', label: 'Contacts', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
      { id: 'status', label: 'Status', type: 'enum', default: 'active', options: ['active', 'inactive'] },
    ]},
  ]});
  const rows = eng.getField(subj.id, 'allies', 'contacts');
  assert.ok(Array.isArray(rows), 'should be an array');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Bob');
  assert.strictEqual(rows[0].detail, 'ally', 'descriptor should map to detail');
});

test('migration: list → struct-list wraps each string as a named row', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'roster', label: 'Roster', fields: [
    { id: 'members', label: 'Members', type: 'list', default: [] },
  ]});
  const subj = eng.addSubject('Alice', { role: 'protagonist' });
  eng.setField(subj.id, 'roster', 'members', ['Bob', 'Carol']);
  // Migrate: list → struct-list
  eng.updateTracker('roster', { id: 'roster', label: 'Roster', fields: [
    { id: 'members', label: 'Members', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
      { id: 'status', label: 'Status', type: 'enum', default: 'active', options: ['active', 'inactive'] },
    ]},
  ]});
  const rows = eng.getField(subj.id, 'roster', 'members');
  assert.ok(Array.isArray(rows), 'should be an array');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Bob');
  assert.strictEqual(rows[1].name, 'Carol');
});

test('migration: struct-list → pair-list maps name and detail to descriptor', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'crew', label: 'Crew', fields: [
    { id: 'members', label: 'Members', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
      { id: 'status', label: 'Status', type: 'enum', default: 'active', options: ['active', 'inactive'] },
    ]},
  ]});
  const subj = eng.addSubject('Alice', { role: 'protagonist' });
  eng.setField(subj.id, 'crew', 'members', [{ name: 'Bob', detail: 'ally', amount: 0, status: 'active' }]);
  // Migrate: struct-list → pair-list
  eng.updateTracker('crew', { id: 'crew', label: 'Crew', fields: [
    { id: 'members', label: 'Members', type: 'pair-list', default: [] },
  ]});
  const rows = eng.getField(subj.id, 'crew', 'members');
  assert.ok(Array.isArray(rows), 'should be an array');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Bob');
  assert.strictEqual(rows[0].descriptor, 'ally', 'detail should map to descriptor');
});

test('renderDiffAsCommands struct-list: emits ADD with key=value pairs, no [object Object]', () => {
  const eng = mkLedgerEngine();
  const a = eng.snapshot();
  eng.applyCommands('ADD Cersia ledger.threads "Merchant debt" detail="silk route" amount=50 status=open');
  const b = eng.snapshot();
  const diff = eng.diffSnapshots(a, b);
  const cmds = eng.renderDiffAsCommands(diff);
  // Must contain an ADD line for the new row with key=value pairs
  assert.match(cmds, /ADD Cersia ledger\.threads "Merchant debt"/);
  assert.match(cmds, /amount=50/);
  // Must NOT contain [object Object]
  assert.doesNotMatch(cmds, /\[object Object\]/);
  // The rendered command must be re-parseable by parseCommands and yield a struct-list ADD
  const parsed = parseCommands(cmds);
  const addCmd = parsed.find(c => c.op === 'ADD' && c.entry === 'Merchant debt');
  assert.ok(addCmd, 'parseCommands should produce an ADD for the struct-list row');
  assert.ok(addCmd.fields, 'ADD command should carry fields object');
  assert.strictEqual(addCmd.fields.amount, '50');
});

test('migration: struct-list → list extracts names as strings', () => {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'party', label: 'Party', fields: [
    { id: 'members', label: 'Members', type: 'struct-list', default: [], fields: [
      { id: 'detail', label: 'Detail', type: 'text', default: '' },
      { id: 'amount', label: 'Amount', type: 'number', default: 0, min: 0 },
      { id: 'status', label: 'Status', type: 'enum', default: 'active', options: ['active', 'inactive'] },
    ]},
  ]});
  const subj = eng.addSubject('Alice', { role: 'protagonist' });
  eng.setField(subj.id, 'party', 'members', [{ name: 'Bob' }, { name: 'Carol' }]);
  // Migrate: struct-list → list
  eng.updateTracker('party', { id: 'party', label: 'Party', fields: [
    { id: 'members', label: 'Members', type: 'list', default: [] },
  ]});
  const result = eng.getField(subj.id, 'party', 'members');
  assert.deepStrictEqual(result, ['Bob', 'Carol']);
});
