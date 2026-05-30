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

  // ── World commands (Layer 2) ──────────────────────────────────────────────────
  // These are only functional when deps.worldRegistry and deps.worldBinding are wired.
  // They silently no-op when those deps are absent (graceful degradation to Layer 1).

  reg('world-list', (args, value) => {
    const reg = deps.worldRegistry;
    if (!reg) return 'World model not available.';
    const worlds = reg.list();
    if (!worlds.length) return '(no worlds)';
    return worlds.map(w => `${w.id.slice(0, 8)}… ${w.name}${w.mainlineChatId ? ' [has mainline]' : ''}`).join('\n');
  }, '/world-list — list all Worlds');

  reg('world-new', async (args, value) => {
    const name = String(value ?? '').trim();
    if (!name) return 'Usage: /world-new <name>';
    const reg = deps.worldRegistry;
    if (!reg) return 'World model not available.';
    const w = await reg.create({ name });
    toastr.success(`Created World "${w.name}"`, 'World Tracker');
    return `Created World "${w.name}" (${w.id})`;
  }, '/world-new <name> — create a new World');

  reg('world-bind', async (args, value) => {
    const worldId = String(value ?? '').trim();
    if (!worldId) return 'Usage: /world-bind <worldId>';
    const binder = deps.worldBinder;
    if (!binder) return 'World model not available.';
    await binder.bindCurrentChat(worldId);
    toastr.success(`Bound to World ${worldId}`, 'World Tracker');
    return `Bound current chat to World ${worldId}`;
  }, '/world-bind <worldId> — bind current chat to a World');

  reg('world-unbind', async (args, value) => {
    const binder = deps.worldBinder;
    if (!binder) return 'World model not available.';
    await binder.unbindCurrentChat();
    toastr.info('Chat unbound from World', 'World Tracker');
    return 'Chat unbound from World. Now using chat-scoped trackers.';
  }, '/world-unbind — unbind current chat from its World');

  reg('world-act-complete', async (args, value) => {
    const title = String(value ?? '').trim() || `Act (${new Date().toLocaleDateString()})`;
    const ops = deps.chronicleOps;
    if (!ops) return 'Chronicle not available (chat must be bound to a World).';
    const chronicle = deps.getChronicle?.();
    if (!chronicle) return 'Chronicle not loaded — is this chat bound to a World?';
    const messages = deps.getChat?.() ?? [];
    try {
      await ops.actComplete(title, { messages, msgId: deps.getCurrentMsgId?.() });
      await deps.persistChronicle?.();
      deps.chronicleInjection?.run?.();
      const msg = `Chronicle entry "${title}" appended. Total acts: ${chronicle.getEntries().length}`;
      toastr.success(msg, 'World Chronicle');
      return msg;
    } catch (e) {
      toastr.error(e.message, 'Act complete failed');
      return `Act complete failed: ${e.message}`;
    }
  }, '/world-act-complete [title] — mark act complete, generate chronicle entry');

  reg('world-act-status', (args, value) => {
    const ops = deps.chronicleOps;
    const chronicle = deps.getChronicle?.();
    if (!ops || !chronicle) return 'Chronicle not loaded — is this chat bound to a World?';
    const messages = deps.getChat?.() ?? [];
    const since = ops.countSinceLastAct(messages);
    const entries = chronicle.getEntries();
    const lastAct = entries[entries.length - 1];
    const cap = chronicle.getConfig().maxActMessages ?? 60;
    const lastLabel = lastAct ? `"${lastAct.title}"` : '(none yet)';
    const capNote = since > cap ? ` (only the most recent ${cap} would be summarized)` : '';
    return `${since} message(s) since last act ${lastLabel}. Next act would summarize them${capNote}. Total acts: ${entries.length}.`;
  }, '/world-act-status — show how many messages have passed since the last act');

  reg('world-act-insert', async (args, value) => {
    const chronicle = deps.getChronicle?.();
    if (!chronicle) return 'Chronicle not loaded — is this chat bound to a World?';
    const raw = String(value ?? '').trim();
    const pipeIdx = raw.indexOf('|');
    const title = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim();
    const body = (pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : '').trim();
    if (!title) return 'Usage: /world-act-insert <title> | <body>';
    chronicle.appendEntry(title, body, deps.getCurrentMsgId?.() ?? null);
    await deps.persistChronicle?.();
    deps.chronicleInjection?.run?.();
    const msg = `Act "${title}" inserted. Total acts: ${chronicle.getEntries().length}`;
    toastr.success(msg, 'World Chronicle');
    return msg;
  }, '/world-act-insert <title> | <body> — manually insert a chronicle act without AI');

  reg('world-bigpicture', async (args, value) => {
    const sub = String(value ?? '').trim();
    const chronicle = deps.getChronicle?.();
    if (!chronicle) return 'Chronicle not available.';
    if (sub === 'show') return chronicle.getBigPicture() || '(empty)';
    if (sub === 'refresh') {
      const ops = deps.chronicleOps;
      if (!ops) return 'ChronicleOps not available.';
      await ops._regenerateAllBigPicture(chronicle.getConfig().bigPictureTokenCap);
      await deps.persistChronicle?.();
      deps.chronicleInjection?.run?.();
      return 'Big picture regenerated.';
    }
    return 'Usage: /world-bigpicture show|refresh';
  }, '/world-bigpicture show|refresh');

  reg('world-export', async (args, value) => {
    const worldId = String(value ?? '').trim() || deps.worldBinding?.currentWorldId;
    if (!worldId) return 'No world bound and no worldId given.';
    const api = deps.serverApi;
    if (!api) return 'Server API not available.';
    try {
      const blob = await api.exportWorld(worldId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `world-${worldId}.json`; a.click();
      URL.revokeObjectURL(url);
      return 'Export started.';
    } catch (e) { return `Export failed: ${e.message}`; }
  }, '/world-export [worldId] — export current (or given) World as JSON file');

  reg('world-import', async () => {
    const j = deps.dialogs
      ? await deps.dialogs.prompt('Paste world export JSON:')
      : prompt('Paste world export JSON:');
    if (!j) return '';
    try {
      const bundle = JSON.parse(j);
      const api = deps.serverApi;
      if (!api) return 'Server API not available.';
      const newWorld = await deps.serverApi.importWorld(bundle);
      deps.worldRegistry?.init?.(); // refresh in-memory list
      return `Imported World "${newWorld.name}" as ${newWorld.id}`;
    } catch (e) { return `Import failed: ${e.message}`; }
  }, '/world-import — paste a world export JSON and import it as a new World');

  reg('world-subject', async (args, value) => {
    const parts = tokenize(String(value ?? ''));
    const op = parts.shift();
    if (op === 'promote') {
      engine.setProtagonist(parts[0]);
      return `Promoted ${parts[0]} to protagonist.`;
    }
    return 'Usage: /world-subject promote <name>';
  }, '/world-subject promote <name> — promote a World subject to protagonist');
}