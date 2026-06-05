import { formatValue } from '../util/formatValue.js';
import { activeEntries } from '../util/countdown.js';

function parsePath(path) {
  // <subject>.<tracker>.<field>[.suffix]
  const parts = String(path).split('.');
  if (parts.length < 3) return null;
  return { subject: parts[0], tracker: parts[1], field: parts[2], suffix: parts.slice(3).join('.') };
}

/**
 * Render a single tracker block for a subject.
 * Uses tracker.injection.template if non-empty, otherwise auto-renders
 * "**Label:** value" lines for each field with a non-empty value.
 */
function renderTrackerBlock(engine, subj, tracker) {
  const tpl = (tracker.injection?.template ?? '').trim();
  const fieldValues = {};
  for (const f of tracker.fields) {
    const raw = engine.getField(subj.id, tracker.id, f.id) ?? f.default;
    fieldValues[f.id] = (f.type === 'list' && f.inclusion?.activeWindow != null)
      ? activeEntries(engine, subj.id, tracker.id, f, raw)
      : raw;
  }

  if (tpl) {
    // Expand template placeholders: {{subject}}, {{fields}}, {{fieldId}}, {{fieldId.desc}}, {{fieldId.label}}
    const fieldMap = new Map(tracker.fields.map(f => [f.id, f]));
    const fieldsBlock = tracker.fields
      .filter(f => {
        const v = fieldValues[f.id];
        return v !== null && v !== undefined && String(v) !== '';
      })
      .map(f => `**${f.label}:** ${formatValue(fieldValues[f.id], f, fieldValues)}`)
      .join('\n');

    return tpl.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
      if (key === 'subject') return subj.name;
      if (key === 'fields') return fieldsBlock;
      const dotIdx = key.indexOf('.');
      if (dotIdx !== -1) {
        const fid = key.slice(0, dotIdx);
        const prop = key.slice(dotIdx + 1);
        const f = fieldMap.get(fid);
        if (!f) return '';
        if (prop === 'desc') return engine.getDescription(subj.id, tracker.id, fid, fieldValues[fid]) ?? '';
        if (prop === 'label') return f.label ?? fid;
        return '';
      }
      const f = fieldMap.get(key);
      if (!f) return '';
      return formatValue(fieldValues[key], f, fieldValues);
    });
  }

  // Auto-block: "**Label:** value" lines
  const lines = tracker.fields
    .filter(f => {
      const v = fieldValues[f.id];
      return v !== null && v !== undefined && String(v) !== '' && !(Array.isArray(v) && v.length === 0);
    })
    .map(f => `**${f.label}:** ${formatValue(fieldValues[f.id], f, fieldValues)}`);
  return lines.join('\n');
}

/**
 * Resolve {{tracker::<subject>.<tracker>}} — whole tracker block.
 */
export function resolveTrackerBlock(engine, path) {
  const parts = String(path).split('.');
  if (parts.length !== 2) return null; // not a 2-part path — caller tries other forms
  const [subjectAlias, trackerId] = parts;
  const subj = engine.resolveSubject(subjectAlias);
  if (!subj) return '';
  const tracker = engine.getTracker(trackerId);
  if (!tracker) return '';
  return renderTrackerBlock(engine, subj, tracker);
}

/**
 * Decide whether a tracker block should currently render, matching the same
 * gating logic the auto-injection pipeline uses:
 *   - tracker.injection.enabled !== false
 *   - tracker.injection.trigger === 'always' OR (trigger === 'tag' AND any tag active)
 *     (trigger === 'manual' is treated as "skip" — manual-only)
 * Used by {{tracker::<subject>}} so the all-trackers macro doesn't dump tag-gated
 * blocks at times they shouldn't appear.
 */
function trackerShouldRender(engine, tracker) {
  const inj = tracker.injection;
  if (!inj) return true; // legacy tracker without an injection block — render
  if (inj.enabled === false) return false;
  const trigger = inj.trigger ?? 'always';
  if (trigger === 'always') return true;
  if (trigger === 'manual') return false;
  if (trigger === 'tag') return engine.tags.anyActive(inj.tags ?? []);
  return true;
}

/**
 * Resolve {{tracker::<subject>}} — all trackers for subject, concatenated.
 * Respects each tracker's injection.enabled + trigger so tag-gated trackers
 * (inventory, relationships) only appear when their scene tags are active.
 */
export function resolveAllTrackers(engine, subjectAlias) {
  const subj = engine.resolveSubject(subjectAlias);
  if (!subj) return '';
  const trackers = engine.definitions.forRole(subj.role).filter(t => trackerShouldRender(engine, t));
  const blocks = trackers.map(t => renderTrackerBlock(engine, subj, t)).filter(b => b.trim());
  return blocks.join('\n\n');
}

/**
 * Resolve {{tracker::<subject>.<tracker>._probe}} — standalone probe output.
 * proseStore shape: { [trackerId]: { [subjectId|'_']: string } }
 */
export function resolveProbe(engine, path, proseStore) {
  const parts = String(path).split('.');
  // must be exactly 3 parts ending in _probe
  if (parts.length !== 3 || parts[2] !== '_probe') return null;
  const [subjectAlias, trackerId] = parts;
  const subj = engine.resolveSubject(subjectAlias);
  if (!subj) return '';
  const stored = proseStore?.[trackerId];
  if (!stored) return '';
  return stored[subj.id] ?? stored['_'] ?? '';
}

export function resolveMacro(engine, path) {
  const p = parsePath(path);
  if (!p) return '';
  const subj = engine.resolveSubject(p.subject);
  if (!subj) return '';
  const fdef = engine.definitions.getField(p.tracker, p.field);
  if (!fdef) return '';
  const value = engine.getField(subj.id, p.tracker, p.field) ?? fdef.default;
  if (p.suffix === 'desc') {
    if (fdef.type === 'list') return (value ?? []).map(e => engine.getDescription(subj.id, p.tracker, p.field, e) ?? e).join(', ');
    return engine.getDescription(subj.id, p.tracker, p.field, value) ?? '';
  }
  if (p.suffix === 'raw') return String(value ?? '');
  if (p.suffix === 'label') return fdef.label;
  // Default render — apply field-level formatting (displayAs, maxFromField).
  // For paired-max lookup we need the partner field's current value too.
  const fieldValues = {};
  if (fdef.maxFromField) {
    fieldValues[fdef.maxFromField] = engine.getField(subj.id, p.tracker, fdef.maxFromField);
  }
  return formatValue(value, fdef, fieldValues);
}

export function resolveListMacro(engine, path) {
  const p = parsePath(path);
  if (!p) return '';
  const subj = engine.resolveSubject(p.subject);
  if (!subj) return '';
  const fdef = engine.definitions.getField(p.tracker, p.field);
  if (!fdef) return '';
  if (fdef.type === 'pair-list') {
    const value = engine.getField(subj.id, p.tracker, p.field) ?? [];
    return value
      .filter(pair => pair?.name)
      .map(pair => pair.descriptor ? `- ${pair.name}: ${pair.descriptor}` : `- ${pair.name}`)
      .join('\n');
  }
  if (fdef.type !== 'list') return '';
  const value = engine.getField(subj.id, p.tracker, p.field) ?? [];
  if (p.suffix === 'desc') {
    return value.map(e => `- ${e}: ${engine.getDescription(subj.id, p.tracker, p.field, e) ?? ''}`).join('\n');
  }
  return value.map(e => `- ${e}`).join('\n');
}

export function resolveTagMacro(engine, arg) {
  const [tag, mode, text] = String(arg).split('::');
  const active = engine.isTagActive(tag);
  if (mode === 'on') return active ? (text ?? '') : '';
  if (mode === 'off') return active ? '' : (text ?? '');
  return active ? '1' : '';
}

/**
 * Register tracker macros with ST's macro system.
 *
 * Tries the new MacroRegistry API first (scripts/macros/macro-system.js) which
 * supports `::`-separated arguments. Falls back to the legacy MacrosParser API
 * for older ST versions — but note legacy doesn't support args, so the fallback
 * is only useful for argless built-ins (and our macros all take args).
 *
 * @param {TrackerEngine} engine
 * @param {{ macros?: object, MacrosParser?: object, proseStore?: object }} deps
 */
export function register(engine, deps) {
  const proseStore = deps?.proseStore ?? {};

  // Build the tracker handler — receives a single string argument (everything
  // after `::`, before any further `::` separators which become additional args).
  const trackerHandler = (innerArg) => {
    const inner = String(innerArg ?? '');
    if (!inner) return '';
    const parts = inner.split('.');
    if (parts.length === 3 && parts[2] === '_probe') return resolveProbe(engine, inner, proseStore) ?? '';
    if (parts.length === 2) return resolveTrackerBlock(engine, inner) ?? '';
    if (parts.length === 1) return resolveAllTrackers(engine, inner);
    return resolveMacro(engine, inner); // field-level (3+ parts)
  };

  const tagHandler = (tag, mode, text) => {
    const t = String(tag ?? '');
    if (!t) return '';
    const m = String(mode ?? '');
    const x = String(text ?? '');
    const arg = m ? (x ? `${t}::${m}::${x}` : `${t}::${m}`) : t;
    return resolveTagMacro(engine, arg);
  };

  // ── Try new MacroRegistry API (ST 1.13+) ──────────────────────────────────
  const registry = deps?.macros?.registry;
  if (registry?.registerMacro) {
    try {
      registry.registerMacro('tracker', {
        category: 'extras',
        unnamedArgs: [{ name: 'path', optional: false, type: 'string', description: '<subject>[.<tracker>[.<field>[.desc|raw|label|_probe]]]' }],
        description: 'State tracker: resolves a subject, tracker, or field path. {{tracker::Lyra}} = all trackers, {{tracker::Lyra.outfit}} = whole outfit block, {{tracker::Lyra.outfit.topwear}} = single value.',
        handler: (ctx) => trackerHandler(ctx.unnamedArgs[0]),
      });
      registry.registerMacro('tracker-list', {
        category: 'extras',
        unnamedArgs: [{ name: 'path', optional: false, type: 'string', description: '<subject>.<tracker>.<field>[.desc]' }],
        description: 'State tracker list rendering: bullet-list of a list-field, optionally with cached descriptions.',
        handler: (ctx) => resolveListMacro(engine, ctx.unnamedArgs[0]),
      });
      registry.registerMacro('tracker-tag', {
        category: 'extras',
        unnamedArgs: [
          { name: 'tag', optional: false, type: 'string' },
          { name: 'mode', optional: true, type: 'string', description: 'on|off — gate the text by tag state' },
          { name: 'text', optional: true, type: 'string', description: 'text to emit when mode condition matches' },
        ],
        description: 'Scene tag state: {{tracker-tag::sexual}} = "1"/"". {{tracker-tag::sexual::on::TEXT}} = TEXT if active.',
        handler: (ctx) => tagHandler(ctx.unnamedArgs[0], ctx.unnamedArgs[1], ctx.unnamedArgs[2]),
      });
      registry.registerMacro('world', {
        category: 'extras',
        unnamedArgs: [{ name: 'path', optional: false, type: 'string',
          description: 'name|id|bigpicture|recent|recent::N|chronicle' }],
        description: 'World macro: resolves world name, id, big picture, or chronicle entries.',
        handler: (ctx) => {
          const worldMeta = deps?.getWorldMeta?.() ?? null;
          const chronicle = deps?.getChronicle?.() ?? null;
          return resolveWorldMacro(ctx.unnamedArgs[0], worldMeta, chronicle);
        },
      });
      return;
    } catch (e) {
      console.warn('[state-referential] new MacroRegistry registration failed, falling back to legacy:', e?.message);
    }
  }

  // ── Fallback: legacy MacrosParser (no arg support, but harmless to register)
  if (deps?.MacrosParser?.registerMacro) {
    deps.MacrosParser.registerMacro('tracker', (...rawArgs) => trackerHandler(rawArgs.find(a => typeof a === 'string' && !a.startsWith('{{')) ?? ''));
    deps.MacrosParser.registerMacro('tracker-list', (...rawArgs) => resolveListMacro(engine, rawArgs.find(a => typeof a === 'string' && !a.startsWith('{{')) ?? ''));
    deps.MacrosParser.registerMacro('tracker-tag', (...rawArgs) => resolveTagMacro(engine, rawArgs.find(a => typeof a === 'string' && !a.startsWith('{{')) ?? ''));
    deps.MacrosParser.registerMacro('world', (...rawArgs) => {
      const worldMeta = deps?.getWorldMeta?.() ?? null;
      const chronicle = deps?.getChronicle?.() ?? null;
      return resolveWorldMacro(rawArgs.find(a => typeof a === 'string' && !a.startsWith('{{')) ?? '', worldMeta, chronicle);
    });
  }
}

/**
 * Resolve a {{world::*}} macro path.
 * @param {string} path - everything after "world::"
 * @param {object|null} worldMeta - current WorldMeta, or null if chat is unbound
 * @param {ChronicleStore|null} chronicle - current ChronicleStore, or null
 */
export function resolveWorldMacro(path, worldMeta, chronicle) {
  if (!worldMeta) return '';
  const key = String(path ?? '').trim();

  if (key === 'name')       return worldMeta.name ?? '';
  if (key === 'id')         return worldMeta.id ?? '';
  if (key === 'bigpicture') return chronicle?.getBigPicture() ?? '';

  if (key === 'recent') {
    const entries = chronicle?.listVerbatimEntries() ?? [];
    return entries.map(e => `${e.title}: ${e.body}`).join('\n');
  }

  if (key.startsWith('recent::')) {
    const n = parseInt(key.slice(8), 10);
    if (isNaN(n) || n <= 0) return '';
    const all = chronicle?.getEntries() ?? [];
    return all.slice(-n).map(e => `${e.title}: ${e.body}`).join('\n');
  }

  if (key === 'chronicle') {
    const bigPicture = chronicle?.getBigPicture() ?? '';
    const entries = chronicle?.listVerbatimEntries() ?? [];
    const lines = [];
    if (bigPicture) lines.push(`**Story so far (overall):** ${bigPicture}`);
    if (entries.length) {
      lines.push('**Recent acts:**');
      for (const e of entries) lines.push(`- ${e.title}: ${e.body}`);
    }
    return lines.join('\n');
  }

  return '';
}