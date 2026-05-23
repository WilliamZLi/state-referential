export class SceneTagStore {
  constructor(backend, bus) {
    this.backend = backend;
    this.bus = bus;
    this._tags = new Set(backend.loadSceneTags() ?? []);
  }
  _persist() { this.backend.saveSceneTags([...this._tags]); }
  set(tag, on) {
    const had = this._tags.has(tag);
    if (on && !had) this._tags.add(tag);
    else if (!on && had) this._tags.delete(tag);
    else return;
    this._persist();
    this.bus.emit('tracker:tag-changed', { tag, on });
  }
  toggle(tag) { this.set(tag, !this._tags.has(tag)); }
  isActive(tag) { return this._tags.has(tag); }
  anyActive(tags) { return Array.isArray(tags) && tags.some(t => this._tags.has(t)); }
  list() { return [...this._tags]; }
}