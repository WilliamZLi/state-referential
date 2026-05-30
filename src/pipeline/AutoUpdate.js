import { activeEntries } from '../util/countdown.js';

const DEFAULT_ACTIVE_WINDOW = 5;

export const DEFAULT_AUTOUPDATE_TEMPLATE = [
  'You are a state tracker. Identify changes to the tracked entities below.',
  'Emit one command per line. If nothing changed, reply exactly: NONE',
  '',
  'Apply TWO kinds of change:',
  '1. Changes caused by the LAST narrator reply (new injuries, items gained/lost, mood shifts, etc.)',
  '2. Recurring per-turn effects. This runs once every turn. For EACH currently-active status',
  '   effect whose description states a per-turn change (e.g. "+5 arousal / turn",',
  '   "lose 3 HP each turn"), you MUST emit that DELTA on THIS turn — every turn the effect is',
  '   active, without exception. Do not skip it just because you applied it on a previous turn;',
  '   the effect re-applies each turn it remains active. Only stop when the effect is gone.',
  '',
  '# Tracked entities',
  '(status effects and conditions show their description in parentheses — read these for recurring rules)',
  '',
  '{{tracked_entities}}',
  '',
  '# Commands',
  '',
  '{{commands_help}}',
  '',
  '# Last narrator reply',
  '',
  '{{last_reply}}',
].join('\n');

const COMMANDS_HELP = [
  'SET <subject> <tracker>.<field> = "<value>"',
  'DELTA <subject> <tracker>.<field> <±N>',
  'ADD <subject> <tracker>.<field> "<entry>"                       (list fields)',
  'ADD <subject> <tracker>.<field> "<name>" = "<descriptor>"       (pair-list fields)',
  'REMOVE <subject> <tracker>.<field> "<entry-or-name>"',
  'NEW_SUBJECT <name> <role>',
  'NONE',
  '',
  'Use ONLY commands shown. Subject names must match exactly. Output nothing else.',
  'For pair-list fields, ADD upserts: re-adding the same name replaces its descriptor.',
].join('\n');

function formatValue(field, value) {
  if (value === undefined || value === null) {
    if (field.type === 'list' || field.type === 'pair-list') return '[]';
    return field.type === 'number' ? '0' : '""';
  }
  if (field.type === 'list') return JSON.stringify(value);
  if (field.type === 'pair-list') {
    // Render as a readable pair list rather than raw JSON so the AI can mirror it.
    if (!Array.isArray(value) || value.length === 0) return '[]';
    return '[' + value
      .filter(p => p?.name)
      .map(p => `"${p.name}" = "${p.descriptor ?? ''}"`)
      .join(', ') + ']';
  }
  if (field.type === 'number') return String(value);
  return JSON.stringify(String(value));
}

function fieldTypeAnnotation(field) {
  if (field.type === 'number') return `number, ${field.min ?? 0}-${field.max ?? 100}`;
  if (field.type === 'enum') return `enum: ${field.options.join('|')}`;
  if (field.type === 'pair-list') return 'pair-list (entries are "name = descriptor")';
  return field.type;
}

export class AutoUpdate {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { generateQuietPrompt(text)->Promise<string>, getCurrentMsgId()->string|null, getMsgIndex(id)->number|null, template?:string }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._oneShot = new Set(); // "subjId|tracker|field" tokens
    this._template = (deps.template ?? '').trim() || null;
  }

  /** Replace the active template at runtime. Pass empty/null to revert to default. */
  setTemplate(tpl) {
    this._template = (tpl ?? '').trim() || null;
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
    const subjects = this.engine.listSubjects().filter(s => this.engine.isSubjectActive(s.id));
    const blocks = [];
    for (const subj of subjects) {
      const trackers = this.engine.definitions.forRole(subj.role).filter(d => d.autoUpdate !== false);
      const lines = [];
      for (const t of trackers) {
        for (const f of t.fields) {
          if (!this._passesInclusion(f, subj.id, t.id)) continue;
          const raw = this.engine.values.getField(subj.id, t.id, f.id) ?? f.default;
          const val = (f.type === 'list' && f.inclusion?.activeWindow != null)
            ? activeEntries(this.engine, subj.id, t.id, f, raw)
            : raw;
          lines.push(`  ${t.id}.${f.id} (${fieldTypeAnnotation(f)}) = ${formatValue(f, val)}`);
          // For describable list fields, surface each entry's description so the AI
          // can act on recurring-effect rules (e.g. "+5 arousal / turn").
          if (f.type === 'list' && f.describable && Array.isArray(val)) {
            for (const entry of val) {
              const desc = this.engine.getDescription(subj.id, t.id, f.id, entry);
              if (desc) lines.push(`      • ${entry}: ${desc}`);
            }
          }
        }
      }
      if (lines.length) {
        blocks.push(`${subj.name} (${subj.role}):\n${lines.join('\n')}`);
      }
    }
    // consume one-shots
    this._oneShot.clear();

    const trackedEntities = blocks.join('\n\n');
    const reply = lastNarratorReply ?? '';

    // Use custom template if set, otherwise use the default template
    const tpl = this._template ?? DEFAULT_AUTOUPDATE_TEMPLATE;

    // If template lacks {{last_reply}}, append it automatically
    const haslastReply = tpl.includes('{{last_reply}}');
    const effectiveTpl = haslastReply ? tpl : tpl + '\n\n{{last_reply}}';

    return effectiveTpl
      .replace(/\{\{tracked_entities\}\}/g, trackedEntities)
      .replace(/\{\{commands_help\}\}/g, COMMANDS_HELP)
      .replace(/\{\{last_reply\}\}/g, reply);
  }

  async run({ lastNarratorReply, msgId }) {
    const prompt = this.buildPrompt({ lastNarratorReply });
    const response = await this.deps.generateQuietPrompt(prompt);
    return this.engine.applyCommands(response ?? '', { source: 'auto-update', msgId });
  }
}