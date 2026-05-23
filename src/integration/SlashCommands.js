function parseFieldPath(arg) {
  // "outfit.topwear" → { tracker, field }
  const [tracker, field] = String(arg ?? '').split('.');
  return { tracker, field };
}

export function register(engine, deps) {
  // deps: { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE, panel, autoUpdate, injection, standalone }
  const reg = (name, fn, help) => deps.SlashCommandParser.addCommandObject(deps.SlashCommand.fromProps({
    name,
    callback: fn,
    helpString: help ?? '',
    returns: 'string',
  }));

  reg('tracker-panel', (args, value) => {
    const v = String(value ?? '').trim() || 'toggle';
    if (v === 'show') deps.panel.show(); else if (v === 'hide') deps.panel.hide(); else deps.panel.toggle();
    return '';
  }, '/tracker-panel toggle|show|hide');

  reg('tracker-set', (args, value) => {
    const [subj, path, ...val] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (!s) return '';
    engine.setField(s.id, tracker, field, val.join(' ').replace(/^"|"$/g, ''), { source: 'slash' });
    return '';
  });

  reg('tracker-get', (args, value) => {
    const [subj, path] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    return s ? String(engine.getField(s.id, tracker, field) ?? '') : '';
  });

  reg('tracker-delta', (args, value) => {
    const [subj, path, n] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.applyDelta(s.id, tracker, field, Number(n), { source: 'slash' });
    return '';
  });

  reg('tracker-add', (args, value) => {
    const [subj, path, ...entry] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.addListEntry(s.id, tracker, field, entry.join(' ').replace(/^"|"$/g, ''), { source: 'slash' });
    return '';
  });

  reg('tracker-remove', (args, value) => {
    const [subj, path, ...entry] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.removeListEntry(s.id, tracker, field, entry.join(' ').replace(/^"|"$/g, ''), { source: 'slash' });
    return '';
  });

  reg('tracker-tag', (args, value) => {
    const [tag, op] = String(value ?? '').split(/\s+/);
    if (op === 'on') engine.setSceneTag(tag, true);
    else if (op === 'off') engine.setSceneTag(tag, false);
    else engine.toggleSceneTag(tag);
    return '';
  });

  reg('tracker-include', (args, value) => {
    const [subj, path] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) { deps.autoUpdate.includeOnce(s.id, tracker, field); deps.injection.includeOnce(s.id, tracker, field); }
    return '';
  });

  reg('tracker-probe', (args, value) => {
    const id = String(value ?? '').trim();
    deps.standalone.runOne(id, engine.protagonist());
    return '';
  });

  reg('tracker-refresh-desc', (args, value) => {
    const [subj, path] = String(value ?? '').split(/\s+/);
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) {
      const v = engine.getField(s.id, tracker, field);
      engine.invalidateDescription(s.id, tracker, field, v);
    }
    return '';
  });

  reg('tracker-subject', (args, value) => {
    const parts = String(value ?? '').split(/\s+/);
    const op = parts.shift();
    if (op === 'add') engine.addSubject(parts[0], { role: parts[1] ?? 'npc' });
    else if (op === 'remove') engine.removeSubject(parts[0]);
    else if (op === 'rename') engine.renameSubject(parts[0], parts[1]);
    else if (op === 'promote') engine.setProtagonist(parts[0]);
    return '';
  });

  reg('tracker-export', (args, value) => {
    const d = engine.getTracker(String(value ?? '').trim());
    return d ? JSON.stringify(d, null, 2) : '';
  });

  reg('tracker-import', () => {
    const j = prompt('Paste tracker JSON:');
    if (!j) return '';
    try {
      const d = JSON.parse(j);
      if (engine.getTracker(d.id)) engine.updateTracker(d.id, d); else engine.defineTracker(d);
    } catch (e) { console.error(e); }
    return '';
  });

  reg('tracker-snapshot', (args, value) => {
    const [op, label] = String(value ?? '').split(/\s+/);
    if (op === 'save') engine.saveSnapshot(label);
    else if (op === 'restore') {
      const snap = engine.loadSnapshot(label);
      if (snap) engine.restoreSnapshot(snap);
    }
    return '';
  });
}