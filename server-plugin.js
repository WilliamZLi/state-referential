// state-referential/server-plugin.js
// ST server plugin: loaded by SillyTavern's plugin loader from the ST plugins/ directory.
// Exposes CRUD routes for world files under data/<user>/state-trackers/worlds/.
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export const router = express.Router();
export const name = 'state-referential-worlds';
export const version = '1.0.0';

// Resolve ST's data root — ST sets DATA_ROOT or defaults to process.cwd()/data.
const DATA_ROOT = path.resolve(process.env.DATA_ROOT ?? path.join(process.cwd(), 'data'));

function getUserDir(req) {
  // ST attaches session user via req.user (basic auth) or req.session?.user.
  const name = req.user?.name ?? req.session?.user?.name ?? 'default';
  return path.join(DATA_ROOT, name, 'state-trackers', 'worlds');
}

/** Resolve a path inside a user's worlds dir; throw on traversal. */
function safePath(base, ...parts) {
  const joined = path.join(...parts.map(p => path.normalize(String(p)).replace(/^(\.\.(\/|\\|$))+/, '')));
  const resolved = path.resolve(base, joined);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw Object.assign(new Error('path traversal'), { status: 400 });
  }
  return resolved;
}

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(p, data) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

function send(res, data) { res.json(data); }
function err(res, status, msg) { res.status(status).json({ error: msg }); }

// ── GET /worlds — list all worlds (metadata only) ──────────────────────────────
router.get('/worlds', async (req, res) => {
  try {
    const base = getUserDir(req);
    await ensureDir(base);
    const entries = await fs.readdir(base, { withFileTypes: true });
    const worlds = await Promise.all(
      entries.filter(e => e.isDirectory()).map(e => readJson(path.join(base, e.name, 'world.json'), null))
    );
    send(res, worlds.filter(Boolean));
  } catch (e) { err(res, 500, e.message); }
});

// ── POST /worlds — create world ────────────────────────────────────────────────
router.post('/worlds', express.json(), async (req, res) => {
  try {
    const meta = req.body;
    if (!meta?.id || typeof meta.id !== 'string') return err(res, 400, 'id required');
    const base = getUserDir(req);
    const worldDir = safePath(base, meta.id);
    await ensureDir(worldDir);
    await writeJson(path.join(worldDir, 'world.json'), meta);
    await writeJson(path.join(worldDir, 'values.json'), {});
    await writeJson(path.join(worldDir, 'descriptions.json'), { global: {}, perSubject: {} });
    await writeJson(path.join(worldDir, 'snapshots.json'), {});
    await writeJson(path.join(worldDir, 'chronicle.json'), { bigPicture: '', bigPictureCoversThrough: null, entries: [] });
    send(res, meta);
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── GET /worlds/:id — get world.json ──────────────────────────────────────────
router.get('/worlds/:id', async (req, res) => {
  try {
    const base = getUserDir(req);
    const p = safePath(base, req.params.id, 'world.json');
    const data = await readJson(p, null);
    if (!data) return err(res, 404, 'world not found');
    send(res, data);
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── PUT /worlds/:id/meta — patch world.json (subjects, sceneTags, lockedBy, etc.) ──
router.put('/worlds/:id/meta', express.json(), async (req, res) => {
  try {
    const base = getUserDir(req);
    const p = safePath(base, req.params.id, 'world.json');
    const existing = await readJson(p, {});
    await writeJson(p, { ...existing, ...req.body });
    send(res, { ok: true });
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── DELETE /worlds/:id — soft-delete (move to _deleted/) ──────────────────────
router.delete('/worlds/:id', async (req, res) => {
  try {
    const base = getUserDir(req);
    const worldDir = safePath(base, req.params.id);
    const deletedBase = path.join(path.dirname(base), '_deleted', String(Date.now()));
    await ensureDir(deletedBase);
    await fs.rename(worldDir, path.join(deletedBase, req.params.id));
    send(res, { ok: true });
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── GET /worlds/:id/:resource — values | descriptions | snapshots ──────────────
router.get('/worlds/:id/:resource', async (req, res) => {
  const allowed = new Set(['values', 'descriptions', 'snapshots', 'chronicle']);
  if (!allowed.has(req.params.resource)) return err(res, 400, 'unknown resource');
  try {
    const base = getUserDir(req);
    const p = safePath(base, req.params.id, `${req.params.resource}.json`);
    const data = await readJson(p, null);
    if (data === null) return err(res, 404, 'not found');
    send(res, data);
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── PUT /worlds/:id/:resource ─────────────────────────────────────────────────
router.put('/worlds/:id/:resource', express.json(), async (req, res) => {
  const allowed = new Set(['values', 'descriptions', 'snapshots', 'chronicle']);
  if (!allowed.has(req.params.resource)) return err(res, 400, 'unknown resource');
  try {
    const base = getUserDir(req);
    const p = safePath(base, req.params.id, `${req.params.resource}.json`);
    await writeJson(p, req.body);
    send(res, { ok: true });
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── POST /worlds/:id/export — return zip blob ─────────────────────────────────
router.post('/worlds/:id/export', async (req, res) => {
  try {
    const base = getUserDir(req);
    const worldDir = safePath(base, req.params.id);
    // Read all files and return as JSON bundle (zip requires jszip; use JSON for v1)
    const files = ['world.json', 'values.json', 'descriptions.json', 'snapshots.json', 'chronicle.json'];
    const bundle = {};
    for (const f of files) bundle[f] = await readJson(path.join(worldDir, f), null);
    res.setHeader('Content-Disposition', `attachment; filename="world-${req.params.id}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(bundle, null, 2));
  } catch (e) { err(res, e.status ?? 500, e.message); }
});

// ── POST /worlds/import — accept JSON bundle, create new world ────────────────
router.post('/worlds/import', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const bundle = req.body;
    if (!bundle?.['world.json']?.id) return err(res, 400, 'invalid bundle');
    const newId = crypto.randomUUID();
    const meta = { ...bundle['world.json'], id: newId, createdAt: Date.now() };
    const base = getUserDir(req);
    const worldDir = safePath(base, newId);
    await ensureDir(worldDir);
    await writeJson(path.join(worldDir, 'world.json'), meta);
    const CHRONICLE_EMPTY = { bigPicture: '', bigPictureCoversThrough: null, entries: [] };
    for (const key of ['values', 'descriptions', 'snapshots', 'chronicle']) {
      const fallback = key === 'chronicle' ? CHRONICLE_EMPTY : {};
      await writeJson(path.join(worldDir, `${key}.json`), bundle[`${key}.json`] ?? fallback);
    }
    send(res, meta);
  } catch (e) { err(res, e.status ?? 500, e.message); }
});
