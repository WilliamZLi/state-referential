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
  _validate(field, value) {
    if (field.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`number expected: ${field.id}`);
      if (field.min != null && value < field.min) return field.min;
      if (field.max != null && value > field.max) return field.max;
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
    return String(value);
  }
  _descKey(field) {
    return `${field._trackerId}.${field.id}` + (field.type === 'list' ? '[]' : '');
  }
  getStored(s, t, f) { return this._values[s]?.[t]?.[f]; }
  getField(s, t, f) { return this.getStored(s, t, f)?.v; }
  setField(s, t, f, value, opts = {}) {
    const field = this._field(t, f);
    const v = this._validate(field, value);
    const oldValue = this.getField(s, t, f);
    if (!this._values[s]) this._values[s] = {};
    if (!this._values[s][t]) this._values[s][t] = {};
    this._values[s][t][f] = { v, lastTouchedMsg: opts.msgId ?? null };
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
    this.setField(s, t, f, [...cur, entry], opts);
  }
  removeListEntry(s, t, f, entry, opts = {}) {
    const field = this._field(t, f);
    if (field.type !== 'list') throw new Error('removeListEntry requires list');
    const cur = this.getField(s, t, f) ?? [];
    this.setField(s, t, f, cur.filter(x => x !== entry), opts);
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
  serialize() { return { values: this._values, descriptions: this._desc }; }
  hydrate({ values, descriptions }) {
    this._values = values ?? {};
    this._desc = descriptions ?? { global: {}, perSubject: {} };
    this._persist();
  }
}