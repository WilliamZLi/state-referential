// src/pipeline/WorldBinding.js
import { WorldScopedBackend } from '../engine/WorldScopedBackend.js';

export class WorldBinding {
  constructor(chatScopedBackend, serverApi, ctx) {
    this.chatScopedBackend = chatScopedBackend;
    this.serverApi = serverApi;
    this.ctx = ctx;
    this._currentWorldId = null;
    this._currentBackend = chatScopedBackend;
  }

  get currentWorldId() { return this._currentWorldId; }
  get currentBackend() { return this._currentBackend; }

  /**
   * Read chatMeta and return the correct StorageBackend.
   * chatMeta = chat.extra (or chatMetadata) of the newly-loaded chat.
   */
  async selectBackend(chatMeta) {
    const worldId = chatMeta?.trackerWorldId;
    const role = chatMeta?.trackerChatRole ?? 'unbound';

    if (!worldId || role === 'unbound') {
      this._currentWorldId = null;
      this._currentBackend = this.chatScopedBackend;
      return this.chatScopedBackend;
    }

    if (role === 'mainline' || role === 'branch') {
      try {
        const worldBackend = await WorldScopedBackend.hydrate(worldId, this.serverApi, this.ctx);
        this._currentWorldId = worldId;
        this._currentBackend = worldBackend;
        return worldBackend;
      } catch (e) {
        console.error('[state-referential] failed to load world backend, falling back to chat-scoped:', e);
        this._currentWorldId = null;
        this._currentBackend = this.chatScopedBackend;
        return this.chatScopedBackend;
      }
    }

    this._currentWorldId = null;
    this._currentBackend = this.chatScopedBackend;
    return this.chatScopedBackend;
  }
}

/**
 * Production fetch-based serverApi.
 * BASE is the plugin route prefix under /api/plugins/state-referential-worlds.
 */
export function makeServerApi(base = '/api/plugins/state-referential-worlds') {
  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`[state-referential] server ${res.status}: ${res.statusText} (${url})`);
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }

  return {
    listWorlds:    ()           => apiFetch(`${base}/worlds`),
    createWorld:   (meta)       => apiFetch(`${base}/worlds`, { method: 'POST', body: JSON.stringify(meta) }),
    getWorld:      (id)         => apiFetch(`${base}/worlds/${id}`),
    patchMeta:     (id, patch)  => apiFetch(`${base}/worlds/${id}/meta`, { method: 'PUT', body: JSON.stringify(patch) }),
    deleteWorld:   (id)         => apiFetch(`${base}/worlds/${id}`, { method: 'DELETE' }),
    getResource:   (id, key)    => apiFetch(`${base}/worlds/${id}/${key}`),
    putResource:   (id, key, d) => apiFetch(`${base}/worlds/${id}/${key}`, { method: 'PUT', body: JSON.stringify(d) }),
    getChronicle:  (id)         => apiFetch(`${base}/worlds/${id}/chronicle`),
    putChronicle:  (id, d)      => apiFetch(`${base}/worlds/${id}/chronicle`, { method: 'PUT', body: JSON.stringify(d) }),
    exportWorld:   (id)         => fetch(`${base}/worlds/${id}/export`).then(r => r.blob()),
    importWorld:   (formData)   => fetch(`${base}/worlds/import`, { method: 'POST', body: formData }).then(r => r.json()),
  };
}
