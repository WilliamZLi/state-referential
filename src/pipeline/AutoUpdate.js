import { activeEntries } from '../util/countdown.js';

const DEFAULT_ACTIVE_WINDOW = 5;

export const DEFAULT_AUTOUPDATE_TEMPLATE = [
  'You are a state tracker. Identify changes to the tracked entities below.',
  'Emit one command per line. If nothing changed, reply exactly: NONE',
  '',
  'Apply changes from these sources, in order of authority:',
  '1. The last user message — both in-character actions AND out-of-character directives',
  '   (e.g. parenthetical "<( … )>" notes). Treat such directives as AUTHORITATIVE: apply',
  '   exactly the state changes they describe (new conditions, stat/base changes, etc.).',
  '2. The last narrator reply (new injuries, items gained/lost, mood shifts…).',
  '3. Recurring per-turn effects. For EACH currently-active status effect whose description',
  '   states a per-turn change (e.g. "+5 arousal / turn", "lose 3 HP each turn"), you MUST emit',
  '   that DELTA on THIS turn — every turn the effect is active, without exception.',
  '',
  'When raising a cap (a max_* field) AND its value in the same turn, raise the cap first,',
  'then set the value — values are clamped to their current cap.',
  '',
  'For describable fields (outfit slots, conditions, status effects, items), SET or ADD a SHORT, succinct name',
  'with minimal parentheticals. A brief qualifier is fine (e.g. "staff (broken)", "robes (soaked)"), but do NOT',
  'cram the full description into the value — no piled-on appearance, effects, numbers, or rules. e.g. "nipple',
  'barbells", NOT "nipple barbells (enchanted, vibrating, locks the top…)". The full description is generated',
  'separately and read back each turn.',
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
  '# Last user message',
  '',
  '{{last_input}}',
  '',
  '# Last narrator reply',
  '',
  '{{last_reply}}',
].join('\n');

const COMMANDS_HELP = [
  'SET <subject> <tracker>.<field> = "<value>"',
  'DELTA <subject> <tracker>.<field> <±N>',
  'ADD <subject> <tracker>.<field> "<entry>"                       (list fields — entry is a SHORT name only)',
  'ADD <subject> <tracker>.<field> "<name>" = "<descriptor>"       (pair-list fields)',
  'REMOVE <subject> <tracker>.<field> "<entry-or-name>"',
  'REPLACE <subject> <tracker>.<field> "<old>" WITH "<new>"        (state change of an existing entry/value)',
  'NEW_SUBJECT <name> <role>',
  'NONE',
  '',
  'Use ONLY commands shown. Subject names must match exactly. Output nothing else.',
  'For pair-list fields, ADD upserts: re-adding the same name replaces its descriptor.',
  'For describable fields (SET a text value OR ADD a list entry), keep the value a SHORT, succinct name with',
  'minimal parentheticals — a brief qualifier is fine, but never cram the full description (appearance/effects/',
  'rules) into it; that is generated separately and read each turn.',
  'Use REPLACE only when an existing item or value changes state or condition — it is still the same',
  'thing (breaks, tears, worsens, upgrades); its prior description is carried forward. The new name must',
  'still be a short bare name (same as ADD). REPLACE is for list and text/enum fields only — for numeric',
  'changes use DELTA or SET. For a NEW item, a DIFFERENT item, or an empty field, use ADD / SET instead',
  'so it gets a fresh description.',
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
  if (field.type === 'number') {
    const min = field.min ?? 0;
    if (field.maxFromField) return `number (min ${min}; cap tracked in ${field.maxFromField})`;
    if (field.max != null) return `number, ${min}-${field.max}`;
    return `number, ${min}+ (no fixed cap)`;
  }
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

  buildPrompt({ lastNarratorReply, lastUserMessage }) {
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
    const userMsg = lastUserMessage ?? '';

    // Use custom template if set, otherwise the default
    const tpl = this._template ?? DEFAULT_AUTOUPDATE_TEMPLATE;

    // If a custom template lacks a slot, auto-append it so nothing is silently dropped.
    let effectiveTpl = tpl.includes('{{last_reply}}') ? tpl : tpl + '\n\n{{last_reply}}';
    if (!effectiveTpl.includes('{{last_input}}')) effectiveTpl += '\n\n# Last user message\n\n{{last_input}}';

    return effectiveTpl
      .replace(/\{\{tracked_entities\}\}/g, trackedEntities)
      .replace(/\{\{commands_help\}\}/g, COMMANDS_HELP)
      .replace(/\{\{last_input\}\}/g, userMsg)
      .replace(/\{\{last_reply\}\}/g, reply);
  }

  async run({ lastNarratorReply, lastUserMessage, msgId }) {
    const prompt = this.buildPrompt({ lastNarratorReply, lastUserMessage });
    if (this.deps.debug) {
      console.groupCollapsed('[state-referential] auto-update prompt');
      console.log(prompt);
      console.groupEnd();
    }
    const response = await this.deps.generateQuietPrompt(prompt);
    if (this.deps.debug) console.log('[state-referential] auto-update response:', response);
    return this.engine.applyCommands(response ?? '', { source: 'auto-update', msgId });
  }
}