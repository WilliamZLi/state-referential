import { loadTemplate, loadPreset } from './shared.js';

const PRESETS = ['traits','outfit','stats','state','inventory','relationships'];

export class SettingsDrawer {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps; // { schemaEditor, getExtensionSettings, saveSettingsDebounced }
  }

  async mount() {
    const html = await loadTemplate('settings-drawer');
    $('#extensions_settings').append(html);
    this._wire();
    this.render();
  }

  _settings() {
    const es = this.deps.getExtensionSettings();
    es['state-referential'] ??= { enabled: true, autoUpdate: true, probeDesc: true, activeWindow: 5, defaultTags: [], templates: {} };
    return es['state-referential'];
  }

  _wire() {
    const s = this._settings();
    $('#strk-enable').prop('checked', s.enabled !== false).on('change', e => { s.enabled = e.target.checked; this.deps.saveSettingsDebounced(); });
    $('#strk-auto-update').prop('checked', s.autoUpdate !== false).on('change', e => { s.autoUpdate = e.target.checked; this.deps.saveSettingsDebounced(); });
    $('#strk-probe-desc').prop('checked', s.probeDesc !== false).on('change', e => { s.probeDesc = e.target.checked; this.deps.saveSettingsDebounced(); });
    $('#strk-active-window').val(s.activeWindow ?? 5).on('change', e => { s.activeWindow = Number(e.target.value); this.deps.saveSettingsDebounced(); });
    $('#strk-new-tracker').on('click', () => this.deps.schemaEditor.open(null));
    $('#strk-install-presets').on('click', () => this._installPresets());
    $('#strk-import-json').on('click', () => this._importJson());
    $('#strk-reset-state').on('click', () => this._resetState());
    this.engine.on('tracker:schema-changed', () => this.render());
  }

  async _installPresets() {
    if (!confirm('Install default presets? This adds the six built-in trackers.')) return;
    for (const name of PRESETS) {
      try {
        const def = await loadPreset(name);
        if (!this.engine.getTracker(def.id)) this.engine.defineTracker(def);
      } catch (e) { console.error('preset install failed', name, e); }
    }
  }

  async _importJson() {
    const json = prompt('Paste tracker JSON:');
    if (!json) return;
    try {
      const d = JSON.parse(json);
      if (this.engine.getTracker(d.id)) this.engine.updateTracker(d.id, d); else this.engine.defineTracker(d);
    } catch (e) { alert('Invalid JSON: ' + e.message); }
  }

  _resetState() {
    if (!confirm('Reset ALL tracker state for the current chat? This cannot be undone.')) return;
    for (const s of this.engine.listSubjects()) this.engine.removeSubject(s.name);
  }

  render() {
    const $list = $('#strk-defs-list').empty();
    for (const d of this.engine.listTrackers()) {
      const $row = $('<div class="strk-def-row"></div>');
      $row.append($('<span></span>').text(`${d.label} (${d.id})`));
      $row.append($('<button class="menu_button">edit</button>').on('click', () => this.deps.schemaEditor.open(d.id)));
      $row.append($('<button class="menu_button">delete</button>').on('click', () => { if (confirm(`Delete tracker ${d.id}?`)) this.engine.deleteTracker(d.id); }));
      $list.append($row);
    }
  }
}