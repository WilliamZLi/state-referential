import { debounce } from '../util/debounce.js';

const NS = 'state-referential';

export class ChatScopedBackend {
  /**
   * @param {object} ctx - { getChat(), getExtensionSettings(), saveChatConditional(), saveSettingsDebounced() }
   * @param {object} opts - { debounceMs }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this._cache = null;
    this._persistChat = debounce(() => this._writeChat(), opts.debounceMs ?? 200);
    this._persistSettings = () => this.ctx.saveSettingsDebounced?.();
  }

  _readContainer() {
    if (this._cache) return this._cache;
    const emptyContainer = () => ({
      subjects: { subjects: [], protagonistId: null },
      values: {},
      descriptions: { global: {}, perSubject: {} },
      sceneTags: [],
      snapshots: {},
    });

    // Prefer live chatMetadata via getter (works even when chat[] is empty).
    // Fall back to legacy captured `chatMetadata` (used by tests); then first
    // message's `extra`; finally an ephemeral container.
    let meta = this.ctx.getChatMetadata?.() ?? this.ctx.chatMetadata;
    if (!meta) {
      const chat = this.ctx.getChat?.() ?? [];
      if (chat.length && chat[0]) {
        meta = (chat[0].extra ??= {});
      } else {
        // No persistence target — ephemeral container until chat exists.
        this._cache = emptyContainer();
        return this._cache;
      }
    }
    if (!meta.trackers) meta.trackers = emptyContainer();
    this._cache = meta.trackers;
    return this._cache;
  }

  _writeChat() {
    // Cache mutated in place; only need to trigger save.
    this.ctx.saveChatConditional?.();
  }

  // Definitions live in extension_settings, not chat.
  loadDefinitions() {
    const es = this.ctx.getExtensionSettings?.() ?? {};
    es[NS] ??= {};
    es[NS].definitions ??= [];
    return es[NS].definitions;
  }
  saveDefinitions(d) {
    const es = this.ctx.getExtensionSettings();
    es[NS] ??= {};
    es[NS].definitions = d;
    this._persistSettings();
  }

  loadSubjects()     { return this._readContainer().subjects; }
  saveSubjects(s)    { this._readContainer().subjects = s; this._persistChat(); }
  loadValues()       { return this._readContainer().values; }
  saveValues(v)      { this._readContainer().values = v; this._persistChat(); }
  loadDescriptions() { return this._readContainer().descriptions; }
  saveDescriptions(d){ this._readContainer().descriptions = d; this._persistChat(); }
  loadSceneTags()    { return this._readContainer().sceneTags; }
  saveSceneTags(t)   { this._readContainer().sceneTags = t; this._persistChat(); }
  loadSnapshots()    { return this._readContainer().snapshots; }
  saveSnapshots(s)   { this._readContainer().snapshots = s; this._persistChat(); }

  async flush() { this._persistChat.flush?.(); }

  /** Called by Versioning on CHAT_CHANGED — drop cache so next load re-reads. */
  invalidate() { this._cache = null; this._persistChat.cancel?.(); }
}