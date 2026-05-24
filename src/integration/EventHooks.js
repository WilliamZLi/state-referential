export function register(engine, deps) {
  // deps: { versioning, descProbe, getSettings, panel, injection }
  deps.versioning.register();

  // Bridge: value-changed events that came from the AI (or slash commands)
  // enqueue a description probe. Manual UI edits do NOT auto-probe — clicking
  // through dropdown options to browse them shouldn't waste a generate call per
  // option. Users can press ⟳ to explicitly probe a manual value.
  engine.on('tracker:value-changed', (e) => {
    const s = deps.getSettings();
    if (s.probeDesc === false) return;
    if (e.source === 'manual') return;
    deps.descProbe.enqueue([{
      subjectId: e.subject, trackerId: e.tracker, fieldId: e.field, value: e.newValue,
    }]);
  });

  // Refresh injection on every value change (so manual edits, slash commands, and
  // auto-update all keep the extension-prompt slot in sync). Cheap: just rebuilds
  // the stored extension prompt for affected trackers.
  engine.on('tracker:value-changed', () => deps.injection?.run?.());

  // Re-run injection whenever scene tags toggle (so tag-gated fields appear immediately).
  engine.on('tracker:tag-changed', () => deps.injection.run());

  // First-run: only pop the protagonist modal when there's an actual chat loaded
  // AND no subjects yet AND user hasn't dismissed the prompt before.
  // backend-changed fires on every CHAT_CHANGED so most invocations should bail.
  engine.on('tracker:backend-changed', () => {
    const s = deps.getSettings();
    if (s?.firstRunComplete) return;
    if (!deps.hasActiveChat?.()) return;
    if (!engine.listSubjects().length && engine.listTrackers().length) {
      deps.panel?.deps?.openSubjectAddModal?.({ forceProtagonist: true });
    }
  });
}