import { debounce } from '../util/debounce.js';

export function register(engine, deps) {
  // deps: { versioning, descProbe, getSettings, panel, injection }
  deps.versioning.register();

  // Debounced injection refresh — rapid value edits collapse into one run().
  const refreshInjection = debounce(() => deps.injection?.run?.(), 50);

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

  // Refresh injection on every value change (debounced so mass-edits collapse).
  engine.on('tracker:value-changed', () => refreshInjection());

  // Re-run injection whenever scene tags toggle (immediate, no debounce — tag
  // toggle is a deliberate user action, want instant response).
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