function renderTemplate(tpl, ctx) {
  return String(tpl ?? '').replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const parts = path.split('.');
    let v = ctx;
    for (const p of parts) v = v?.[p];
    return v == null ? '' : String(v);
  });
}

export class Injection {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._lastKeys = new Set();
    this._oneShot = new Set();
  }

  includeOnce(subjectId, trackerId, fieldId) {
    this._oneShot.add(`${subjectId}|${trackerId}|${fieldId}`);
  }

  run() {
    const newKeys = new Set();
    for (const subj of this.engine.listSubjects()) {
      for (const t of this.engine.definitions.forRole(subj.role)) {
        for (const f of t.fields) {
          const inj = f.injection;
          if (!inj?.enabled) continue;
          const oneShotToken = `${subj.id}|${t.id}|${f.id}`;
          const isOneShot = this._oneShot.has(oneShotToken);
          const trigger = inj.trigger ?? 'always';
          const include =
            isOneShot ||
            trigger === 'always' ||
            (trigger === 'tag' && this.engine.tags.anyActive(inj.tags ?? []));
          if (!include) continue;
          const value = this.engine.getField(subj.id, t.id, f.id) ?? f.default;
          const desc = this.engine.getDescription(subj.id, t.id, f.id, value);
          const ctx = {
            subject: subj.name,
            label: f.label,
            value: f.type === 'list' ? (value ?? []).join(', ') : value,
            max: f.max,
            min: f.min,
          };
          // {{value.desc}} support
          const text = String(inj.template ?? '').replace(/\{\{value\.desc\}\}/g, desc ?? String(value ?? ''));
          const rendered = renderTemplate(text, ctx);
          const key = `tracker:${subj.id}:${t.id}:${f.id}`;
          this.deps.setExtensionPrompt(key, rendered, inj.position ?? 'in-prompt', inj.depth ?? 4);
          newKeys.add(key);
        }
      }
    }
    // Clear keys that were emitted last run but not this run.
    for (const oldKey of this._lastKeys) {
      if (!newKeys.has(oldKey)) this.deps.setExtensionPrompt(oldKey, '', 'in-prompt', 0);
    }
    this._lastKeys = newKeys;
    this._oneShot.clear();
  }
}