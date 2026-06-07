import { DefinitionStore } from './DefinitionStore.js';
import { SubjectStore } from './SubjectStore.js';
import { ValueStore } from './ValueStore.js';
import { SceneTagStore } from './SceneTagStore.js';
import { SnapshotStore } from './SnapshotStore.js';
import { parseCommands } from '../pipeline/CommandParser.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

function mkBus() {
  const handlers = new Map();
  return {
    on(e, fn) { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e).add(fn); },
    off(e, fn) { handlers.get(e)?.delete(fn); },
    emit(e, p) {
      const s = handlers.get(e);
      if (s) for (const fn of s) try { fn(p); } catch (err) { console.error('[tracker]', err); }
    },
  };
}

export class TrackerEngine {
  constructor(backend, opts = {}) {
    this.bus = mkBus();
    this.opts = opts;
    this._attach(backend);
  }
  _attach(backend) {
    this.backend = backend;
    this.definitions = new DefinitionStore(backend, this.bus);
    this.subjects = new SubjectStore(backend, this.bus);
    this.values = new ValueStore(backend, this.bus, this.definitions);
    this.tags = new SceneTagStore(backend, this.bus);
    this.snapshots = new SnapshotStore(backend, { cap: this.opts.snapshotCap ?? 20 });
  }
  setStorageBackend(backend) { this._attach(backend); this.bus.emit('tracker:backend-changed', {}); }
  on(e, fn) { this.bus.on(e, fn); }
  off(e, fn) { this.bus.off(e, fn); }

  // Definitions
  defineTracker(d) { this.definitions.define(d); }
  updateTracker(id, d) {
    const oldDef = this.definitions.get(id);
    this.definitions.update(id, d);
    const newDef = this.definitions.get(id);
    if (oldDef && newDef) {
      this._migrateFieldTypes(id, oldDef, newDef);
      // Bug 4: cascade field deletion — purge values+descriptions for removed fields
      const newFieldIds = new Set(newDef.fields.map(f => f.id));
      for (const oldField of oldDef.fields) {
        if (!newFieldIds.has(oldField.id)) {
          this.values.purgeField(id, oldField.id);
        }
      }
    }
  }
  deleteTracker(id) {
    this.definitions.delete(id);
    // Cascade: drop values + descriptions for this tracker
    this.values.purgeTracker(id, this.subjects.list());
  }
  getTracker(id) { return this.definitions.get(id); }
  listTrackers() { return this.definitions.list(); }

  // Subjects
  addSubject(name, opts) { return this.subjects.add(name, opts); }
  removeSubject(name) {
    const subj = this.subjects.resolveAlias(name) ?? this.subjects.findByName(name);
    if (!subj) return;
    this.values.clearSubject(subj.id);
    this.subjects.remove(name);
  }
  renameSubject(o, n) { this.subjects.rename(o, n); }
  setProtagonist(name) { this.subjects.setProtagonist(name); }
  listSubjects() { return this.subjects.list(); }
  protagonist() { return this.subjects.protagonist(); }
  resolveSubject(t) { return this.subjects.resolveAlias(t); }
  setSubjectActive(id, active) { this.subjects.setActive(id, active); }
  isSubjectActive(id) { return this.subjects.isSubjectActive(id); }

  // Values
  getField(s, t, f) { return this.values.getField(s, t, f); }
  setField(s, t, f, v, opts) {
    this.values.setField(s, t, f, v, opts);
    // Bug 3: mirror traits tracker edits back to subject.traits so DescriptionProbe
    // {{traits.X}} macros stay current when fields are edited after subject creation.
    if (t === 'traits') {
      const subj = this.subjects.get(s);
      if (subj) {
        if (!subj.traits) subj.traits = {};
        subj.traits[f] = v;
        this.subjects._persist();
      }
    }
  }
  applyDelta(s, t, f, d, opts) { this.values.applyDelta(s, t, f, d, opts); }
  addListEntry(s, t, f, e, opts) { this.values.addListEntry(s, t, f, e, opts); }
  removeListEntry(s, t, f, e, opts) { this.values.removeListEntry(s, t, f, e, opts); }
  getListMeta(s, t, f) { return this.values.getListMeta(s, t, f); }
  setPair(s, t, f, name, descriptor, opts) { this.values.setPair(s, t, f, name, descriptor, opts); }
  removePair(s, t, f, name, opts) { this.values.removePair(s, t, f, name, opts); }

  // Descriptions
  getDescription(s, t, f, v) { return this.values.getDescription(s, t, f, v); }
  setDescription(s, t, f, v, p) { this.values.setDescription(s, t, f, v, p); }
  invalidateDescription(s, t, f, v) { this.values.invalidateDescription(s, t, f, v); }

  /**
   * Delete cached descriptions for values no longer referenced by any current field
   * value across all subjects (worn fields, or entries in any list such as a wardrobe).
   * Manual, deliberate cleanup — descriptions are otherwise kept as a cache so reverts
   * and re-encountered values reuse existing prose. Returns the number removed.
   */
  pruneOrphanDescriptions() {
    const referenced = { global: new Map(), perSubject: new Map() };
    for (const subj of this.listSubjects()) {
      for (const tracker of this.listTrackers()) {
        for (const field of tracker.fields) {
          if (!field.describable || field.type === 'prose') continue;
          const val = this.getField(subj.id, tracker.id, field.id);
          if (val == null) continue;
          const key = `${tracker.id}.${field.id}` + (field.type === 'list' || field.type === 'pair-list' ? '[]' : '');
          const values = Array.isArray(val)
            ? val.map(e => (e && typeof e === 'object' ? e.name : e)).filter(v => v != null).map(String)
            : [String(val)];
          if (field.descriptionScope === 'global') {
            if (!referenced.global.has(key)) referenced.global.set(key, new Set());
            for (const v of values) referenced.global.get(key).add(v);
          } else {
            if (!referenced.perSubject.has(subj.id)) referenced.perSubject.set(subj.id, new Map());
            const m = referenced.perSubject.get(subj.id);
            if (!m.has(key)) m.set(key, new Set());
            for (const v of values) m.get(key).add(v);
          }
        }
      }
    }
    return this.values.pruneOrphanDescriptions(referenced);
  }

  // Tags
  setSceneTag(tag, on) { this.tags.set(tag, on); }
  toggleSceneTag(tag) { this.tags.toggle(tag); }
  listActiveTags() { return this.tags.list(); }
  isTagActive(tag) { return this.tags.isActive(tag); }

  // Snapshots
  snapshot(takenAtMsg = null) {
    const ser = this.values.serialize();
    return {
      takenAtMsg,
      subjects: clone({ subjects: this.subjects.list(), protagonistId: this.subjects.protagonistId() }),
      values: clone(ser.values),
      descriptions: clone(ser.descriptions),
      sceneTags: clone(this.tags.list()),
    };
  }
  saveSnapshot(msgId) { this.snapshots.save(msgId, this.snapshot(msgId)); }
  pinSnapshot(id, reason) { this.snapshots.pin(id, reason); }
  unpinSnapshot(id) { this.snapshots.unpin(id); }
  listSnapshots() { return this.snapshots.list(); }
  loadSnapshot(id) { return this.snapshots.load(id); }
  dropSnapshots(ids) { this.snapshots.dropSnapshots(ids); }

  /**
   * The value of a field as captured in the most recent snapshot — i.e. the
   * pre-turn baseline, which is what the model saw on the previous turn.
   * Used to render "up from / down from" deltas in the injection.
   * Returns undefined if there is no snapshot or the field wasn't stored.
   */
  previousValue(subjectId, trackerId, fieldId) {
    const list = this.listSnapshots();
    if (!list.length) return undefined;
    let latest = list[0];
    for (const s of list) if ((s.takenAt ?? 0) > (latest.takenAt ?? 0)) latest = s;
    const snap = this.loadSnapshot(latest.msgId);
    return snap?.values?.[subjectId]?.[trackerId]?.[fieldId]?.v;
  }
  restoreSnapshot(s) {
    // Scene tags are sticky user controls — NOT reverted by snapshot restore
    // (swipe/delete/regen). We deliberately skip saveSceneTags so the user's
    // active tags persist across undo; _attach re-reads them from the unchanged backend.
    this.backend.saveSubjects(clone(s.subjects));
    this.backend.saveValues(clone(s.values));
    this.backend.saveDescriptions(clone(s.descriptions));
    this._attach(this.backend);
    this.bus.emit('tracker:state-restored', {});
  }

  diffSnapshots(a, b) {
    const aSubs = new Map(a.subjects.subjects.map(s => [s.id, s]));
    const bSubs = new Map(b.subjects.subjects.map(s => [s.id, s]));
    const subjectsAdded = [...bSubs.values()].filter(s => !aSubs.has(s.id));
    const subjectsRemoved = [...aSubs.values()].filter(s => !bSubs.has(s.id));
    const subjectsRenamed = [...bSubs.values()]
      .filter(s => aSubs.has(s.id) && aSubs.get(s.id).name !== s.name)
      .map(s => ({ id: s.id, oldName: aSubs.get(s.id).name, newName: s.name }));
    const protagonistChanged = a.subjects.protagonistId === b.subjects.protagonistId
      ? null : { from: a.subjects.protagonistId, to: b.subjects.protagonistId };

    const fieldChanges = [];
    const ids = new Set([...Object.keys(a.values), ...Object.keys(b.values)]);
    for (const sid of ids) {
      const av = a.values[sid] ?? {}, bv = b.values[sid] ?? {};
      const sname = (bSubs.get(sid) ?? aSubs.get(sid))?.name ?? sid;
      const tids = new Set([...Object.keys(av), ...Object.keys(bv)]);
      for (const tid of tids) {
        const at = av[tid] ?? {}, bt = bv[tid] ?? {};
        const fids = new Set([...Object.keys(at), ...Object.keys(bt)]);
        for (const fid of fids) {
          const fdef = this.definitions.getField(tid, fid);
          if (!fdef) continue;
          const aV = at[fid]?.v ?? fdef.default, bV = bt[fid]?.v ?? fdef.default;
          if (JSON.stringify(aV) === JSON.stringify(bV)) continue;
          const base = { subject: sid, subjectName: sname, trackerId: tid, fieldId: fid };
          if (fdef.type === 'list') {
            const aL = aV ?? [], bL = bV ?? [];
            for (const e of bL.filter(x => !aL.includes(x))) fieldChanges.push({ ...base, op: 'add', entry: e });
            for (const e of aL.filter(x => !bL.includes(x))) fieldChanges.push({ ...base, op: 'remove', entry: e });
          } else if (fdef.type === 'pair-list') {
            const aMap = new Map((aV ?? []).map(p => [p.name, p.descriptor]));
            const bMap = new Map((bV ?? []).map(p => [p.name, p.descriptor]));
            for (const [name, desc] of bMap) {
              if (!aMap.has(name) || aMap.get(name) !== desc) {
                fieldChanges.push({ ...base, op: 'add', entry: name, descriptor: desc });
              }
            }
            for (const name of aMap.keys()) {
              if (!bMap.has(name)) fieldChanges.push({ ...base, op: 'remove', entry: name });
            }
          } else if (fdef.type === 'number' && typeof aV === 'number' && typeof bV === 'number') {
            fieldChanges.push({ ...base, op: 'delta', delta: bV - aV });
          } else {
            fieldChanges.push({ ...base, op: 'set', oldValue: aV, newValue: bV });
          }
        }
      }
    }

    const descriptionChanges = [];
    if (JSON.stringify(a.descriptions) !== JSON.stringify(b.descriptions)) {
      for (const [key, vmap] of Object.entries(b.descriptions.global ?? {})) {
        for (const [value, prose] of Object.entries(vmap)) {
          if (a.descriptions.global?.[key]?.[value] !== prose)
            descriptionChanges.push({ scope: 'global', subjectId: null, key, value, prose });
        }
      }
      for (const [sid, root] of Object.entries(b.descriptions.perSubject ?? {})) {
        for (const [key, vmap] of Object.entries(root)) {
          for (const [value, prose] of Object.entries(vmap)) {
            if (a.descriptions.perSubject?.[sid]?.[key]?.[value] !== prose)
              descriptionChanges.push({ scope: 'perSubject', subjectId: sid, key, value, prose });
          }
        }
      }
    }

    const aTags = new Set(a.sceneTags), bTags = new Set(b.sceneTags);
    const sceneTagChanges = {
      added: [...bTags].filter(t => !aTags.has(t)),
      removed: [...aTags].filter(t => !bTags.has(t)),
    };

    return { subjectsAdded, subjectsRemoved, subjectsRenamed, protagonistChanged, fieldChanges, descriptionChanges, sceneTagChanges };
  }

  renderDiffAsCommands(diff) {
    const lines = [];
    for (const s of diff.subjectsAdded) lines.push(`NEW_SUBJECT "${s.name}" ${s.role}`);
    for (const c of diff.fieldChanges) {
      const path = `${c.trackerId}.${c.fieldId}`;
      if (c.op === 'set') lines.push(`SET ${c.subjectName} ${path} = "${c.newValue}"`);
      else if (c.op === 'delta') lines.push(`DELTA ${c.subjectName} ${path} ${c.delta >= 0 ? '+' : ''}${c.delta}`);
      else if (c.op === 'add') {
        lines.push(c.descriptor != null
          ? `ADD ${c.subjectName} ${path} "${c.entry}" = "${c.descriptor}"`
          : `ADD ${c.subjectName} ${path} "${c.entry}"`);
      }
      else if (c.op === 'remove') lines.push(`REMOVE ${c.subjectName} ${path} "${c.entry}"`);
    }
    return lines.join('\n');
  }

  applyCommands(text, opts = {}) {
    const cmds = parseCommands(text, { cap: opts.cap ?? 20 });
    const errors = [];
    let applied = 0;
    for (const c of cmds) {
      try {
        if (c.op === 'NEW_SUBJECT') {
          if (this.subjects.findByName(c.name)) { applied++; continue; } // idempotent
          this.subjects.add(c.name, { role: c.role, createdBy: opts.source ?? 'auto-update', createdAtMsg: opts.msgId ?? null });
          applied++;
          continue;
        }
        const subj = this.subjects.resolveAlias(c.subject);
        if (!subj) { errors.push(`unknown subject: ${c.subject}`); continue; }
        const field = this.definitions.getField(c.tracker, c.field);
        if (!field) { errors.push(`unknown field: ${c.tracker}.${c.field}`); continue; }
        const writeOpts = { source: opts.source ?? 'auto-update', msgId: opts.msgId ?? null };
        if (c.op === 'SET') this.values.setField(subj.id, c.tracker, c.field, this._coerceForField(field, c.value), writeOpts);
        else if (c.op === 'DELTA') this.values.applyDelta(subj.id, c.tracker, c.field, c.delta, writeOpts);
        else if (c.op === 'ADD') {
          if (field.type === 'pair-list') this.values.setPair(subj.id, c.tracker, c.field, c.entry, c.descriptor ?? '', writeOpts);
          else this.values.addListEntry(subj.id, c.tracker, c.field, c.entry, writeOpts);
        } else if (c.op === 'REMOVE') {
          if (field.type === 'pair-list') this.values.removePair(subj.id, c.tracker, c.field, c.entry, writeOpts);
          else this.values.removeListEntry(subj.id, c.tracker, c.field, c.entry, writeOpts);
        }
        applied++;
      } catch (e) {
        errors.push(e.message ?? String(e));
      }
    }
    this.bus.emit('tracker:auto-update-completed', { commandsApplied: applied, errors });
    return { applied, errors };
  }

  _coerceForField(field, raw) {
    if (field.type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : (field.default ?? 0);
    }
    return raw;
  }

  _migrateFieldTypes(trackerId, oldDef, newDef) {
    const oldFields = new Map(oldDef.fields.map(f => [f.id, f]));
    const newFields = new Map(newDef.fields.map(f => [f.id, f]));
    const subjects = this.subjects.list();

    for (const [fieldId, newField] of newFields) {
      const oldField = oldFields.get(fieldId);
      if (!oldField || oldField.type === newField.type) continue;

      for (const subj of subjects) {
        const raw = this.values.getField(subj.id, trackerId, fieldId);
        if (raw === undefined || raw === null) continue;

        let coerced;
        const oldType = oldField.type;
        const newType = newField.type;

        if (oldType === 'pair-list' && newType === 'list') {
          // pair-list → list: drop descriptors, keep names
          coerced = Array.isArray(raw) ? raw.map(p => p?.name).filter(Boolean) : [];
        } else if (oldType === 'list' && newType === 'pair-list') {
          // list → pair-list: each string becomes {name, descriptor: ''}
          coerced = Array.isArray(raw) ? raw.filter(Boolean).map(name => ({ name: String(name), descriptor: '' })) : [];
        } else if (oldType === 'pair-list' && newType !== 'pair-list') {
          // pair-list → scalar: take first name or default
          const first = Array.isArray(raw) && raw.length > 0 ? (raw[0]?.name ?? '') : '';
          if (newType === 'number') {
            const n = Number(first);
            coerced = Number.isFinite(n) ? n : (newField.default ?? 0);
          } else {
            coerced = first !== '' ? first : (newField.default ?? '');
          }
        } else if (oldType !== 'pair-list' && newType === 'pair-list') {
          // scalar → pair-list: single entry with raw as name, no descriptor
          const s = String(raw);
          coerced = s !== '' ? [{ name: s, descriptor: '' }] : [];
        } else if (oldType === 'list' && newType !== 'list') {
          // list → scalar: take first entry or empty/default
          const first = Array.isArray(raw) && raw.length > 0 ? raw[0] : '';
          if (newType === 'number') {
            const n = Number(first);
            coerced = Number.isFinite(n) ? n : (newField.default ?? 0);
          } else {
            coerced = first !== '' ? first : (newField.default ?? '');
          }
        } else if (oldType !== 'list' && newType === 'list') {
          // scalar → list: wrap in array if non-empty
          const s = String(raw);
          coerced = s !== '' ? [s] : [];
        } else if (newType === 'number') {
          // text/enum/prose → number
          const n = Number(raw);
          coerced = Number.isFinite(n) ? n : (newField.default ?? 0);
        } else if (oldType === 'number') {
          // number → text/enum/prose
          coerced = String(raw);
        } else {
          // text/enum/prose ↔ text/enum/prose
          coerced = String(raw);
        }

        // For enum: if coerced value not in options, reset to default
        if (newType === 'enum' && !newField.options.includes(coerced)) {
          coerced = newField.default ?? newField.options[0] ?? '';
        }

        try {
          this.values.setField(subj.id, trackerId, fieldId, coerced, { source: 'migration' });
        } catch (_) {
          // If coercion still fails (e.g. enum options changed), use field default
          try {
            this.values.setField(subj.id, trackerId, fieldId, newField.default, { source: 'migration' });
          } catch (__) { /* ignore */ }
        }
      }
    }
  }
}