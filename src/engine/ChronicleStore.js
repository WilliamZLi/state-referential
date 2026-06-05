// src/engine/ChronicleStore.js
import { newId } from '../util/id.js';

const DEFAULT_CONFIG = {
  verbatimWindow: 5,
  updateStrategy: 'lazy',
  bigPictureTokenCap: 300,
  entryTokenCap: 200,
  maxActMessages: 60,
  injectBigPicture: true,
  injectPosition: 'in-prompt',
};

export class ChronicleStore {
  constructor(initial = {}) {
    this._bigPicture = initial.bigPicture ?? '';
    this._bigPictureCoversThrough = initial.bigPictureCoversThrough ?? null;
    this._entries = Array.isArray(initial.entries) ? [...initial.entries] : [];
    this._config = { ...DEFAULT_CONFIG, ...(initial.config ?? {}) };
  }

  getConfig() { return { ...this._config }; }
  setConfig(patch) { Object.assign(this._config, patch); }

  getBigPicture() { return this._bigPicture; }
  getBigPictureCoversThrough() { return this._bigPictureCoversThrough; }
  setBigPicture(text, coversThrough) {
    this._bigPicture = text;
    this._bigPictureCoversThrough = coversThrough ?? null;
  }

  getEntries() { return [...this._entries]; }

  listVerbatimEntries() {
    const n = this._config.verbatimWindow ?? 5;
    return this._entries.slice(-n);
  }

  appendEntry(title, body, msgId = null) {
    const entry = {
      id: newId(),
      createdAt: Date.now(),
      title,
      body,
      createdByMessageId: msgId,
      inject: false,
    };
    this._entries.push(entry);
    return entry;
  }

  needsBigPictureUpdate() {
    if (this._config.updateStrategy === 'manual') return false;
    return this._entries.length > (this._config.verbatimWindow ?? 5);
  }

  getEntriesForFolding() {
    const n = this._config.verbatimWindow ?? 5;
    if (this._entries.length <= n) return [];
    return this._entries.slice(0, this._entries.length - n);
  }

  foldEntries(throughId) {
    const idx = this._entries.findIndex(e => e.id === throughId);
    if (idx >= 0) this._entries = this._entries.slice(idx + 1);
  }

  updateEntry(id, patch) {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx < 0) return;
    this._entries[idx] = { ...this._entries[idx], ...patch };
  }

  deleteEntry(id) {
    this._entries = this._entries.filter(e => e.id !== id);
  }

  serialize() {
    return {
      bigPicture: this._bigPicture,
      bigPictureCoversThrough: this._bigPictureCoversThrough,
      entries: this._entries.map(e => ({ ...e })),
      config: { ...this._config },
    };
  }

  static hydrate(data) {
    return new ChronicleStore(data ?? {});
  }
}
