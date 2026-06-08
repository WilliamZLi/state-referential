import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine, normalizeDescribableValue } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

test('strips a comma-separated parenthetical to the bare name', () => {
  assert.strictEqual(normalizeDescribableValue('Womb-Filler (inserted, through cervix, active, vibrating)'), 'Womb-Filler');
  assert.strictEqual(normalizeDescribableValue('vibrating nipple barbells (matched pair, weighted teardrop chains)'), 'vibrating nipple barbells');
});

test('keeps a single short state qualifier', () => {
  assert.strictEqual(normalizeDescribableValue('staff (broken)'), 'staff (broken)');
  assert.strictEqual(normalizeDescribableValue('robes (soaked)'), 'robes (soaked)');
  assert.strictEqual(normalizeDescribableValue('dress (torn at hem)'), 'dress (torn at hem)');
});

test('strips a long single-phrase parenthetical (>5 words)', () => {
  assert.strictEqual(normalizeDescribableValue('barbells (enchanted self-piercing through both swollen nipples)'), 'barbells');
});

test('leaves plain names, mid-string parens, and non-strings alone', () => {
  assert.strictEqual(normalizeDescribableValue('red dress'), 'red dress');
  assert.strictEqual(normalizeDescribableValue('Womb-Filler'), 'Womb-Filler');
  assert.strictEqual(normalizeDescribableValue('a (b) c'), 'a (b) c'); // paren not at the end
  assert.strictEqual(normalizeDescribableValue(42), 42);
});

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist'], fields: [
    { id: 'topwear', label: 'Topwear', type: 'text', describable: true, descriptionScope: 'per-subject' },
    { id: 'note', label: 'Note', type: 'text', describable: false },
  ]});
  eng.defineTracker({ id: 'inv', label: 'Inventory', appliesToRoles: ['protagonist'], fields: [
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'global' },
  ]});
  return eng;
}

test('applyCommands SET normalizes a describable value', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.applyCommands('SET Cersia outfit.topwear = "Womb-Filler (inserted, through cervix, active, vibrating)"');
  assert.strictEqual(eng.getField(p.id, 'outfit', 'topwear'), 'Womb-Filler');
});

test('applyCommands ADD normalizes a describable list entry', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.applyCommands('ADD Cersia inv.items "Womb-Filler (inserted, active, vibrating)"');
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['Womb-Filler']);
});

test('applyCommands leaves NON-describable values untouched', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.applyCommands('SET Cersia outfit.note = "stuff (a, b, c)"');
  assert.strictEqual(eng.getField(p.id, 'outfit', 'note'), 'stuff (a, b, c)');
});
