import { test } from 'node:test';
import assert from 'node:assert';
import { TrackerEngine } from '../../src/engine/TrackerEngine.js';
import { InMemoryBackend } from '../../src/engine/StorageBackend.js';

function mkEngine() {
  const eng = new TrackerEngine(new InMemoryBackend());
  eng.defineTracker({ id: 'inv', label: 'Inventory', appliesToRoles: ['protagonist'], fields: [
    { id: 'items', label: 'Items', type: 'list', default: [], describable: true, descriptionScope: 'global' },
  ]});
  eng.defineTracker({ id: 'state', label: 'State', appliesToRoles: ['protagonist'], fields: [
    { id: 'effects', label: 'Effects', type: 'list', default: [], describable: true, descriptionScope: 'per-subject', inclusion: { rule: 'active', activeWindow: 5 } },
  ]});
  eng.defineTracker({ id: 'outfit', label: 'Outfit', appliesToRoles: ['protagonist'], fields: [
    { id: 'topwear', label: 'Topwear', type: 'text' },
  ]});
  return eng;
}

test('renameListEntry renames in place and carries the description (drops the old)', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['torch', 'magic staff', 'rope']);
  eng.setDescription(p.id, 'inv', 'items', 'magic staff', 'a carved oak staff');
  eng.renameListEntry(p.id, 'inv', 'items', 'magic staff', 'gnarled staff', { source: 'manual' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['torch', 'gnarled staff', 'rope']);
  assert.strictEqual(eng.getDescription(p.id, 'inv', 'items', 'gnarled staff'), 'a carved oak staff');
  assert.strictEqual(eng.getDescription(p.id, 'inv', 'items', 'magic staff'), null);
});

test('renameListEntry preserves the countdown itemMeta under the new name', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.addListEntry(p.id, 'state', 'effects', 'Dazed', { msgId: 'm1', expiresAtSnapCount: 7 });
  eng.renameListEntry(p.id, 'state', 'effects', 'Dazed', 'Stunned', { source: 'manual' });
  const meta = eng.getListMeta(p.id, 'state', 'effects');
  assert.ok(meta['Stunned'], 'new name has itemMeta');
  assert.strictEqual(meta['Stunned'].expiresAtSnapCount, 7, 'countdown anchor preserved');
  assert.ok(!meta['Dazed'], 'old meta dropped');
  assert.deepStrictEqual(eng.getField(p.id, 'state', 'effects'), ['Stunned']);
});

test('renameListEntry is a no-op for a missing old entry or an unchanged name', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  eng.setField(p.id, 'inv', 'items', ['torch']);
  eng.renameListEntry(p.id, 'inv', 'items', 'ghost', 'new', { source: 'manual' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['torch']);
  eng.renameListEntry(p.id, 'inv', 'items', 'torch', 'torch', { source: 'manual' });
  assert.deepStrictEqual(eng.getField(p.id, 'inv', 'items'), ['torch']);
});

test('renameListEntry throws for a non-list field', () => {
  const eng = mkEngine();
  const p = eng.addSubject('Cersia', { role: 'protagonist' });
  assert.throws(() => eng.renameListEntry(p.id, 'outfit', 'topwear', 'a', 'b', {}));
});
