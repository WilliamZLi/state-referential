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
  let _csrfToken = null;

  async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    const res = await fetch('/csrf-token');
    if (!res.ok) return null;
    const data = await res.json();
    _csrfToken = data.token ?? null;
    return _csrfToken;
  }

  async function apiFetch(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
    const method = opts.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 403) {
      // CSRF token may have expired — clear cache and retry once
      _csrfToken = null;
      const token = await getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
      const retry = await fetch(url, { ...opts, headers });
      if (!retry.ok) throw new Error(`[state-referential] server ${retry.status}: ${retry.statusText} (${url})`);
      if (retry.status === 204) return null;
      return retry.json().catch(() => null);
    }
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
    exportWorld:   (id)         => getCsrfToken().then(t => fetch(`${base}/worlds/${id}/export`, { headers: t ? { 'X-CSRF-Token': t } : {} })).then(r => r.blob()),
    importWorld:   (bundle)     => getCsrfToken().then(t => fetch(`${base}/worlds/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { 'X-CSRF-Token': t } : {}) }, body: JSON.stringify(bundle) })).then(r => r.json()),
  };
}
