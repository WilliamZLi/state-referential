export class SnapshotStore {
  constructor(backend, opts = {}) {
    this.backend = backend;
    this.cap = opts.cap ?? 20;
    const init = backend.loadSnapshots() ?? {};
    this._snaps = new Map();
    this._pins = new Map();
    for (const [k, v] of Object.entries(init)) {
      if (k === '_pins') continue;
      this._snaps.set(k, { ...v, msgId: k, takenAt: v.takenAt ?? Date.now() });
    }
    for (const [k, reason] of Object.entries(init._pins ?? {})) this._pins.set(k, reason);
  }
  _persist() {
    const obj = {};
    for (const [k, v] of this._snaps) obj[k] = v;
    obj._pins = Object.fromEntries(this._pins);
    this.backend.saveSnapshots(obj);
  }
  save(msgId, blob) {
    this._snaps.set(msgId, { ...blob, msgId, takenAt: Date.now() });
    this._enforceCap();
    this._persist();
  }
  load(msgId) { return this._snaps.get(msgId); }
  list() {
    return [...this._snaps.values()].map(s => ({
      msgId: s.msgId, takenAt: s.takenAt, pinned: this._pins.has(s.msgId), chatId: s.chatId,
    }));
  }
  pin(msgId, reason = 'user') {
    if (!this._snaps.has(msgId)) return;
    this._pins.set(msgId, reason); this._persist();
  }
  unpin(msgId) { this._pins.delete(msgId); this._persist(); }
  dropSnapshots(msgIds) {
    for (const id of msgIds) if (!this._pins.has(id)) this._snaps.delete(id);
    this._persist();
  }
  _enforceCap() {
    if (this._snaps.size <= this.cap) return;
    const removable = [...this._snaps.values()]
      .filter(s => !this._pins.has(s.msgId))
      .sort((a, b) => a.takenAt - b.takenAt);
    while (this._snaps.size > this.cap && removable.length) {
      const s = removable.shift();
      this._snaps.delete(s.msgId);
    }
  }
}