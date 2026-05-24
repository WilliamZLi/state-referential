export function register(engine, deps) {
  // deps: { versioning, descProbe, getSettings, panel, injection }
  deps.versioning.register();

  // Bridge: every value-changed enqueues a description-probe job.
  engine.on('tracker:value-changed', (e) => {
    const s = deps.getSettings();
    if (s.probeDesc === false) return;
    deps.descProbe.enqueue([{
      subjectId: e.subject, trackerId: e.tracker, fieldId: e.field, value: e.newValue,
    }]);
  });

  // Re-run injection whenever scene tags toggle (so tag-gated fields appear immediately).
  engine.on('tracker:tag-changed', () => deps.injection.run());

  // First-run: if no subjects and definitions installed AND user hasn't dismissed
  // the first-run prompt yet, prompt for protagonist. Otherwise stay silent —
  // backend-changed fires on every CHAT_CHANGED now, so we must not auto-pop.
  engine.on('tracker:backend-changed', () => {
    const s = deps.getSettings();
    if (s?.firstRunComplete) return;
    if (!engine.listSubjects().length && engine.listTrackers().length) {
      deps.panel?.deps?.openSubjectAddModal?.({ forceProtagonist: true });
    }
  });
}