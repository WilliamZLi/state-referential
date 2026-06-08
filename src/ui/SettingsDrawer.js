import { loadTemplate, loadPreset } from './shared.js';
import { DEFAULT_AUTOUPDATE_TEMPLATE } from '../pipeline/AutoUpdate.js';
import { DEFAULT_PROBE_TEMPLATE } from '../pipeline/DescriptionProbe.js';

const PRESETS = ['traits','outfit','wardrobe','stats','state','sensitivities','inventory','relationships','location','object','faction'];

export class SettingsDrawer {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps; // { schemaEditor, getExtensionSettings, saveSettingsDebounced, autoUpdate, descProbe }
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
    $('#strk-reprobe-profile').val(s.reprobeProfile ?? 'field').on('change', e => { s.reprobeProfile = e.target.value; this.deps.saveSettingsDebounced(); });
    $('#strk-active-window').val(s.activeWindow ?? 5).on('change', e => { s.activeWindow = Number(e.target.value); this.deps.saveSettingsDebounced(); });
    $('#strk-probe-context').val(s.probeContextTurns ?? 2).on('change', e => {
      const n = parseInt(e.target.value, 10);
      s.probeContextTurns = Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 2;
      this.deps.saveSettingsDebounced();
    });
    $('#strk-debug').prop('checked', s.debug === true).on('change', e => { s.debug = e.target.checked; this.deps.saveSettingsDebounced(); });
    $('#strk-new-tracker').on('click', () => this.deps.schemaEditor.open(null));
    $('#strk-install-presets').on('click', () => this._installPresets());
    $('#strk-uninstall-presets').on('click', () => this._uninstallPresets());
    $('#strk-import-json').on('click', () => this._importJson());
    $('#strk-reset-state').on('click', () => this._resetState());
    $('#strk-cleanup-desc').on('click', () => this._cleanupOrphanDescriptions());

    // Default scene tags
    this._renderDefaultTags();
    $('#strk-add-default-tag').on('click', async () => {
      const tag = this.deps.dialogs
        ? await this.deps.dialogs.prompt('New default tag name:')
        : prompt('New default tag name:');
      if (!tag || !tag.trim()) return;
      const trimmed = tag.trim();
      s.defaultTags ??= [];
      if (!s.defaultTags.includes(trimmed)) {
        s.defaultTags.push(trimmed);
        this.deps.saveSettingsDebounced();
        this._renderDefaultTags();
        this.engine.bus.emit('tracker:default-tags-changed', { tags: s.defaultTags });
      }
    });

    // Template textareas
    s.templates ??= {};
    $('#strk-tpl-autoupdate')
      .attr('placeholder', DEFAULT_AUTOUPDATE_TEMPLATE)
      .val(s.templates.autoUpdate ?? '')
      .on('change', e => {
        s.templates.autoUpdate = e.target.value;
        this.deps.saveSettingsDebounced();
        this.deps.autoUpdate?.setTemplate(e.target.value);
      });
    $('#strk-tpl-probe')
      .attr('placeholder', DEFAULT_PROBE_TEMPLATE)
      .val(s.templates.probe ?? '')
      .on('change', e => {
        s.templates.probe = e.target.value;
        this.deps.saveSettingsDebounced();
        this.deps.descProbe?.setTemplate(e.target.value);
      });
    $('#strk-reset-tpls').on('click', async () => {
      const ok = this.deps.dialogs
        ? await this.deps.dialogs.confirm('Reset both templates to default?')
        : confirm('Reset both templates to default?');
      if (!ok) return;
      s.templates = {};
      $('#strk-tpl-autoupdate').val('');
      $('#strk-tpl-probe').val('');
      this.deps.saveSettingsDebounced();
      this.deps.autoUpdate?.setTemplate('');
      this.deps.descProbe?.setTemplate('');
    });


    this.engine.on('tracker:schema-changed', () => this.render());
  }

  _renderDefaultTags() {
    const s = this._settings();
    const $container = $('#strk-default-tags').empty();
    for (const tag of (s.defaultTags ?? [])) {
      const $row = $('<div class="strk-def-row"></div>');
      $row.append($('<span></span>').text(tag));
      const $rm = $('<button class="menu_button">×</button>').on('click', () => {
        s.defaultTags = s.defaultTags.filter(t => t !== tag);
        this.deps.saveSettingsDebounced();
        this._renderDefaultTags();
        this.engine.bus.emit('tracker:default-tags-changed', { tags: s.defaultTags });
      });
      $row.append($rm);
      $container.append($row);
    }
  }

  async _installPresets() {
    const ok = this.deps.dialogs
      ? await this.deps.dialogs.confirm('Install default presets? This adds the six built-in trackers (or updates them if already installed).')
      : confirm('Install default presets? This adds the six built-in trackers (or updates them if already installed).');
    if (!ok) return;
    for (const name of PRESETS) {
      try {
        const def = await loadPreset(name);
        if (this.engine.getTracker(def.id)) this.engine.updateTracker(def.id, def);
        else this.engine.defineTracker(def);
      } catch (e) { console.error('preset install failed', name, e); }
    }
  }

  async _uninstallPresets() {
    const ok = this.deps.dialogs
      ? await this.deps.dialogs.confirm('Uninstall all preset trackers? This removes their definitions but does not delete already-stored values.')
      : confirm('Uninstall all preset trackers? This removes their definitions but does not delete already-stored values.');
    if (!ok) return;
    for (const name of PRESETS) {
      try {
        if (this.engine.getTracker(name)) this.engine.deleteTracker(name);
      } catch (e) { console.error('preset uninstall failed', name, e); }
    }
  }

  async _importJson() {
    const json = this.deps.dialogs
      ? await this.deps.dialogs.prompt('Paste tracker JSON:')
      : prompt('Paste tracker JSON:');
    if (!json) return;
    try {
      const d = JSON.parse(json);
      if (this.engine.getTracker(d.id)) this.engine.updateTracker(d.id, d); else this.engine.defineTracker(d);
    } catch (e) {
      if (this.deps.dialogs) await this.deps.dialogs.alert('Invalid JSON: ' + e.message);
      else alert('Invalid JSON: ' + e.message);
    }
  }

  async _resetState() {
    const ok = this.deps.dialogs
      ? await this.deps.dialogs.confirm('Reset ALL tracker state for the current chat? This cannot be undone.')
      : confirm('Reset ALL tracker state for the current chat? This cannot be undone.');
    if (!ok) return;
    for (const s of this.engine.listSubjects()) this.engine.removeSubject(s.name);
  }

  async _cleanupOrphanDescriptions() {
    const msg = 'Cleanup orphan descriptions? This removes cached descriptions (per-subject AND global) for values no longer referenced anywhere — i.e. not currently worn and not in any list such as a wardrobe. Anything still referenced is kept. Run this only when you are sure you won\'t revert to a state that used them.';
    const ok = this.deps.dialogs ? await this.deps.dialogs.confirm(msg) : confirm(msg);
    if (!ok) return;
    const removed = this.engine.pruneOrphanDescriptions();
    const done = `Cleanup complete. Removed ${removed} orphan description entr${removed === 1 ? 'y' : 'ies'}.`;
    if (this.deps.dialogs) await this.deps.dialogs.alert(done);
    else alert(done);
  }

  render() {
    const $list = $('#strk-defs-list').empty();
    for (const d of this.engine.listTrackers()) {
      const $row = $('<div class="strk-def-row"></div>');
      $row.append($('<span></span>').text(`${d.label} (${d.id})`));
      $row.append($('<button class="menu_button">edit</button>').on('click', () => this.deps.schemaEditor.open(d.id)));
      $row.append($('<button class="menu_button">delete</button>').on('click', async () => {
        const ok = this.deps.dialogs
          ? await this.deps.dialogs.confirm(`Delete tracker ${d.id}?`)
          : confirm(`Delete tracker ${d.id}?`);
        if (ok) this.engine.deleteTracker(d.id);
      }));
      $list.append($row);
    }
  }
}