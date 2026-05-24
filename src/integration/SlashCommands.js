function parseFieldPath(arg) {
  // "outfit.topwear" → { tracker, field }
  const [tracker, field] = String(arg ?? '').split('.');
  return { tracker, field };
}

/**
 * Tokenize a command string respecting double-quoted phrases.
 * "Lyra outfit.topwear \"red silk dress\"" → ["Lyra", "outfit.topwear", "red silk dress"]
 */
function tokenize(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str ?? '')) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
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
    const [subj, path, val] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (!s) return '';
    engine.setField(s.id, tracker, field, val ?? '', { source: 'slash' });
    return '';
  });

  reg('tracker-get', (args, value) => {
    const [subj, path] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    return s ? String(engine.getField(s.id, tracker, field) ?? '') : '';
  });

  reg('tracker-delta', (args, value) => {
    const [subj, path, n] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.applyDelta(s.id, tracker, field, Number(n), { source: 'slash' });
    return '';
  });

  reg('tracker-add', (args, value) => {
    const [subj, path, entry] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.addListEntry(s.id, tracker, field, entry ?? '', { source: 'slash' });
    return '';
  });

  reg('tracker-remove', (args, value) => {
    const [subj, path, entry] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) engine.removeListEntry(s.id, tracker, field, entry ?? '', { source: 'slash' });
    return '';
  });

  reg('tracker-tag', (args, value) => {
    const [tag, op] = tokenize(String(value ?? ''));
    if (op === 'on') engine.setSceneTag(tag, true);
    else if (op === 'off') engine.setSceneTag(tag, false);
    else engine.toggleSceneTag(tag);
    return '';
  });

  reg('tracker-include', (args, value) => {
    const [subj, path] = tokenize(String(value ?? ''));
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
    const [subj, path] = tokenize(String(value ?? ''));
    const { tracker, field } = parseFieldPath(path);
    const s = engine.resolveSubject(subj);
    if (s) {
      const v = engine.getField(s.id, tracker, field);
      engine.invalidateDescription(s.id, tracker, field, v);
    }
    return '';
  });

  reg('tracker-subject', (args, value) => {
    const parts = tokenize(String(value ?? ''));
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

  reg('tracker-import', async () => {
    const j = deps.dialogs
      ? await deps.dialogs.prompt('Paste tracker JSON:')
      : prompt('Paste tracker JSON:');
    if (!j) return '';
    try {
      const d = JSON.parse(j);
      if (engine.getTracker(d.id)) engine.updateTracker(d.id, d); else engine.defineTracker(d);
    } catch (e) { console.error(e); }
    return '';
  });

  reg('tracker-snapshot', (args, value) => {
    const [op, ...rest] = tokenize(String(value ?? ''));
    const label = rest.join(' ').trim() || 'default';
    // Use extension_settings for labeled snapshot storage
    const es = (deps.getExtensionSettings?.() ?? window.extension_settings ?? {});
    es['state-referential'] ??= {};
    es['state-referential'].labeledSnapshots ??= {};
    const store = es['state-referential'].labeledSnapshots;
    if (op === 'save') {
      store[label] = engine.snapshot();
      deps.saveSettingsDebounced?.();
      return `Saved snapshot: ${label}`;
    }
    if (op === 'restore') {
      if (!store[label]) return `No snapshot named: ${label}`;
      engine.restoreSnapshot(store[label]);
      return `Restored snapshot: ${label}`;
    }
    if (op === 'list') {
      return Object.keys(store).join(', ') || '(no saved snapshots)';
    }
    if (op === 'delete') {
      delete store[label];
      deps.saveSettingsDebounced?.();
      return `Deleted snapshot: ${label}`;
    }
    return 'Usage: /tracker-snapshot save|restore|list|delete [label]';
  }, '/tracker-snapshot save|restore|list|delete [label]');
}