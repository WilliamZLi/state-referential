const ALL_ROLES = ['protagonist', 'npc', 'location', 'faction', 'object'];
const FIELD_TYPES = new Set(['text', 'number', 'enum', 'list', 'prose']);

function validateField(f) {
  if (!f.id) throw new Error('field.id required');
  if (!FIELD_TYPES.has(f.type)) throw new Error(`field.type invalid: ${f.type}`);
  if (f.type === 'enum' && !Array.isArray(f.options)) throw new Error('enum field requires options[]');
  if (f.type === 'number' && (f.min == null || f.max == null)) throw new Error('number field requires min and max');
}

function normalizeDef(def) {
  if (!def.id) throw new Error('definition.id required');
  if (!def.label) throw new Error('definition.label required');
  const out = {
    id: def.id,
    label: def.label,
    icon: def.icon ?? null,
    source: def.source ?? 'user',
    appliesToRoles: Array.isArray(def.appliesToRoles) && def.appliesToRoles.length ? [...def.appliesToRoles] : [...ALL_ROLES],
    autoUpdate: def.autoUpdate ?? true,
    probe: def.probe ?? { enabled: false },
    fields: (def.fields ?? []).map(f => ({
      id: f.id,
      label: f.label ?? f.id,
      type: f.type ?? 'text',
      default: f.default ?? (f.type === 'list' ? [] : (f.type === 'number' ? 0 : '')),
      describable: f.describable ?? (f.type !== 'number'),
      descriptionScope: f.descriptionScope ?? 'per-subject',
      inclusion: f.inclusion ?? { rule: 'always' },
      injection: f.injection ?? { enabled: false },
      ...(f.options ? { options: [...f.options] } : {}),
      ...(f.min != null ? { min: f.min } : {}),
      ...(f.max != null ? { max: f.max } : {}),
      ...(f.step != null ? { step: f.step } : {}),
      ...(f.allowDelta != null ? { allowDelta: f.allowDelta } : {}),
    })),
  };
  out.fields.forEach(validateField);
  return out;
}

export class DefinitionStore {
  constructor(backend, bus) {
    this.backend = backend;
    this.bus = bus;
    this._defs = new Map();
    for (const d of backend.loadDefinitions() ?? []) this._defs.set(d.id, d);
  }
  _persist() { this.backend.saveDefinitions([...this._defs.values()]); }
  define(def) {
    const normalized = normalizeDef(def);
    if (this._defs.has(normalized.id)) throw new Error(`definition exists: ${normalized.id}`);
    this._defs.set(normalized.id, normalized);
    this._persist();
    this.bus.emit('tracker:schema-changed', { trackerId: normalized.id });
  }
  update(id, patch) {
    const cur = this._defs.get(id);
    if (!cur) throw new Error(`definition not found: ${id}`);
    const next = normalizeDef({ ...cur, ...patch, id });
    this._defs.set(id, next);
    this._persist();
    this.bus.emit('tracker:schema-changed', { trackerId: id });
  }
  delete(id) {
    if (!this._defs.delete(id)) return;
    this._persist();
    this.bus.emit('tracker:schema-changed', { trackerId: id });
  }
  get(id) { return this._defs.get(id); }
  list() { return [...this._defs.values()]; }
  forRole(role) { return this.list().filter(d => d.appliesToRoles.includes(role)); }
  getField(trackerId, fieldId) {
    const d = this._defs.get(trackerId);
    return d ? d.fields.find(f => f.id === fieldId) : undefined;
  }
}