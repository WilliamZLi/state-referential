// state-referential/server-fs.js
// Crash-safe, concurrency-safe JSON file helpers for the world store.
//
// Dependency-free (fs + path only) so it can be unit-tested without express —
// server-plugin.js imports express, which is not installed for `node --test`.
//
// Why this module exists (2026-06-19 incident): world.json is rewritten by two
// independent timers — the WorldLock heartbeat (patchMeta {lockedBy}) and the
// tracker backend (patchMeta {subjects,sceneTags}). The original helpers did a
// non-atomic fs.writeFile (truncate-then-write), a read-modify-write with no
// locking, and swallowed JSON parse errors by returning a {} fallback. An
// ill-timed overlap let a heartbeat read a half-written file as {}, then
// persist {...{}, lockedBy} — destroying the world metadata. These helpers make
// writes atomic (temp + rename), serialize writers of the same path, and refuse
// to treat a present-but-unparseable file as empty.
import { promises as fs } from 'fs';
import path from 'path';

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

// Read + parse JSON.
//   absent file (ENOENT)    → return `fallback`
//   present but unparseable → THROW (err.corrupt = true, err.status = 500).
// Never returns `fallback` for a corrupt file: doing so is what let a later
// merge-write persist the emptiness and lose the world metadata.
export async function readJson(p, fallback = null) {
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error(`corrupt JSON at ${p}: ${e.message}`), { status: 500, corrupt: true });
  }
}

// Lenient read for scan-many contexts (listing / export): a single corrupt file
// must not blow up the whole operation, so corruption degrades to `fallback`
// (logged). Non-corruption errors still propagate.
export async function readJsonLenient(p, fallback = null) {
  try {
    return await readJson(p, fallback);
  } catch (e) {
    if (e && e.corrupt) {
      console.warn(`[state-referential] skipping ${e.message}`);
      return fallback;
    }
    throw e;
  }
}

let _tmpSeq = 0;

// Atomic write: serialize to a unique temp file in the same directory, then
// rename over the target. rename(2) is atomic on a single filesystem, so a
// concurrent reader sees either the old or the new complete file — never a
// truncated one. On failure the temp file is cleaned up best-effort.
export async function writeJson(p, data) {
  await ensureDir(path.dirname(p));
  const body = JSON.stringify(data, null, 2);
  const tmp = `${p}.tmp-${process.pid}-${_tmpSeq++}`;
  try {
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, p);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* best-effort cleanup */ }
    throw e;
  }
}

// ── per-path write serialization ──────────────────────────────────────────────
// NOTE: in-process only. SillyTavern's server plugin runs single-process, so
// this fully serializes world-file writers. Under a clustered/multi-worker
// deployment the atomic rename still prevents *corruption*, but a cross-process
// read-modify-write could drop a field (lost update) — out of scope here.
const _chains = new Map();

// Run `task` only after any prior task queued for `key` has settled, so
// read-modify-write sequences against the same file cannot interleave. Returns
// the task's own promise (result/error). The internal chain tail never rejects,
// so one failing task does not wedge the queue for that key.
export function withFileLock(key, task) {
  const prev = _chains.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.then(() => {}, () => {});
  _chains.set(key, tail);
  tail.then(() => { if (_chains.get(key) === tail) _chains.delete(key); });
  return run;
}

// Full-replace write, atomic + serialized against other writers of `p`.
export function putJson(p, data) {
  return withFileLock(p, () => writeJson(p, data));
}

const MISSING = Symbol('missing');

// Read-modify-write: shallow-merge `patch` into the JSON at `p`, atomic +
// serialized against other writers of `p`.
//   present-but-corrupt → throws (does NOT overwrite with just the patch — the
//                         original data-loss bug)
//   absent + createIfAbsent:false (default) → throws (status 404, .absent). A
//                         heartbeat/patch must not RESURRECT a file (and recreate
//                         a just-deleted world dir) as a patch-only ghost.
//   absent + createIfAbsent:true → the patch becomes the whole object.
export function mergeJson(p, patch, { createIfAbsent = false } = {}) {
  return withFileLock(p, async () => {
    const existing = await readJson(p, MISSING); // absent → MISSING; corrupt → throws
    if (existing === MISSING && !createIfAbsent) {
      throw Object.assign(new Error(`file not found: ${p}`), { status: 404, absent: true });
    }
    const base = existing === MISSING ? {} : existing;
    const next = { ...base, ...patch };
    await writeJson(p, next);
    return next;
  });
}
