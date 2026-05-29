// src/pipeline/WorldLock.js
// Cooperative soft lock for world files (spec §11).
// Best-effort: prevents accidental concurrent edits from two tabs; not cryptographically enforced.

const SESSION_ID = Math.random().toString(36).slice(2);
const LOCK_REFRESH_MS = 10_000;
const LOCK_STALE_MS = 25_000;

export class WorldLock {
  constructor(serverApi) {
    this.serverApi = serverApi;
    this._worldId = null;
    this._interval = null;
  }

  async acquire(worldId) {
    const meta = await this.serverApi.getWorld(worldId);
    if (!meta) return;

    const lock = meta.lockedBy;
    const now = Date.now();
    if (lock && lock.sessionId !== SESSION_ID && now - lock.lastSeen < LOCK_STALE_MS) {
      // Another live session holds the lock.
      const take = typeof confirm !== 'undefined'
        ? confirm(`Another session has this World open (last seen ${Math.round((now - lock.lastSeen) / 1000)}s ago). Take over?`)
        : true;
      if (!take) throw new Error('world locked by another session');
    }

    await this.serverApi.patchMeta(worldId, { lockedBy: { sessionId: SESSION_ID, lastSeen: now } });
    this._worldId = worldId;
    this._interval = setInterval(async () => {
      if (!this._worldId) return;
      try { await this.serverApi.patchMeta(this._worldId, { lockedBy: { sessionId: SESSION_ID, lastSeen: Date.now() } }); }
      catch { /* ignore refresh errors */ }
    }, LOCK_REFRESH_MS);
  }

  async release() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this._worldId) {
      try { await this.serverApi.patchMeta(this._worldId, { lockedBy: null }); }
      catch { /* ignore */ }
      this._worldId = null;
    }
  }
}
