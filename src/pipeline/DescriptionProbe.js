const DEFAULT_TEMPLATE = `Describe {{label}} = "{{value}}" for {{subjectName}}.
1-2 sentences, sensory and concrete. No dialogue.
{{#if subjectHasTraits}}
{{subjectName}}'s traits:
  height: {{traits.height}}
  build:  {{traits.build}}
  hair:   {{traits.hair}}
  eyes:   {{traits.eyes}}
{{/if}}`;

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
    this.template = deps.template ?? DEFAULT_TEMPLATE;
    this._queue = [];
    this._running = false;
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
    this.engine.setDescription(subjectId, trackerId, fieldId, value, text);
    this.engine.bus.emit('tracker:probe-completed', { subject: subjectId, tracker: trackerId, field: fieldId, prose: text });
  }
}
