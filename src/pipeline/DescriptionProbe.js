export const DEFAULT_PROBE_TEMPLATE = `Describe {{label}} "{{value}}" in ONE short clause (under 15 words) that adds detail beyond the name itself. Stay generic: no pronouns, no specific person or scene. Don't restate the category.

Examples:
- topwear "tank top" → white ribbed cotton with a scooped neckline
- bottomwear "miniskirt" → black denim, frayed hem, mid-thigh
- weapon "longsword" → straight steel blade, leather-wrapped hilt
- mood "happy" → bright, light energy with frequent smiles
- mood "curious" → attentive, open-eyed interest with a hint of mischief
- status "poisoned" → pallid skin, cold sweat, weakened movements

{{label}} "{{value}}":`;

export const DETAILED_PROBE_TEMPLATE = `Describe what {{label}} "{{value}}" is for {{subjectName}}, using the context below. Capture its nature and any concrete properties — effects, stat / sensitivity / base changes, and per-turn rules with EXACT numbers (e.g. "+5/turn") if it has them. This text is read by the state-tracker each turn to re-apply effects, so be specific and mechanical, not flowery. No preamble.

Recent user input: {{lastInput}}
Recent narration: {{lastReply}}

{{label}} "{{value}}":`;

const PROBE_PROFILES = { detailed: DETAILED_PROBE_TEMPLATE };

function renderTemplate(tpl, ctx) {
  let out = tpl.replace(/\{\{#if subjectHasTraits\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, inner) =>
    ctx.subjectHasTraits ? inner : '');
  return out.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const parts = path.split('.');
    let v = ctx;
    for (const p of parts) v = v?.[p];
    return v == null ? '' : String(v);
  });
}

export class DescriptionProbe {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this.template = (deps.template ?? '').trim() || DEFAULT_PROBE_TEMPLATE;
    this._queue = [];
    this._running = false;
    this._inFlight = new Set(); // tokens like "subjId|trackerId|fieldId|value"
  }

  static _token(subjectId, trackerId, fieldId, value) {
    return `${subjectId}|${trackerId}|${fieldId}|${value}`;
  }

  /** True if a probe is enqueued or actively running for this field+value. */
  isProbing(subjectId, trackerId, fieldId, value) {
    const token = DescriptionProbe._token(subjectId, trackerId, fieldId, value);
    if (this._inFlight.has(token)) return true;
    // Also count queued (not yet started) jobs as in-progress
    return this._queue.some(j =>
      j.subjectId === subjectId &&
      j.trackerId === trackerId &&
      j.fieldId === fieldId &&
      j.value === value
    );
  }

  /** Replace the active template at runtime. Pass empty/null to revert to default. */
  setTemplate(tpl) {
    this.template = (tpl ?? '').trim() || DEFAULT_PROBE_TEMPLATE;
  }

  enqueue(items) {
    for (const it of items) {
      // Dedup: skip if an identical job is already queued or in-flight.
      // Prevents queue bloat when value-changed events fire repeatedly for the same field+value
      // (e.g. user edits → AI auto-update sets same → user edits → ...).
      const token = DescriptionProbe._token(it.subjectId, it.trackerId, it.fieldId, it.value);
      if (this._inFlight.has(token)) continue;
      const dup = this._queue.some(j =>
        j.subjectId === it.subjectId &&
        j.trackerId === it.trackerId &&
        j.fieldId === it.fieldId &&
        j.value === it.value
      );
      if (dup) continue;
      this._queue.push(it);
    }
  }

  async drain() {
    if (this._running) return;
    this._running = true;
    try {
      while (this._queue.length) {
        const job = this._queue.shift();
        await this._runOne(job);
      }
    } finally {
      this._running = false;
    }
  }

  async _runOne({ subjectId, trackerId, fieldId, value }) {
    const field = this.engine.definitions.getField(trackerId, fieldId);
    if (!field || !field.describable) return;
    // pair-list carries its descriptor inline — never probe.
    if (field.type === 'pair-list') return;
    if (value === '' || value == null) return;
    if (Array.isArray(value)) {
      // list — probe each entry separately
      for (const entry of value) await this._runOne({ subjectId, trackerId, fieldId, value: entry });
      return;
    }
    const existing = this.engine.getDescription(subjectId, trackerId, fieldId, value);
    if (existing != null && existing !== '') return;
    const subj = this.engine.subjects.get(subjectId);
    if (!subj) return;

    const token = DescriptionProbe._token(subjectId, trackerId, fieldId, value);
    this._inFlight.add(token);
    this.engine.bus.emit('tracker:probe-started', { subject: subjectId, tracker: trackerId, field: fieldId, value });
    const traits = subj.traits ?? {};
    const probeCtx = this.deps.getProbeContext?.() ?? {};
    const ctx = {
      label: field.label,
      value,
      subjectName: subj.name,
      subjectHasTraits: Object.keys(traits).length > 0,
      traits,
      lastInput: probeCtx.lastInput ?? '',
      lastReply: probeCtx.lastReply ?? '',
    };
    const tpl = PROBE_PROFILES[field.probeProfile] ?? this.template;
    const prompt = renderTemplate(tpl, ctx);
    let text;
    try {
      const prose = await this.deps.generateQuietPrompt(prompt);
      text = (prose ?? '').trim();
    } finally {
      // Always clear the in-flight marker, even if generation threw.
      this._inFlight.delete(token);
      this.engine.bus.emit('tracker:probe-completed', { subject: subjectId, tracker: trackerId, field: fieldId, prose: text ?? '' });
    }
    if (!text) return;
    // Re-check the cache before writing — a user edit (via the pencil modal)
    // could have populated the description while our generateQuietPrompt was awaiting.
    // Don't clobber a user write.
    const writtenDuring = this.engine.getDescription(subjectId, trackerId, fieldId, value);
    if (writtenDuring != null && writtenDuring !== '') return;
    this.engine.setDescription(subjectId, trackerId, fieldId, value, text);
  }
}
