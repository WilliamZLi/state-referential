export class ValueStore {
  constructor(backend, bus, definitions) {
    this.backend = backend;
    this.bus = bus;
    this.defs = definitions;
    this._values = backend.loadValues() ?? {};
    this._desc = backend.loadDescriptions() ?? { global: {}, perSubject: {} };
  }
  _persist() {
    this.backend.saveValues(this._values);
    this.backend.saveDescriptions(this._desc);
  }
  _field(trackerId, fieldId) {
    const f = this.defs.getField(trackerId, fieldId);
    if (!f) throw new Error(`field not found: ${trackerId}.${fieldId}`);
    return { ...f, _trackerId: trackerId };
  }
  _validate(field, value, s, t) {
    if (field.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`number expected: ${field.id}`);
      if (field.min != null && value < field.min) return field.min;
      if (field.max != null && value > field.max) return field.max;
      if (field.maxFromField && s != null && t != null) {
        const cap = this.getField(s, t, field.maxFromField) ?? this.defs.getField(t, field.maxFromField)?.default;
        if (cap != null && value > cap) return cap;
      }
      return value;
    }
    if (field.type === 'enum') {
      if (!field.options.includes(value)) throw new Error(`enum value not in options: ${value}`);
      return value;
    }
    if (field.type === 'list') {
      if (!Array.isArray(value)) throw new Error(`list expected: ${field.id}`);
      return [...value];
    }
    if (field.type === 'pair-list') {
      if (!Array.isArray(value)) throw new Error(`pair-list expected: ${field.id}`);
      // Normalize entries: keep only well-formed {name, descriptor} pairs;
      // strings get coerced to {name: str, descriptor: ''} for forgiving AI output.
      const seen = new Set();
      const out = [];
      for (const e of value) {
        let name; let descriptor;
        if (typeof e === 'string') { name = e.trim(); descriptor = ''; }
        else if (e && typeof e === 'object') {
          name = String(e.name ?? '').trim();
          descriptor = String(e.descriptor ?? '').trim();
        } else continue;
        if (!name) continue;
        if (seen.has(name)) continue; // dedup by name (last write wins via upsert path)
        seen.add(name);
        out.push({ name, descriptor });
      }
      return out;
    }
    return String(value);
  }
  _descKey(field) {
    return `${field._trackerId}.${field.id}` + (field.type === 'list' || field.type === 'pair-list' ? '[]' : '');
  }
  getStored(s, t, f) { return this._values[s]?.[t]?.[f]; }
  getField(s, t, f) { return this.getStored(s, t, f)?.v; }
  setField(s, t, f, value, opts = {}) {
    const field = this._field(t, f);
    const v = this._validate(field, value, s, t);
    const oldValue = this.getField(s, t, f);
    if (!this._values[s]) this._values[s] = {};
    if (!this._values[s][t]) this._values[s][t] = {};
    const prev = this._values[s][t][f];
    this._values[s][t][f] = { v, lastTouchedMsg: opts.msgId ?? null };
    // Carry forward and prune per-item timestamps for timed list fields
    if (field.type === 'list' && prev?.itemMeta) {
      const kept = new Set(Array.isArray(v) ? v : []);
      const meta = {};
      for (const [k, val] of Object.entries(prev.itemMeta)) {
        if (kept.has(k)) meta[k] = val;
      }
      if (Object.keys(meta).length > 0) this._values[s][t][f].itemMeta = meta;
    }
    if (field.type === 'prose') {
      const key = this._descKey(field);
      if (!this._desc.perSubject[s]) this._desc.perSubject[s] = {};
      if (!this._desc.perSubject[s][key]) this._desc.perSubject[s][key] = {};
      this._desc.perSubject[s][key].__prose__ = v;
    }
    this._persist();
    this.bus.emit('tracker:value-changed', { subject: s, tracker: t, field: f, oldValue, newValue: v, source: opts.source ?? 'manual' });
  }
  applyDelta(s, t, f, delta, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'number') throw new Error('applyDelta requires number');
    const cur = this.getField(s, t, f) ?? field.default ?? 0;
    this.setField(s, t, f, cur + delta, opts);
  }
  addListEntry(s, t, f, entry, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'list') throw new Error('addListEntry requires list');
    const cur = this.getField(s, t, f) ?? [];
    if (cur.includes(entry)) return;
    // Pre-stamp timing metadata BEFORE setField so the carry-forward logic picks it
    // up and the panel renders with the countdown already present (setField fires
    // tracker:value-changed synchronously, so post-stamp would arrive too late).
    if (field.inclusion?.activeWindow != null) {
      if (!this._values[s]) this._values[s] = {};
      if (!this._values[s][t]) this._values[s][t] = {};
      if (!this._values[s][t][f]) this._values[s][t][f] = { v: cur, lastTouchedMsg: null };
      const rec = this._values[s][t][f];
      if (!rec.itemMeta) rec.itemMeta = {};
      rec.itemMeta[entry] = {
        addedAtMsg: opts.msgId ?? null,
        addedAtSnapCount: opts.addedAtSnapCount ?? null,
        expiresAtSnapCount: opts.expiresAtSnapCount ?? null,
      };
    }
    this.setField(s, t, f, [...cur, entry], opts);
  }
  getListMeta(s, t, f) {
    return this._values[s]?.[t]?.[f]?.itemMeta ?? {};
  }
  removeListEntry(s, t, f, entry, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'list') throw new Error('removeListEntry requires list');
    const cur = this.getField(s, t, f) ?? [];
    this.setField(s, t, f, cur.filter(x => x !== entry), opts);
  }
  /**
   * Swap an existing list entry for a new one at the old entry's index (order is
   * preserved when newEntry isn't already in the list; if it is, the existing
   * occurrence is kept and the duplicate dropped). If oldEntry isn't present,
   * newEntry is appended. Timed list fields stamp newEntry as freshly touched
   * (resets its countdown). Used by REPLACE — fires a single tracker:value-changed.
   */
  replaceListEntry(s, t, f, oldEntry, newEntry, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'list') throw new Error('replaceListEntry requires list');
    const cur = this.getField(s, t, f) ?? [];
    const idx = cur.indexOf(oldEntry);
    let next = idx >= 0 ? cur.map((v, i) => (i === idx ? newEntry : v)) : [...cur, newEntry];
    next = next.filter((v, i) => next.indexOf(v) === i); // de-dup
    if (field.inclusion?.activeWindow != null) {
      if (!this._values[s]) this._values[s] = {};
      if (!this._values[s][t]) this._values[s][t] = {};
      if (!this._values[s][t][f]) this._values[s][t][f] = { v: cur, lastTouchedMsg: null };
      const rec = this._values[s][t][f];
      if (!rec.itemMeta) rec.itemMeta = {};
      rec.itemMeta[newEntry] = {
        addedAtMsg: opts.msgId ?? null,
        addedAtSnapCount: opts.addedAtSnapCount ?? null,
        expiresAtSnapCount: opts.expiresAtSnapCount ?? null,
      };
    }
    this.setField(s, t, f, next, opts);
  }
  /**
   * Upsert a pair-list entry by name. If the name exists, replace its descriptor
   * (preserving order); otherwise append. Empty/blank name is a no-op.
   */
  setPair(s, t, f, name, descriptor, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'pair-list') throw new Error('setPair requires pair-list');
    const clean = String(name ?? '').trim();
    if (!clean) return;
    const cur = this.getField(s, t, f) ?? [];
    const idx = cur.findIndex(p => p.name === clean);
    const desc = String(descriptor ?? '').trim();
    const next = idx === -1
      ? [...cur, { name: clean, descriptor: desc }]
      : cur.map((p, i) => i === idx ? { name: clean, descriptor: desc } : p);
    this.setField(s, t, f, next, opts);
  }
  removePair(s, t, f, name, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'pair-list') throw new Error('removePair requires pair-list');
    const clean = String(name ?? '').trim();
    if (!clean) return;
    const cur = this.getField(s, t, f) ?? [];
    this.setField(s, t, f, cur.filter(p => p.name !== clean), opts);
  }
  getDescription(s, t, f, value) {
    const field = this._field(t, f);
    const key = this._descKey(field);
    if (field.type === 'prose') return this._desc.perSubject?.[s]?.[key]?.__prose__ ?? '';
    if (field.descriptionScope === 'global') return this._desc.global?.[key]?.[value] ?? null;
    return this._desc.perSubject?.[s]?.[key]?.[value] ?? null;
  }
  setDescription(s, t, f, value, prose) {
    const field = this._field(t, f);
    const key = this._descKey(field);
    if (field.type === 'prose' || field.descriptionScope === 'per-subject') {
      if (!s) throw new Error('per-subject description needs subjectId');
      if (!this._desc.perSubject[s]) this._desc.perSubject[s] = {};
      if (!this._desc.perSubject[s][key]) this._desc.perSubject[s][key] = {};
      this._desc.perSubject[s][key][field.type === 'prose' ? '__prose__' : value] = prose;
    } else {
      if (!this._desc.global[key]) this._desc.global[key] = {};
      this._desc.global[key][value] = prose;
    }
    this._persist();
  }
  invalidateDescription(s, t, f, value) {
    const field = this._field(t, f);
    const key = this._descKey(field);
    if (field.descriptionScope === 'global' && field.type !== 'prose') {
      delete this._desc.global?.[key]?.[value];
    } else {
      delete this._desc.perSubject?.[s]?.[key]?.[field.type === 'prose' ? '__prose__' : value];
    }
    this._persist();
  }
  clearSubject(s) {
    delete this._values[s];
    delete this._desc.perSubject?.[s];
    this._persist();
  }
  purgeField(trackerId, fieldId) {
    // Drop values for this specific field across all subjects
    for (const subjId of Object.keys(this._values)) {
      if (this._values[subjId]?.[trackerId]) {
        delete this._values[subjId][trackerId][fieldId];
      }
    }
    // Drop global descriptions whose key matches "<trackerId>.<fieldId>" or "<trackerId>.<fieldId>[]"
    for (const key of Object.keys(this._desc.global ?? {})) {
      if (key === `${trackerId}.${fieldId}` || key === `${trackerId}.${fieldId}[]`) {
        delete this._desc.global[key];
      }
    }
    // Drop per-subject descriptions for this field
    for (const subjId of Object.keys(this._desc.perSubject ?? {})) {
      for (const key of Object.keys(this._desc.perSubject[subjId] ?? {})) {
        if (key === `${trackerId}.${fieldId}` || key === `${trackerId}.${fieldId}[]`) {
          delete this._desc.perSubject[subjId][key];
        }
      }
    }
    this._persist();
  }
  purgeTracker(trackerId, subjects = []) {
    // Drop values for every subject that has an entry for this tracker
    for (const subj of subjects) {
      if (this._values[subj.id]) delete this._values[subj.id][trackerId];
    }
    // Also sweep any remaining subject value buckets that reference this tracker
    for (const subjId of Object.keys(this._values)) {
      if (this._values[subjId]) delete this._values[subjId][trackerId];
    }
    // Drop global descriptions whose key starts with "<trackerId>."
    for (const key of Object.keys(this._desc.global ?? {})) {
      if (key.startsWith(`${trackerId}.`)) delete this._desc.global[key];
    }
    // Drop per-subject descriptions whose key starts with "<trackerId>."
    for (const subjId of Object.keys(this._desc.perSubject ?? {})) {
      for (const key of Object.keys(this._desc.perSubject[subjId] ?? {})) {
        if (key.startsWith(`${trackerId}.`)) delete this._desc.perSubject[subjId][key];
      }
    }
    this._persist();
  }
  /**
   * Remove cached descriptions whose value is no longer referenced by any current
   * field value. `referenced` is built by the engine (which knows subjects/fields):
   *   { global: Map(descKey -> Set(value)), perSubject: Map(subjId -> Map(descKey -> Set(value))) }
   * Prose descriptions (stored under __prose__) are tied to the field+subject, not a
   * value, so they are never pruned here (deletion happens via purgeField/clearSubject).
   * Returns the number of entries removed.
   */
  pruneOrphanDescriptions(referenced) {
    let removed = 0;
    for (const [key, vmap] of Object.entries(this._desc.global ?? {})) {
      const keep = referenced.global.get(key);
      for (const value of Object.keys(vmap)) {
        if (!keep || !keep.has(value)) { delete vmap[value]; removed++; }
      }
      if (Object.keys(vmap).length === 0) delete this._desc.global[key];
    }
    for (const [subjId, keys] of Object.entries(this._desc.perSubject ?? {})) {
      const subjRef = referenced.perSubject.get(subjId);
      for (const [key, vmap] of Object.entries(keys ?? {})) {
        const keep = subjRef?.get(key);
        for (const value of Object.keys(vmap)) {
          if (value === '__prose__') continue; // tied to the field, not a value
          if (!keep || !keep.has(value)) { delete vmap[value]; removed++; }
        }
        if (Object.keys(vmap).length === 0) delete this._desc.perSubject[subjId][key];
      }
    }
    if (removed > 0) this._persist();
    return removed;
  }
  serialize() { return { values: this._values, descriptions: this._desc }; }
  hydrate({ values, descriptions }) {
    this._values = values ?? {};
    this._desc = descriptions ?? { global: {}, perSubject: {} };
    this._persist();
  }
}