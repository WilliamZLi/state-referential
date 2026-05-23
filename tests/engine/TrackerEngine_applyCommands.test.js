import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', fields: [
    { id: 'topwear', label: 'Topwear', type: 'text' }
  ]});
  eng.defineTracker({ id: 'stats', label: 'Stats', fields: [
    { id: 'hp', label: 'HP', type: 'number', min: 0, max: 100, default: 100, allowDelta: true }
  ]});
  eng.defineTracker({ id: 'inv', label: 'Inv', fields: [
    { id: 'items', label: 'Items', type: 'list' }
  ]});
  return eng;
}

test('applyCommands applies SET/DELTA/ADD/NEW_SUBJECT', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Lyra', { role: 'protagonist' });
  const result = eng.applyCommands(`
SET Lyra outfit.topwear = "red dress"
DELTA Lyra stats.hp -10
ADD Lyra inv.items "sword"
NEW_SUBJECT "Maya" npc
SET Maya outfit.topwear = "blue tunic"
`, { source: 'auto-update' });
  assert.strictEqual(result.applied, 5);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'red dress');
  assert.strictEqual(eng.getField(p.id, 'stats', 'hp'), 90);
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['sword']);
  const maya = eng.subjects.findByName('Maya');
  assert.strictEqual(eng.getField(maya.id, 'outfit', 'topwear'), 'blue tunic');
});

test('unknown subject is skipped with error', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const r = eng.applyCommands(`SET Ghost outfit.topwear = "haze"`);
  assert.strictEqual(r.applied, 0);
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0], /Ghost/);
});

test('protagonist alias resolves', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Hero', { role: 'protagonist' });
  eng.applyCommands(`SET protagonist outfit.topwear = "cape"`);
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'cape');
});

test('emits tracker:auto-update-completed', () => {
  const eng = mkEngine();
  eng.addSubject('Lyra', { role: 'protagonist' });
  const events = [];
  eng.on('tracker:auto-update-completed', e => events.push(e));
  eng.applyCommands(`SET Lyra outfit.topwear = "red"`, { source: 'auto-update' });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].commandsApplied, 1);
});
