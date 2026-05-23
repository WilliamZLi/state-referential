export const BACKEND_KEYS = ['definitions', 'subjects', 'values', 'descriptions', 'sceneTags', 'snapshots'];

/**
 * In-memory storage backend for testing and temporary storage.
 * Implements six load/save pairs: definitions, subjects, values, descriptions, sceneTags, snapshots.
 */
export class InMemoryBackend {
  constructor(seed = {}) {
    this._d = seed.definitions  ?? [];
    this._sj = seed.subjects    ?? { subjects: [], protagonistId: null };
    this._v = seed.values       ?? {};
    this._desc = seed.descriptions ?? { global: {}, perSubject: {} };
    this._tags = seed.sceneTags ?? [];
    this._snap = seed.snapshots ?? {};
  }

  loadDefinitions() { return this._d; }
  saveDefinitions(d) { this._d = d; }

  loadSubjects() { return this._sj; }
  saveSubjects(s) { this._sj = s; }

  loadValues() { return this._v; }
  saveValues(v) { this._v = v; }

  loadDescriptions() { return this._desc; }
  saveDescriptions(d) { this._desc = d; }

  loadSceneTags() { return this._tags; }
  saveSceneTags(t) { this._tags = t; }

  loadSnapshots() { return this._snap; }
  saveSnapshots(s) { this._snap = s; }

  async flush() {}
}