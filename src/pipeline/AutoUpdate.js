const DEFAULT_ACTIVE_WINDOW = 5;

function formatValue(field, value) {
  if (value === undefined || value === null) return field.type === 'list' ? '[]' : (field.type === 'number' ? '0' : '""');
  if (field.type === 'list') return JSON.stringify(value);
  if (field.type === 'number') return String(value);
  return JSON.stringify(String(value));
}

function fieldTypeAnnotation(field) {
  if (field.type === 'number') return `number, ${field.min ?? 0}-${field.max ?? 100}`;
  if (field.type === 'enum') return `enum: ${field.options.join('|')}`;
  return field.type;
}

export class AutoUpdate {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { generateQuietPrompt(text)->Promise<string>, getCurrentMsgId()->string|null, getMsgIndex(id)->number|null }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._oneShot = new Set(); // "subjId|tracker|field" tokens
  }

  includeOnce(subjectId, trackerId, fieldId) {
    this._oneShot.add(`${subjectId}|${trackerId}|${fieldId}`);
  }

  _passesInclusion(field, subjectId, trackerId) {
    const token = `${subjectId}|${trackerId}|${field.id}`;
    if (this._oneShot.has(token)) return true;
    const rule = field.inclusion?.rule ?? 'always';
    if (rule === 'always') return true;
    if (rule === 'manual') return false;
    if (rule === 'tag') return this.engine.tags.anyActive(field.inclusion?.tags ?? []);
    if (rule === 'active') {
      const stored = this.engine.values.getStored(subjectId, trackerId, field.id);
      if (!stored?.lastTouchedMsg) return false;
      const curId = this.deps.getCurrentMsgId?.();
      const curIdx = curId ? this.deps.getMsgIndex?.(curId) : null;
      const lastIdx = this.deps.getMsgIndex?.(stored.lastTouchedMsg);
      const window = field.inclusion?.activeWindow ?? DEFAULT_ACTIVE_WINDOW;
      if (curIdx == null || lastIdx == null) return false;
      return (curIdx - lastIdx) <= window;
    }
    return false;
  }

  buildPrompt({ lastNarratorReply }) {
    const subjects = this.engine.listSubjects();
    const blocks = [];
    for (const subj of subjects) {
      const trackers = this.engine.definitions.forRole(subj.role).filter(d => d.autoUpdate !== false);
      const lines = [];
      for (const t of trackers) {
        for (const f of t.fields) {
          if (!this._passesInclusion(f, subj.id, t.id)) continue;
          const val = this.engine.values.getField(subj.id, t.id, f.id) ?? f.default;
          lines.push(`  ${t.id}.${f.id} (${fieldTypeAnnotation(f)}) = ${formatValue(f, val)}`);
        }
      }
      if (lines.length) {
        blocks.push(`${subj.name} (${subj.role}):\n${lines.join('\n')}`);
      }
    }
    // consume one-shots
    this._oneShot.clear();

    return [
      'You are a state tracker. Based on the LAST narrator reply only, identify any',
      'changes to the tracked entities below. Emit one command per line. If nothing',
      'changed, reply exactly: NONE',
      '',
      '# Tracked entities',
      '',
      blocks.join('\n\n'),
      '',
      '# Commands',
      '',
      'SET <subject> <tracker>.<field> = "<value>"',
      'DELTA <subject> <tracker>.<field> <±N>',
      'ADD <subject> <tracker>.<field> "<entry>"',
      'REMOVE <subject> <tracker>.<field> "<entry>"',
      'NEW_SUBJECT <name> <role>',
      'NONE',
      '',
      'Use ONLY commands shown. Subject names must match exactly. Output nothing else.',
      '',
      '# Last narrator reply',
      '',
      lastNarratorReply ?? '',
    ].join('\n');
  }

  async run({ lastNarratorReply, msgId }) {
    const prompt = this.buildPrompt({ lastNarratorReply });
    const response = await this.deps.generateQuietPrompt(prompt);
    return this.engine.applyCommands(response ?? '', { source: 'auto-update', msgId });
  }
}