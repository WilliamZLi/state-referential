/**
 * Renders a list-type value as a comma-separated string.
 */
function formatValue(value, fieldType) {
  if (fieldType === 'list') return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return value == null ? '' : String(value);
}

/**
 * Build the auto-rendered {{fields}} block.
 * One line per included field with a non-empty value: "Label: value".
 * Descriptions are NOT included by default (they're often paragraph-length probe
 * output, which balloons the prompt). Users who want descriptions can author a
 * custom template with explicit {{<fieldId>.desc}} placeholders.
 */
function buildFieldsBlock(tracker, subjectId, fieldValues, engine) {
  const lines = [];
  for (const f of tracker.fields) {
    if (f.injection?.enabled === false) continue;
    const raw = fieldValues[f.id];
    const formatted = formatValue(raw, f.type);
    if (!formatted) continue;                      // skip empty values
    lines.push(`${f.label}: ${formatted}`);
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

/**
 * Map our string position labels (used in tracker definitions) to ST's numeric
 * extension_prompt_types values. ST's setExtensionPrompt expects the numeric
 * constant; passing the raw string makes ST silently drop the injection.
 *
 * ST extension_prompt_types (from public.js):
 *   NONE = -1          — disabled
 *   IN_PROMPT = 0      — main prompt body (after system, before chat history) — anchors background facts
 *   IN_CHAT = 1        — inserted at a depth within chat history — context-sensitive placement
 *   BEFORE_PROMPT = 2  — before the entire main prompt — top-of-context anchoring
 */
const POSITION_MAP = {
  'system':           0, // IN_PROMPT (in the main prompt body — most natural for always-true background facts)
  'in-prompt':        1, // IN_CHAT (at depth in chat history)
  'author-note':      1, // IN_CHAT (author-note uses the same depth-insertion slot)
  'before-char-defs': 2, // BEFORE_PROMPT (before everything else; for ground-truth anchoring like traits)
};

function resolvePosition(pos) {
  if (typeof pos === 'number') return pos;
  return POSITION_MAP[pos] ?? 1; // default IN_CHAT
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
        this.deps.setExtensionPrompt(key, rendered, resolvePosition(inj.position ?? 'in-prompt'), inj.depth ?? 4);
        newKeys.add(key);
      }
    }

    // Clear keys that were emitted last run but not this run.
    for (const oldKey of this._lastKeys) {
      if (!newKeys.has(oldKey)) this.deps.setExtensionPrompt(oldKey, '', resolvePosition('in-prompt'), 0);
    }
    this._lastKeys = newKeys;
    this._oneShot.clear();
  }
}
