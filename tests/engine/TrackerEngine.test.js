// state-referential/tests/engine/TrackerEngine.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

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
