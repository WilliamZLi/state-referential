function parsePath(path) {
  // <subject>.<tracker>.<field>[.suffix]
  const parts = String(path).split('.');
  if (parts.length < 3) return null;
  return { subject: parts[0], tracker: parts[1], field: parts[2], suffix: parts.slice(3).join('.') };
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
  deps.MacrosParser.registerMacro('tracker', (env, ...args) => {
    const inner = args.join('::');
    return resolveMacro(engine, inner);
  });
  deps.MacrosParser.registerMacro('tracker-list', (env, ...args) => resolveListMacro(engine, args.join('::')));
  deps.MacrosParser.registerMacro('tracker-tag', (env, ...args) => resolveTagMacro(engine, args.join('::')));
}