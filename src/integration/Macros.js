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
    fieldValues[f.id] = engine.getField(subj.id, tracker.id, f.id) ?? f.default;
  }

  if (tpl) {
    // Expand template placeholders: {{subject}}, {{fields}}, {{fieldId}}, {{fieldId.desc}}, {{fieldId.label}}
    const fieldMap = new Map(tracker.fields.map(f => [f.id, f]));
    const fieldsBlock = tracker.fields
      .filter(f => {
        const v = fieldValues[f.id];
        return v !== null && v !== undefined && String(v) !== '';
      })
      .map(f => {
        const v = fieldValues[f.id];
        const formatted = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        return `**${f.label}:** ${formatted}`;
      })
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
      const v = fieldValues[key];
      return Array.isArray(v) ? v.join(', ') : String(v ?? '');
    });
  }

  // Auto-block: "**Label:** value" lines
  const lines = tracker.fields
    .filter(f => {
      const v = fieldValues[f.id];
      return v !== null && v !== undefined && String(v) !== '' && !(Array.isArray(v) && v.length === 0);
    })
    .map(f => {
      const v = fieldValues[f.id];
      const formatted = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      return `**${f.label}:** ${formatted}`;
    });
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
 * Resolve {{tracker::<subject>}} — all trackers for subject, concatenated.
 */
export function resolveAllTrackers(engine, subjectAlias) {
  const subj = engine.resolveSubject(subjectAlias);
  if (!subj) return '';
  const trackers = engine.definitions.forRole(subj.role);
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
  // default render
  if (fdef.type === 'list') return (value ?? []).join(', ');
  return String(value ?? '');
}

export function resolveListMacro(engine, path) {
  const p = parsePath(path);
  if (!p) return '';
  const subj = engine.resolveSubject(p.subject);
  if (!subj) return '';
  const fdef = engine.definitions.getField(p.tracker, p.field);
  if (!fdef || fdef.type !== 'list') return '';
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

export function register(engine, deps) {
  if (!deps?.MacrosParser?.registerMacro) return;
  const proseStore = deps.proseStore ?? {};

  // ST's MacrosParser.registerMacro passes the captured `::`-separated args
  // as positional string args directly (NO leading env/context object in modern
  // ST versions). For {{tracker::Lyra}}, the fn is called as fn("Lyra").
  // For {{tracker::Lyra.outfit.topwear}}, fn("Lyra.outfit.topwear").
  // Older ST versions sometimes did pass an env first; we handle both shapes.
  const extractArgs = (rawArgs) => {
    // If first arg is a non-string object, assume legacy env-first signature.
    if (rawArgs.length > 0 && typeof rawArgs[0] !== 'string') return rawArgs.slice(1);
    return rawArgs;
  };

  deps.MacrosParser.registerMacro('tracker', (...rawArgs) => {
    const args = extractArgs(rawArgs);
    const inner = args.join('::');
    const parts = String(inner).split('.');

    // 3-part with ._probe suffix: <subject>.<tracker>._probe
    if (parts.length === 3 && parts[2] === '_probe') {
      return resolveProbe(engine, inner, proseStore) ?? '';
    }

    // 2-part: <subject>.<tracker> — whole tracker block
    if (parts.length === 2) {
      return resolveTrackerBlock(engine, inner) ?? '';
    }

    // 1-part: <subject> — all trackers for subject
    if (parts.length === 1 && inner) {
      return resolveAllTrackers(engine, inner);
    }

    // 3+ parts (field-level): delegate to existing resolveMacro
    return resolveMacro(engine, inner);
  });
  deps.MacrosParser.registerMacro('tracker-list', (...rawArgs) => resolveListMacro(engine, extractArgs(rawArgs).join('::')));
  deps.MacrosParser.registerMacro('tracker-tag', (...rawArgs) => resolveTagMacro(engine, extractArgs(rawArgs).join('::')));
}