import { newId } from '../util/id.js';

const ROLES = new Set(['protagonist', 'npc', 'location', 'faction', 'object']);

export class SubjectStore {
  constructor(backend, bus) {
    this.backend = backend;
    this.bus = bus;
    const initial = backend.loadSubjects() ?? { subjects: [], protagonistId: null };
    this._subjects = new Map(initial.subjects.map(s => [s.id, { ...s }]));
    this._protagonistId = initial.protagonistId ?? null;
  }

  _persist() {
    this.backend.saveSubjects({
      subjects: [...this._subjects.values()],
      protagonistId: this._protagonistId,
    });
  }

  add(name, opts = {}) {
    if (!/^[^.\{\}|]+$/.test(name)) throw new Error(`subject name contains forbidden chars (.,{,},|): ${name}`);
    if (this.findByName(name)) throw new Error(`subject name exists: ${name}`);
    const role = opts.role ?? 'npc';
    if (!ROLES.has(role)) throw new Error(`invalid role: ${role}`);
    const subj = {
      id: newId(),
      name,
      role,
      createdAtMsg: opts.createdAtMsg ?? null,
      createdBy: opts.createdBy ?? 'user',
      traits: opts.traits ?? {},
    };
    if (role === 'protagonist') {
      if (this._protagonistId) this._subjects.get(this._protagonistId).role = 'npc';
      this._protagonistId = subj.id;
    }
    this._subjects.set(subj.id, subj);
    this._persist();
    this.bus.emit('tracker:subject-added', { id: subj.id, name, role });
    return subj;
  }

  remove(nameOrId) {
    const subj = this._resolve(nameOrId);
    if (!subj) return;
    this._subjects.delete(subj.id);
    if (this._protagonistId === subj.id) this._protagonistId = null;
    this._persist();
    this.bus.emit('tracker:subject-removed', { id: subj.id, name: subj.name });
  }

  rename(oldName, newName) {
    if (!/^[^.\{\}|]+$/.test(newName)) throw new Error(`subject name contains forbidden chars (.,{,},|): ${newName}`);
    const subj = this.findByName(oldName);
    if (!subj) throw new Error(`subject not found: ${oldName}`);
    if (this.findByName(newName)) throw new Error(`subject name exists: ${newName}`);
    subj.name = newName;
    this._persist();
    this.bus.emit('tracker:subject-renamed', { id: subj.id, oldName, newName });
  }

  setProtagonist(idOrName) {
    const subj = this._resolve(idOrName);
    if (!subj) throw new Error(`subject not found: ${idOrName}`);
    if (this._protagonistId && this._protagonistId !== subj.id) {
      this._subjects.get(this._protagonistId).role = 'npc';
    }
    subj.role = 'protagonist';
    this._protagonistId = subj.id;
    this._persist();
    this.bus.emit('tracker:protagonist-changed', { id: subj.id });
  }

  get(id) { return this._subjects.get(id); }

  findByName(name) {
    for (const s of this._subjects.values()) if (s.name === name) return s;
    return undefined;
  }

  list() { return [...this._subjects.values()]; }

  protagonistId() { return this._protagonistId; }

  protagonist() { return this._protagonistId ? this._subjects.get(this._protagonistId) : null; }

  resolveAlias(token) {
    if (token === 'protagonist' || token === 'char') return this.protagonist();
    if (token === 'user' || token === 'self') return null; // documented v1 limitation — no user persona tracked
    return this.findByName(token) ?? this.get(token);
  }

  _resolve(idOrName) { return this._subjects.get(idOrName) ?? this.findByName(idOrName); }
}