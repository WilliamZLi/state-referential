const ALL_ROLES = ['protagonist', 'npc', 'location', 'faction', 'object'];
const FIELD_TYPES = new Set(['text', 'number', 'enum', 'list', 'prose', 'pair-list', 'struct-list']);

function validateField(f) {
  if (!f.id) throw new Error('field.id required');
  if (!FIELD_TYPES.has(f.type)) throw new Error(`field.type invalid: ${f.type}`);
  if (f.type === 'enum' && !Array.isArray(f.options)) throw new Error('enum field requires options[]');
  // number fields may leave `max` open-ended (uncapped) — e.g. sensitivities
  // tracker uses 100 = baseline with no ceiling. min is still required so the
  // UI input + validator have a floor.
  if (f.type === 'number' && f.min == null) throw new Error('number field requires min');
  if (f.type === 'struct-list') {
    if (!Array.isArray(f.fields)) throw new Error('struct-list field requires fields[]');
    for (const sf of f.fields) {
      if (!sf.id) throw new Error('struct-list sub-field requires id');
      if (!['text', 'number', 'enum'].includes(sf.type)) throw new Error(`struct-list sub-field type invalid: ${sf.type}`);
      if (sf.type === 'enum' && !Array.isArray(sf.options)) throw new Error('struct-list sub-field enum requires options[]');
      if (sf.type === 'number' && sf.min == null) throw new Error('struct-list sub-field number requires min');
    }
  }
}

const DEFAULT_TRACKER_INJECTION = { enabled: false, trigger: 'always', tags: [], position: 'in-prompt', depth: 4, template: '' };

function normalizeDef(def) {
  if (!def.id) throw new Error('definition.id required');
  if (!def.label) throw new Error('definition.label required');
  // Normalize tracker-level injection block — merge over defaults so unknown keys are dropped
  const rawInj = def.injection ?? {};
  const injection = {
    enabled: rawInj.enabled ?? DEFAULT_TRACKER_INJECTION.enabled,
    trigger: rawInj.trigger ?? DEFAULT_TRACKER_INJECTION.trigger,
    tags: Array.isArray(rawInj.tags) ? [...rawInj.tags] : [...DEFAULT_TRACKER_INJECTION.tags],
    position: rawInj.position ?? DEFAULT_TRACKER_INJECTION.position,
    depth: rawInj.depth ?? DEFAULT_TRACKER_INJECTION.depth,
    template: rawInj.template ?? DEFAULT_TRACKER_INJECTION.template,
  };
  const knownTrackerKeys = new Set(['id','label','icon','source','appliesToRoles','autoUpdate','probe','injection','fields']);
  const knownFieldKeys = new Set(['id','label','type','default','describable','descriptionScope','inclusion','injection','options','min','max','step','allowDelta','fields','aiGuidance']);

  const out = {
    id: def.id,
    label: def.label,
    icon: def.icon ?? null,
    source: def.source ?? 'user',
    appliesToRoles: Array.isArray(def.appliesToRoles) && def.appliesToRoles.length ? [...def.appliesToRoles] : [...ALL_ROLES],
    autoUpdate: def.autoUpdate ?? true,
    probe: def.probe ?? { enabled: false },
    injection,
    fields: (def.fields ?? []).map((f, i) => {
      const normalized = {
        id: f.id,
        label: f.label ?? f.id,
        type: f.type ?? 'text',
        default: f.default ?? ((f.type === 'list' || f.type === 'pair-list' || f.type === 'struct-list') ? [] : (f.type === 'number' ? 0 : '')),
        // pair-list and struct-list carry their own descriptor inline; cached descriptions add nothing.
        describable: f.describable ?? (f.type !== 'number' && f.type !== 'pair-list' && f.type !== 'struct-list'),
        descriptionScope: f.descriptionScope ?? 'per-subject',
        inclusion: f.inclusion ?? { rule: 'always' },
        // Per-field injection: ONLY { enabled } — all other keys stripped
        injection: { enabled: (f.injection?.enabled !== false) },
        ...(f.options ? { options: [...f.options] } : {}),
        ...(f.min != null ? { min: f.min } : {}),
        ...(f.max != null ? { max: f.max } : {}),
        ...(f.step != null ? { step: f.step } : {}),
        ...(f.allowDelta != null ? { allowDelta: f.allowDelta } : {}),
        ...(f.type === 'struct-list' ? { fields: (f.fields ?? []).map(sf => ({
          id: sf.id,
          label: sf.label ?? sf.id,
          type: sf.type ?? 'text',
          default: sf.default ?? (sf.type === 'number' ? 0 : ''),
          ...(sf.options ? { options: [...sf.options] } : {}),
          ...(sf.min != null ? { min: sf.min } : {}),
        })) } : {}),
        ...(f.aiGuidance != null ? { aiGuidance: String(f.aiGuidance) } : {}),
      };
      // Preserve unknown field-level keys (e.g. userNotes, customMetadata)
      for (const [k, v] of Object.entries(f)) {
        if (!knownFieldKeys.has(k)) normalized[k] = v;
      }
      return normalized;
    }),
  };
  // Preserve unknown tracker-level keys (e.g. userNotes, customMetadata)
  for (const [k, v] of Object.entries(def)) {
    if (!knownTrackerKeys.has(k)) out[k] = v;
  }
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