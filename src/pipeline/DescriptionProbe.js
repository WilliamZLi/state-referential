export const DEFAULT_PROBE_TEMPLATE = `Describe {{label}} "{{value}}" in ONE short clause (under 15 words) that adds detail beyond the name itself. Stay generic: no pronouns, no specific person or scene. Don't restate the category.

Examples:
- topwear "tank top" → white ribbed cotton with a scooped neckline
- bottomwear "miniskirt" → black denim, frayed hem, mid-thigh
- weapon "longsword" → straight steel blade, leather-wrapped hilt
- mood "happy" → bright, light energy with frequent smiles
- mood "curious" → attentive, open-eyed interest with a hint of mischief
- status "poisoned" → pallid skin, cold sweat, weakened movements

{{label}} "{{value}}":`;

export const DETAILED_PROBE_TEMPLATE = `Describe what {{label}} "{{value}}" is for {{subjectName}}, using the context below. Describe ONLY this element.

- If it is a worn or held item: in 1-2 sentences (about 40 words), describe ONLY its physical nature — appearance, material, cut, coverage, and how it currently fits / sits on the body. Be concise: pick the most distinctive details rather than cataloguing everything. Do NOT give it stat numbers or mechanical effects.
- If it is a condition, status, or effect: describe its mechanical effects, stat / sensitivity / base changes, and per-turn rules, with EXACT numbers (e.g. "+5/turn").

Include a mechanical effect ONLY when the context explicitly attributes it to THIS element — never invent, infer, or estimate one. Do NOT mention set membership, sets, curses, or other separately-tracked entries, do NOT restate effects recorded elsewhere, and do NOT speculate about how separately-tracked changes will alter this element over time.

This text is read by the state-tracker each turn, so be specific and factual, not flowery. No preamble.

Recent user input: {{lastInput}}
Recent narration: {{lastReply}}

{{label}} "{{value}}":`;

const PROBE_PROFILES = { detailed: DETAILED_PROBE_TEMPLATE };

// Prepended to the chosen profile template when a probe job carries a prior
// description (from a RENAME). The final line keeps the main template's
// format/length/scoping rules in force so the prior text can't bloat the output.
const PRIOR_CONTEXT_PREFIX = `This is a state change of an existing {{label}}. It was previously "{{priorValue}}", described as:
{{priorDescription}}

Keep the enduring, unchanged details consistent with the above and reflect ONLY what changed in the new state. Produce the new description in the same form and length instructed below.

`;

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

  async _runOne({ subjectId, trackerId, fieldId, value, profile, priorValue, priorDescription }) {
    const field = this.engine.definitions.getField(trackerId, fieldId);
    if (!field || !field.describable) return;
    // pair-list carries its descriptor inline — never probe.
    if (field.type === 'pair-list') return;
    if (value === '' || value == null) return;
    if (Array.isArray(value)) {
      // Prior context describes the evolution of ONE entry, so it can't apply to a
      // whole-array probe — a single prior description can't map onto N entries. A
      // job should never combine the two; surface it loudly and drop the prior
      // context (not via throw — that would abort the whole drain queue).
      if (priorValue != null || priorDescription != null) {
        console.warn('[state-referential] DescriptionProbe: prior context was enqueued with an array value; ignoring it. Enqueue one entry per RENAME.');
      }
      // list — probe each entry separately (no prior context on a multi-entry job)
      for (const entry of value) await this._runOne({ subjectId, trackerId, fieldId, value: entry, profile });
      return;
    }
    // If the value already has a cached description (e.g. a RENAME to a value that
    // was described earlier), reuse it rather than regenerating with prior context.
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
      priorValue: priorValue ?? '',
      priorDescription: priorDescription ?? '',
    };
    let tpl = PROBE_PROFILES[profile ?? field.probeProfile] ?? this.template;
    if (priorDescription) tpl = PRIOR_CONTEXT_PREFIX + tpl;
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
