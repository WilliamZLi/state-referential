// tests/server/server-fs.test.js
// Crash-safe / concurrency-safe JSON file helpers for the world store.
// These guard the 2026-06-19 incident where world.json was clobbered down to
// just {lockedBy} by a non-atomic write + unlocked read-modify-write +
// parse-error-swallowing read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureDir, readJson, readJsonLenient, writeJson, putJson, mergeJson, withFileLock,
} from '../../server-fs.js';

async function tmpdir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'srfs-'));
}

test('writeJson + readJson round-trips', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'w.json');
  await writeJson(p, { a: 1, b: 'x' });
  assert.deepEqual(await readJson(p), { a: 1, b: 'x' });
});

test('readJson: absent file returns the fallback', async () => {
  const d = await tmpdir();
  assert.equal(await readJson(path.join(d, 'nope.json'), null), null);
  assert.deepEqual(await readJson(path.join(d, 'nope.json'), {}), {});
});

test('readJson: present-but-corrupt THROWS, never returns fallback (the data-loss guard)', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'bad.json');
  await fs.writeFile(p, '{ "a": 1, trunca', 'utf8'); // truncated / garbage
  await assert.rejects(() => readJson(p, {}), (e) => e.corrupt === true && e.status === 500);
});

test('readJsonLenient: corrupt file degrades to fallback (scan-many contexts)', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'bad.json');
  await fs.writeFile(p, 'not json at all', 'utf8');
  assert.equal(await readJsonLenient(p, null), null);
  // but absent still yields fallback too
  assert.deepEqual(await readJsonLenient(path.join(d, 'absent.json'), {}), {});
});

test('writeJson is atomic: leaves no temp file behind on success', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'w.json');
  await writeJson(p, { ok: true });
  assert.deepEqual(await fs.readdir(d), ['w.json']);
});

test('mergeJson preserves existing keys and adds the patch', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'world.json');
  await writeJson(p, { id: 'w1', name: 'X', subjects: { s: 1 } });
  await mergeJson(p, { lockedBy: { sessionId: 'a', lastSeen: 1 } });
  const r = await readJson(p);
  assert.equal(r.id, 'w1');
  assert.equal(r.name, 'X');
  assert.deepEqual(r.subjects, { s: 1 });
  assert.deepEqual(r.lockedBy, { sessionId: 'a', lastSeen: 1 });
});

test('mergeJson on an absent file THROWS 404 by default (no resurrection)', async () => {
  // Guards the delete/heartbeat race: a heartbeat patch must not recreate a
  // just-deleted world dir as a {lockedBy}-only ghost.
  const d = await tmpdir();
  const p = path.join(d, 'gone', 'world.json');
  await assert.rejects(() => mergeJson(p, { lockedBy: { x: 1 } }), (e) => e.absent === true && e.status === 404);
  // the parent dir was NOT recreated
  await assert.rejects(() => fs.stat(path.join(d, 'gone')), (e) => e.code === 'ENOENT');
});

test('mergeJson with createIfAbsent:true writes just the patch', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'world.json');
  await mergeJson(p, { id: 'fresh' }, { createIfAbsent: true });
  assert.deepEqual(await readJson(p), { id: 'fresh' });
});

test('mergeJson REFUSES to overwrite a corrupt file (no strip-to-patch)', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'world.json');
  await fs.writeFile(p, '{ corrupt', 'utf8');
  await assert.rejects(() => mergeJson(p, { lockedBy: { x: 1 } }), (e) => e.corrupt === true);
  // the corrupt bytes are left intact — NOT reduced to {"lockedBy":...}
  assert.equal(await fs.readFile(p, 'utf8'), '{ corrupt');
});

test('INCIDENT REGRESSION: concurrent {lockedBy} + {subjects} merges never strip world.json', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'world.json');
  await writeJson(p, {
    id: 'w1', name: 'CersiaWorld',
    subjects: { subjects: [], protagonistId: null }, sceneTags: ['fashion'],
  });
  const ops = [];
  for (let i = 0; i < 60; i++) {
    ops.push(mergeJson(p, { lockedBy: { sessionId: 's', lastSeen: i } }));
    ops.push(mergeJson(p, { subjects: { subjects: [{ id: String(i) }], protagonistId: String(i) } }));
  }
  await Promise.all(ops);
  const r = await readJson(p); // must still be valid JSON
  assert.equal(r.id, 'w1');            // identity survives the storm
  assert.equal(r.name, 'CersiaWorld'); // never stripped to just a patch
  assert.ok(r.subjects, 'subjects present');
  assert.deepEqual(r.sceneTags, ['fashion']);
  assert.ok(r.lockedBy, 'lockedBy present');
});

test('withFileLock serializes tasks for the same key (never two at once)', async () => {
  let active = 0, maxActive = 0;
  const mk = () => withFileLock('k', async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  await Promise.all([mk(), mk(), mk(), mk()]);
  assert.equal(maxActive, 1);
});

test('withFileLock: a failing task does not wedge the queue', async () => {
  await assert.rejects(() => withFileLock('k2', async () => { throw new Error('boom'); }));
  const r = await withFileLock('k2', async () => 42);
  assert.equal(r, 42);
});

test('putJson does a full atomic replace (not a merge)', async () => {
  const d = await tmpdir();
  const p = path.join(d, 'values.json');
  await putJson(p, { a: 1, b: 2 });
  await putJson(p, { c: 3 });
  assert.deepEqual(await readJson(p), { c: 3 });
});

test('ensureDir creates nested directories', async () => {
  const d = await tmpdir();
  const nested = path.join(d, 'x', 'y', 'z');
  await ensureDir(nested);
  const st = await fs.stat(nested);
  assert.ok(st.isDirectory());
});
