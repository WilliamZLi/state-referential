// src/engine/WorldRegistry.js
import { newId } from '../util/id.js';

const DEFAULT_CHRONICLE_CONFIG = {
  verbatimWindow: 5,
  updateStrategy: 'lazy',
  bigPictureTokenCap: 300,
  entryTokenCap: 200,
  maxActMessages: 60,
};

export class WorldRegistry {
  constructor(serverApi) {
    this.serverApi = serverApi;
    this._worlds = new Map();
  }

  async init() {
    const list = await this.serverApi.listWorlds();
    this._worlds.clear();
    for (const w of list) this._worlds.set(w.id, w);
  }

  list() { return [...this._worlds.values()]; }

  get(id) { return this._worlds.get(id) ?? null; }

  getByMainlineChatId(chatId) {
    for (const w of this._worlds.values()) {
      if (w.mainlineChatId === chatId) return w;
    }
    return null;
  }

  async create(opts = {}) {
    const meta = {
      id: newId(),
      name: opts.name ?? 'New World',
      createdAt: Date.now(),
      narratorCardHint: opts.narratorCardHint ?? null,
      mainlineChatId: null,
      openBranchChatId: null,
      subjects: { subjects: [], protagonistId: null },
      sceneTags: [],
      chronicleConfig: { ...DEFAULT_CHRONICLE_CONFIG, ...(opts.chronicleConfig ?? {}) },
      lockedBy: null,
    };
    const created = await this.serverApi.createWorld(meta);
    this._worlds.set(created.id, created);
    return created;
  }

  async update(id, patch) {
    const current = this._worlds.get(id);
    if (!current) throw new Error(`world not found: ${id}`);
    const next = { ...current, ...patch };
    this._worlds.set(id, next);
    await this.serverApi.patchMeta(id, patch);
    return next;
  }

  async delete(id) {
    if (!this._worlds.has(id)) return;
    this._worlds.delete(id);
    await this.serverApi.deleteWorld(id);
  }

  async setMainlineChatId(worldId, chatId) {
    return this.update(worldId, { mainlineChatId: chatId });
  }
}
