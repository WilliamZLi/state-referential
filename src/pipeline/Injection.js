/**
 * Renders a value for injection. For number fields with `maxFromField` set,
 * renders as "current/max" by looking up the partner field's current value.
 */
function formatValue(value, field, fieldValues) {
  if (!field) {
    return value == null ? '' : String(value);
  }
  if (field.type === 'list') return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  if (field.type === 'number') {
    // displayAs: 'percent' → "120%". Paired-max takes priority if both are set.
    if (field.maxFromField && fieldValues) {
      const maxVal = fieldValues[field.maxFromField];
      if (maxVal !== undefined && maxVal !== null && maxVal !== '') {
        return `${value ?? 0}/${maxVal}`;
      }
    }
    if (field.displayAs === 'percent') {
      return `${value ?? 0}%`;
    }
  }
  return value == null ? '' : String(value);
}

/**
 * Maximum length of a cached description when rendered into the {{fields}}
 * auto-block. Probe output is supposed to be a short identifier clause
 * (~15 words), but if a misbehaving template produces paragraphs we truncate
 * to keep the prompt sane.
 */
const DESC_RENDER_CAP = 120;

function truncateDesc(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (trimmed.length <= DESC_RENDER_CAP) return trimmed;
  return trimmed.slice(0, DESC_RENDER_CAP - 1).trimEnd() + '…';
}

/**
 * Build the auto-rendered {{fields}} block.
 * One line per included field with a non-empty value.
 *
 * Scalar field: "Label: value (short-desc)" — desc shown if cached and non-empty.
 * List field:   "Label:" header followed by indented per-entry lines, each with its own cached desc.
 *
 * Descriptions are length-capped to keep the injection compact.
 */
function buildFieldsBlock(tracker, subjectId, fieldValues, engine) {
  const lines = [];
  for (const f of tracker.fields) {
    if (f.injection?.enabled === false) continue;
    const raw = fieldValues[f.id];
    if (raw === undefined || raw === null) continue;
    if (f.type === 'list') {
      if (!Array.isArray(raw) || raw.length === 0) continue;
      lines.push(`${f.label}:`);
      for (const entry of raw) {
        if (!entry) continue;
        const desc = truncateDesc(engine.getDescription(subjectId, tracker.id, f.id, entry));
        lines.push(desc ? `  - ${entry} (${desc})` : `  - ${entry}`);
      }
      continue;
    }
    const formatted = formatValue(raw, f, fieldValues);
    if (!formatted) continue;
    const desc = truncateDesc(engine.getDescription(subjectId, tracker.id, f.id, raw));
    lines.push(desc ? `${f.label}: ${formatted} (${desc})` : `${f.label}: ${formatted}`);
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
      if (prop === 'raw') {
        // .raw = just the current value, skipping any paired-max formatting
        const v = fieldValues[fieldId];
        return sanitizeValue(v == null ? '' : String(v));
      }
      return '';
    }

    // Plain {{fieldId}}
    const f = fieldMap.get(path);
    if (!f) return '';
    // Add _trackerId hint so formatValue can resolve paired-max field if needed
    return sanitizeValue(formatValue(fieldValues[path], f, fieldValues));
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
  // IN_PROMPT (0) — main prompt body, AFTER system prompts, BEFORE chat history.
  // Static placement; depth is ignored. This is where ST's preset PromptManager
  // prompts live by default. Use for always-on facts you want anchored above the chat.
  'system':           0,
  'in-prompt':        0, // alias — name suggests "in the main prompt"
  // IN_CHAT (1) — inserted at the given depth INSIDE chat history.
  // depth=0 = just above the latest message; depth=N = N messages above.
  // Use when you want the injection close to recent activity.
  'in-chat':          1,
  'author-note':      1,
  // BEFORE_PROMPT (2) — before everything, including system prompts.
  'before-char-defs': 2,
  'top':              2,
};

function resolvePosition(pos) {
  if (typeof pos === 'number') return pos;
  return POSITION_MAP[pos] ?? 0; // default IN_PROMPT (main body)
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

        // Skip the entire block if no included field has a non-empty value —
        // otherwise we'd emit a lone header like "**Sylvia's wardrobe:**" with
        // nothing under it.
        const hasAnyContent = tracker.fields.some(f => {
          if (f.injection?.enabled === false) return false;
          const v = fieldValues[f.id];
          if (v === undefined || v === null || v === '') return false;
          if (Array.isArray(v) && v.length === 0) return false;
          return true;
        });
        if (!hasAnyContent) continue;

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
