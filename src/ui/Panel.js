import { loadTemplate, makeDraggable } from './shared.js';
import { makeRenderers } from './FieldRenderers.js';
import { SceneTagsUI } from './SceneTags.js';

export class Panel {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { popup, openProseModal, openSubjectAddModal, requestProbe, runManualProbe }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._currentSubjectId = null;
    this._currentTrackerId = null;
  }

  async mount() {
    const html = await loadTemplate('panel');
    $('body').append(html);
    this.$el = $('#strk-panel');
    makeDraggable(this.$el, $('#strk-panel-drag-handle'), 'strk:panel-pos');
    $('#strk-panel-close, .strk-panel-close', this.$el).on('click', () => this.hide());
    // Pass default tags from settings; rebuild if settings change.
    const getDefaults = this.deps.getDefaultTags ?? (() => []);
    const sceneTagsUI = new SceneTagsUI(this.engine, $('#strk-scene-tags'), { defaults: getDefaults(), dialogs: this.deps.dialogs });
    this.engine.on('tracker:default-tags-changed', (e) => {
      sceneTagsUI.defaults = e?.tags ?? getDefaults();
      sceneTagsUI.render();
    });

    $('#strk-add-subject').on('click', () => this.deps.openSubjectAddModal());
    $('#strk-rename-subject').on('click', async () => this._renameCurrentSubject());
    $('#strk-remove-subject').on('click', async () => this._removeCurrentSubject());
    $('#strk-probe-btn').on('click', () => this._currentTrackerId && this.deps.runManualProbe(this._currentTrackerId, this._currentSubject()));
    $('#strk-reset-btn').on('click', async () => this._resetSubject());

    this.renderers = makeRenderers(this.engine, {
      popup: this.deps.popup,
      dialogs: this.deps.dialogs,
      openProseModal: this.deps.openProseModal,
      requestProbe: this.deps.requestProbe,
      autoUpdate: this.deps.autoUpdate,
      injection: this.deps.injection,
    });

    for (const ev of [
      'tracker:value-changed', 'tracker:subject-added', 'tracker:subject-removed',
      'tracker:subject-renamed', 'tracker:tag-changed', 'tracker:schema-changed',
      'tracker:probe-completed', 'tracker:backend-changed', 'tracker:state-restored',
    ]) this.engine.on(ev, () => this.render());

    this.render();
  }

  show() { this.$el.removeClass('strk-hidden'); }
  hide() { this.$el.addClass('strk-hidden'); }
  toggle() { this.$el.toggleClass('strk-hidden'); }

  _currentSubject() {
    return this._currentSubjectId
      ? this.engine.subjects.get(this._currentSubjectId)
      : this.engine.protagonist();
  }

  async _resetSubject() {
    const subj = this._currentSubject();
    if (!subj) return;
    if (!await this.deps.dialogs.confirm(`Reset all tracker values for ${subj.name}?`)) return;
    this.engine.values.clearSubject(subj.id);
    this.render();
  }

  async _removeCurrentSubject() {
    const subj = this._currentSubject();
    if (!subj) return;
    if (!await this.deps.dialogs.confirm(`Remove subject "${subj.name}" entirely? This also deletes all their tracker values and descriptions. Cannot be undone.`)) return;
    this.engine.removeSubject(subj.name);
    this._currentSubjectId = null;
    this._currentTrackerId = null;
    this.render();
  }

  async _renameCurrentSubject() {
    const subj = this._currentSubject();
    if (!subj) return;
    const next = await this.deps.dialogs.prompt(`Rename "${subj.name}" to:`, subj.name);
    if (!next || next.trim() === '' || next.trim() === subj.name) return;
    try {
      this.engine.renameSubject(subj.name, next.trim());
    } catch (e) {
      await this.deps.dialogs.alert(`Could not rename: ${e.message}`);
    }
  }

  render() {
    if (!this.$el) return;
    const subjects = this.engine.listSubjects();
    const $sel = $('#strk-subject-select').empty();
    if (!subjects.length) { $('#strk-tabs').empty(); $('#strk-tab-body').html('<p>No subjects yet.</p>'); return; }
    for (const s of subjects) $sel.append($('<option></option>').val(s.id).text(`${s.name} (${s.role})`));
    if (!this._currentSubjectId || !subjects.find(s => s.id === this._currentSubjectId)) {
      this._currentSubjectId = subjects[0].id;
    }
    $sel.val(this._currentSubjectId).off('change').on('change', e => { this._currentSubjectId = e.target.value; this._currentTrackerId = null; this.render(); });

    const subj = this._currentSubject();
    const trackers = this.engine.definitions.forRole(subj.role);
    const $tabs = $('#strk-tabs').empty();
    if (!this._currentTrackerId || !trackers.find(t => t.id === this._currentTrackerId)) {
      this._currentTrackerId = trackers[0]?.id ?? null;
    }
    for (const t of trackers) {
      const $tab = $('<span class="strk-tab"></span>').text(t.label).attr('data-id', t.id);
      if (t.id === this._currentTrackerId) $tab.addClass('active');
      $tab.on('click', () => { this._currentTrackerId = t.id; this.render(); });
      $tabs.append($tab);
    }
    const $body = $('#strk-tab-body').empty();
    if (!this._currentTrackerId) { $body.html('<p>No trackers for this subject.</p>'); return; }
    const t = this.engine.getTracker(this._currentTrackerId);
    for (const f of t.fields) {
      const fwithTracker = { ...f, _trackerId: t.id };
      const $row = this.renderers[f.type]?.(fwithTracker, subj);
      if ($row) $body.append($row);
    }
  }
}