// src/engine/WorldScopedBackend.js
import { debounce } from '../util/debounce.js';

const NS = 'state-referential';

export class WorldScopedBackend {
  constructor(worldId, serverApi, initialData, ctx) {
    this.worldId = worldId;
    this.serverApi = serverApi;
    this.ctx = ctx;

    this._subjects = initialData.subjects ?? { subjects: [], protagonistId: null };
    this._values = initialData.values ?? {};
    this._descriptions = initialData.descriptions ?? { global: {}, perSubject: {} };
    this._sceneTags = initialData.sceneTags ?? [];
    this._snapshots = initialData.snapshots ?? {};

    this._flushMeta = debounce(
      () => this.serverApi.patchMeta(this.worldId, { subjects: this._subjects, sceneTags: this._sceneTags }),
      200
    );
    this._flushValues = debounce(
      () => this.serverApi.putResource(this.worldId, 'values', this._values),
      200
    );
    this._flushDescriptions = debounce(
      () => this.serverApi.putResource(this.worldId, 'descriptions', this._descriptions),
      200
    );
    this._flushSnapshots = debounce(
      () => this.serverApi.putResource(this.worldId, 'snapshots', this._snapshots),
      200
    );
  }

  // Definitions are global per-install, not per-world — delegate to extension_settings.
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
    this.ctx.saveSettingsDebounced?.();
  }

  loadSubjects()      { return this._subjects; }
  saveSubjects(s)     { this._subjects = s; this._flushMeta(); }
  loadValues()        { return this._values; }
  saveValues(v)       { this._values = v; this._flushValues(); }
  loadDescriptions()  { return this._descriptions; }
  saveDescriptions(d) { this._descriptions = d; this._flushDescriptions(); }
  loadSceneTags()     { return this._sceneTags; }
  saveSceneTags(t)    { this._sceneTags = t; this._flushMeta(); }
  loadSnapshots()     { return this._snapshots; }
  saveSnapshots(s)    { this._snapshots = s; this._flushSnapshots(); }

  async flush() {
    this._flushMeta.flush?.();
    this._flushValues.flush?.();
    this._flushDescriptions.flush?.();
    this._flushSnapshots.flush?.();
    // Wait one microtask cycle for the synchronous flush calls above to complete.
    await Promise.resolve();
  }

  // World backend is authoritative in memory — nothing to invalidate on CHAT_CHANGED.
  invalidate() {}

  static async hydrate(worldId, serverApi, ctx) {
    const [worldMeta, values, descriptions, snapshots] = await Promise.all([
      serverApi.getWorld(worldId),
      serverApi.getResource(worldId, 'values'),
      serverApi.getResource(worldId, 'descriptions'),
      serverApi.getResource(worldId, 'snapshots'),
    ]);
    return new WorldScopedBackend(worldId, serverApi, {
      subjects:     worldMeta?.subjects      ?? { subjects: [], protagonistId: null },
      sceneTags:    worldMeta?.sceneTags     ?? [],
      values:       values                   ?? {},
      descriptions: descriptions             ?? { global: {}, perSubject: {} },
      snapshots:    snapshots                ?? {},
    }, ctx);
  }
}
