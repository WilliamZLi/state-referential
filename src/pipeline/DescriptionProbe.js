export const DEFAULT_PROBE_TEMPLATE = `For a {{label}} described as "{{value}}", give a SHORT visual specification — color, material, cut, fit, distinguishing features — beyond what the name alone implies.

Strict rules:
- ONE clause, ideally under 15 words. NO period at the end.
- DO NOT define the category (don't tell us "a tank top is a sleeveless shirt"). DO add specifics the name leaves open: color, fabric, length, hem detail, neckline, decoration, condition.
- NO scene-setting. NO mention of who is wearing/holding/feeling it (no "her", "she", "his"). NO dialogue. NO pose or expression.

Examples of GOOD output:
- topwear "tank top" → white ribbed cotton with a scooped neckline
- bottomwear "miniskirt" → black denim, frayed hem, mid-thigh
- topunderwear "bra" → unwired beige cotton with thin straps
- weapon "longsword" → straight steel blade, leather-wrapped hilt, slight nick near tip
- mood "curious" → bright, attentive interest with a hint of mischief
- status "stunned" → brief disorientation, slowed reactions

Examples of BAD output (do NOT do this):
- "A sleeveless, collarless top with wide arm openings" (dictionary definition; tells us nothing new)
- "It hugs her curves" (uses the subject; not state-agnostic)
- "A garment worn on the torso" (category restatement)

Now produce ONE such clause for: {{label}} "{{value}}".
Output the clause only, nothing else.`;

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
  }

  /** Replace the active template at runtime. Pass empty/null to revert to default. */
  setTemplate(tpl) {
    this.template = (tpl ?? '').trim() || DEFAULT_PROBE_TEMPLATE;
  }

  enqueue(items) {
    for (const it of items) this._queue.push(it);
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
    const traits = subj.traits ?? {};
    const ctx = {
      label: field.label,
      value,
      subjectName: subj.name,
      subjectHasTraits: Object.keys(traits).length > 0,
      traits,
    };
    const prompt = renderTemplate(this.template, ctx);
    const prose = await this.deps.generateQuietPrompt(prompt);
    const text = (prose ?? '').trim();
    if (!text) return;
    // Re-check the cache before writing — a user edit (via the pencil modal)
    // could have populated the description while our generateQuietPrompt was awaiting.
    // Don't clobber a user write.
    const writtenDuring = this.engine.getDescription(subjectId, trackerId, fieldId, value);
    if (writtenDuring != null && writtenDuring !== '') return;
    this.engine.setDescription(subjectId, trackerId, fieldId, value, text);
    this.engine.bus.emit('tracker:probe-completed', { subject: subjectId, tracker: trackerId, field: fieldId, prose: text });
  }
}
