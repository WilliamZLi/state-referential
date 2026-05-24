/**
 * Renders a list-type value as a comma-separated string.
 */
function formatValue(value, fieldType) {
  if (fieldType === 'list') return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return value == null ? '' : String(value);
}

/**
 * Build the auto-rendered {{fields}} block.
 * One line per included field with a non-empty value:
 *   "Label: value (desc)"  — desc part omitted if empty
 */
function buildFieldsBlock(tracker, subjectId, fieldValues, engine) {
  const lines = [];
  for (const f of tracker.fields) {
    if (f.injection?.enabled === false) continue;
    const raw = fieldValues[f.id];
    const formatted = formatValue(raw, f.type);
    if (!formatted) continue;                      // skip empty values
    const desc = engine.getDescription(subjectId, tracker.id, f.id, raw);
    const line = desc ? `${f.label}: ${formatted} (${desc})` : `${f.label}: ${formatted}`;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Sanitize a substituted value so it cannot be re-interpreted as a template
 * placeholder or inject newlines that break prompt formatting.
 *   {{ → { {    }} → } }    \n → (space)
 */
function sanitizeValue(str) {
  return String(str ?? '')
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }')
    .replace(/\n/g, ' ');
}

/**
 * Expand a tracker-level template.
 *
 * Supported placeholders:
 *   {{subject}}          — subject display name
 *   {{fields}}           — auto-rendered block of enabled fields
 *   {{<fieldId>}}        — field value (formatted)
 *   {{<fieldId>.desc}}   — cached description for that field's current value
 *   {{<fieldId>.label}}  — field label
 */
function expandTemplate(tpl, tracker, subjectId, subjectName, fieldValues, engine) {
  // Build field lookup maps once
  const fieldMap = new Map(tracker.fields.map(f => [f.id, f]));

  // Pre-compute {{fields}} block (only computed if referenced or template empty)
  let fieldsBlock = null;
  const getFieldsBlock = () => {
    if (fieldsBlock === null) fieldsBlock = buildFieldsBlock(tracker, subjectId, fieldValues, engine);
    return fieldsBlock;
  };

  const template = tpl || '{{fields}}';

  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
    if (path === 'subject') return sanitizeValue(subjectName);
    if (path === 'fields') return getFieldsBlock();

    const dotIdx = path.indexOf('.');
    if (dotIdx !== -1) {
      const fieldId = path.slice(0, dotIdx);
      const prop = path.slice(dotIdx + 1);
      const f = fieldMap.get(fieldId);
      if (!f) return '';
      if (prop === 'desc') {
        const raw = fieldValues[fieldId];
        return sanitizeValue(engine.getDescription(subjectId, tracker.id, fieldId, raw) ?? '');
      }
      if (prop === 'label') return sanitizeValue(f.label ?? fieldId);
      return '';
    }

    // Plain {{fieldId}}
    const f = fieldMap.get(path);
    if (!f) return '';
    return sanitizeValue(formatValue(fieldValues[path], f.type));
  });
}

export class Injection {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._lastKeys = new Set();
    this._oneShot = new Set();
  }

  /**
   * Mark a tracker as one-shot included for the next run().
   * fieldId arg is kept for backward compat with SlashCommands but is ignored
   * (injection is now per-tracker, not per-field).
   */
  includeOnce(subjectId, trackerId, fieldId) {
    this._oneShot.add(`${subjectId}|${trackerId}`);
  }

  run() {
    const newKeys = new Set();

    for (const subj of this.engine.listSubjects()) {
      for (const tracker of this.engine.definitions.forRole(subj.role)) {
        const inj = tracker.injection;
        if (!inj?.enabled) continue;

        const oneShotToken = `${subj.id}|${tracker.id}`;
        const isOneShot = this._oneShot.has(oneShotToken);
        const trigger = inj.trigger ?? 'always';
        const include =
          isOneShot ||
          trigger === 'always' ||
          (trigger === 'tag' && this.engine.tags.anyActive(inj.tags ?? []));
        if (!include) continue;

        // Collect current field values for included fields
        const fieldValues = {};
        for (const f of tracker.fields) {
          fieldValues[f.id] = this.engine.getField(subj.id, tracker.id, f.id) ?? f.default;
        }

        const rendered = expandTemplate(
          inj.template ?? '',
          tracker,
          subj.id,
          subj.name,
          fieldValues,
          this.engine,
        );

        const key = `tracker:${subj.id}:${tracker.id}`;
        this.deps.setExtensionPrompt(key, rendered, inj.position ?? 'in-prompt', inj.depth ?? 4);
        newKeys.add(key);
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
