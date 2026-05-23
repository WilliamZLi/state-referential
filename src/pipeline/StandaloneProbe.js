function renderPrompt(tpl, subject) {
  return String(tpl ?? '').replace(/\{\{subject\}\}/g, subject?.name ?? '');
}

export class StandaloneProbe {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { generateQuietPrompt, insertSmallSysMessage(opts), proseStore }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
  }

  async run({ changedTrackerIds, subject }) {
    const all = this.engine.listTrackers();
    for (const t of all) {
      if (!t.probe?.enabled) continue;
      const trigger = t.probe.trigger ?? 'on-change';
      const should =
        (trigger === 'every-turn') ||
        (trigger === 'on-change' && changedTrackerIds.has(t.id));
      if (!should) continue;
      await this._runProbe(t, subject);
    }
  }

  async runOne(trackerId, subject) {
    const t = this.engine.getTracker(trackerId);
    if (!t?.probe?.enabled) return;
    await this._runProbe(t, subject);
  }

  async _runProbe(t, subject) {
    const prompt = renderPrompt(t.probe.prompt, subject);
    const result = (await this.deps.generateQuietPrompt(prompt) ?? '').trim();
    if (!result) return;
    const insertAs = t.probe.insertAs ?? 'small-sys-message';
    if (insertAs === 'small-sys-message') {
      this.deps.insertSmallSysMessage?.({
        name: t.label,
        mes: result,
        extra: {
          isSmallSys: true,
          from: 'state-referential',
          exclusive: !!t.probe.exclusive,
          collapsed: !!t.probe.collapsed,
          probeKey: `probe:${t.id}:${subject?.id ?? ''}`,
        },
      });
    } else {
      if (!this.deps.proseStore[t.id]) this.deps.proseStore[t.id] = {};
      this.deps.proseStore[t.id][subject?.id ?? '_'] = result;
    }
  }
}