import { eventSource, event_types, saveSettingsDebounced, saveChatConditional, setExtensionPrompt } from '../../../../script.js';

const getContext = () => window.SillyTavern.getContext();
import { extension_settings } from '../../../extensions.js';
import { MacrosParser } from '../../../macros.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

import { TrackerEngine } from './src/engine/TrackerEngine.js';
import { ChatScopedBackend } from './src/pipeline/ChatScopedBackend.js';
import { AutoUpdate } from './src/pipeline/AutoUpdate.js';
import { DescriptionProbe } from './src/pipeline/DescriptionProbe.js';
import { StandaloneProbe } from './src/pipeline/StandaloneProbe.js';
import { Injection } from './src/pipeline/Injection.js';
import { Versioning } from './src/pipeline/Versioning.js';
import { Panel } from './src/ui/Panel.js';
import { SchemaEditor } from './src/ui/SchemaEditor.js';
import { SettingsDrawer } from './src/ui/SettingsDrawer.js';
import { makePopup } from './src/ui/Popup.js';
import { makeDialogs } from './src/ui/dialogs.js';
import { loadTemplate } from './src/ui/shared.js';
import { readTrackerMsgId } from './src/util/id.js';

import * as Macros from './src/integration/Macros.js';
import * as SlashCommands from './src/integration/SlashCommands.js';
import * as EventHooks from './src/integration/EventHooks.js';

(async function init() {
  const ctx = {
    getChat: () => getContext().chat,
    getChatMetadata: () => getContext().chatMetadata,
    getExtensionSettings: () => extension_settings,
    saveChatConditional,
    saveSettingsDebounced,
  };

  const backend = new ChatScopedBackend(ctx);
  const engine = new TrackerEngine(backend);

  const popup = makePopup({ callGenericPopup, POPUP_TYPE });
  const dialogs = makeDialogs(callGenericPopup, POPUP_TYPE);

  // Quiet generation for auto-update / standalone probes — uses the full chat context.
  const generateQuietPrompt = async (text) => getContext().generateQuietPrompt(text, false, false);

  // Isolated generation for description probes — tries generateRaw first (bypasses
  // chat history, world info, character card) and falls back to generateQuietPrompt
  // if generateRaw isn't available on this ST version.
  const generateProbePrompt = async (text) => {
    const ctx = getContext();
    if (typeof ctx.generateRaw === 'function') {
      try {
        return await ctx.generateRaw({
          prompt: text,
          systemPrompt: '',
          responseLength: 200,
        });
      } catch (e) {
        console.warn('[state-referential] generateRaw failed, falling back to generateQuietPrompt:', e?.message);
      }
    }
    return ctx.generateQuietPrompt(text, false, false);
  };
  const insertSmallSysMessage = (opts) => {
    const chat = getContext().chat;
    chat.push({ name: opts.name, is_user: false, is_system: false, mes: opts.mes, extra: opts.extra });
    saveChatConditional();
    eventSource.emit(event_types.MESSAGE_RECEIVED, chat.length - 1);
  };

  const _strkSettings = () => {
    extension_settings['state-referential'] ??= {};
    return extension_settings['state-referential'];
  };

  const autoUpdate = new AutoUpdate(engine, {
    generateQuietPrompt,
    getCurrentMsgId: () => {
      const chat = getContext().chat;
      return readTrackerMsgId(chat[chat.length - 1]) ?? null;
    },
    getMsgIndex: (id) => {
      const chat = getContext().chat;
      const i = chat.findIndex(m => readTrackerMsgId(m) === id);
      return i < 0 ? null : i;
    },
    template: _strkSettings().templates?.autoUpdate,
  });
  const descProbe = new DescriptionProbe(engine, {
    generateQuietPrompt: generateProbePrompt, // isolated, no chat context
    template: _strkSettings().templates?.probe,
  });
  const proseStore = {};
  const standalone = new StandaloneProbe(engine, { generateQuietPrompt, insertSmallSysMessage, proseStore });
  const injection = new Injection(engine, { setExtensionPrompt });
  const versioning = new Versioning(engine, {
    eventSource, event_types,
    getChat: () => getContext().chat,
    autoUpdate, descProbe, standalone, injection,
    throttleMs: 500,
  });

  // Re-run injection just before generation
  eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => injection.run());

  // UI
  const schemaEditor = new SchemaEditor(engine, { callGenericPopup, POPUP_TYPE, dialogs, close: ($form) => _closePopup($form) });
  const settingsDrawer = new SettingsDrawer(engine, {
    schemaEditor,
    dialogs,
    getExtensionSettings: () => extension_settings,
    saveSettingsDebounced,
    autoUpdate,
    descProbe,
  });
  await settingsDrawer.mount();

  // Robust popup dismissal — ST's popup markup varies across versions.
  // Try native <dialog>.close(), then various known close-button selectors, then Escape.
  const _closePopup = ($contentJq) => {
    // Strategy 1: <dialog> ancestor with native close()
    const $dialog = $contentJq.closest('dialog');
    if ($dialog.length && typeof $dialog[0].close === 'function') {
      $dialog[0].close();
      return;
    }
    // Strategy 2: known close-button selectors
    const $popup = $contentJq.closest('.popup, .popup_container, .dialogue_popup');
    const closeSelectors = [
      '.popup_cross', '.popup_close', '.popup-button-close',
      '.menu_button.popup_button_cancel', '.popup_button_cancel',
      '.fa-times', '.fa-xmark',
    ];
    for (const sel of closeSelectors) {
      const $btn = $popup.find(sel).first();
      if ($btn.length) { $btn.trigger('click'); return; }
    }
    // Strategy 3: Escape key dispatched on document
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  const openProseModal = async ({ title, text, onSave, onRefresh }) => {
    const html = await loadTemplate('prose-edit-modal');
    const $f = $(html);
    $('#strk-prose-title', $f).text(title);
    $('#strk-prose-text', $f).val(text);
    $('#strk-prose-save', $f).on('click', () => { onSave?.($('#strk-prose-text', $f).val()); _closePopup($f); });
    $('#strk-prose-refresh', $f).on('click', () => { onRefresh?.(); });
    // Cancel: close via the robust helper
    $('#strk-prose-cancel', $f).on('click', () => _closePopup($f));
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', { wide: true });
  };

  const openSubjectAddModal = async (opts = {}) => {
    const html = await loadTemplate('subject-add-modal');
    const $f = $(html);
    if (opts.forceProtagonist) { $('#strk-subj-role', $f).val('protagonist').prop('disabled', true); $('#strk-subject-modal-title', $f).text('Create protagonist'); }
    $('#strk-subj-save', $f).on('click', async () => {
      const name = $('#strk-subj-name', $f).val().trim();
      // For forceProtagonist, the role select is disabled which means jQuery .val() may
      // return undefined depending on how the popup re-mounted; fall back to 'protagonist'.
      const role = $('#strk-subj-role', $f).val() || (opts.forceProtagonist ? 'protagonist' : 'npc');
      const traits = {
        age: $('#strk-trait-age', $f).val(),
        height: $('#strk-trait-height', $f).val(),
        build: $('#strk-trait-build', $f).val(),
        complexion: $('#strk-trait-complexion', $f).val(),
        hair: $('#strk-trait-hair', $f).val(),
        eyes: $('#strk-trait-eyes', $f).val(),
        distinguishing_features: $('#strk-trait-distinguishing', $f).val(),
      };
      if (!name) { await dialogs.alert('Name is required.'); return; }
      let subj;
      try {
        subj = engine.addSubject(name, { role, traits });
      } catch (e) {
        await dialogs.alert(`Could not add subject: ${e.message}`);
        return;
      }
      // Mirror into the Traits tracker if installed so the panel reflects them.
      if (engine.getTracker('traits')) {
        for (const [fieldId, value] of Object.entries(traits)) {
          if (value && value.trim()) {
            try { engine.setField(subj.id, 'traits', fieldId, value, { source: 'manual' }); }
            catch (e) { /* field may not exist in user-modified Traits schema; skip */ }
          }
        }
      }
      // Mark first-run complete so we don't keep popping the modal on every load.
      _strkSettings().firstRunComplete = true;
      saveSettingsDebounced();
      // Close the popup — try multiple strategies because ST popup markup varies by version.
      _closePopup($f);
    });
    // Cancel: close the popup + mark first-run dismissed so we don't auto-pop on every load.
    $('#strk-subj-cancel', $f).on('click', () => {
      _strkSettings().firstRunComplete = true;
      saveSettingsDebounced();
      _closePopup($f);
    });
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', {});
  };

  const panel = new Panel(engine, {
    popup,
    dialogs,
    openProseModal,
    openSubjectAddModal,
    requestProbe: (subjId, trackerId, fieldId, value) => {
      descProbe.enqueue([{ subjectId: subjId, trackerId, fieldId, value }]);
      return descProbe.drain();
    },
    runManualProbe: (trackerId, subject) => standalone.runOne(trackerId, subject),
    descProbe,
    // Merge built-in defaults with user-added so the chips always include the
    // baseline set even when defaultTags setting is empty.
    getDefaultTags: () => {
      const builtins = ['intimate', 'combat', 'social', 'exploration', 'wardrobe', 'dressing'];
      const user = _strkSettings().defaultTags ?? [];
      return [...new Set([...builtins, ...user])];
    },
    autoUpdate,
    injection,
  });
  await panel.mount();

  // First-run: prompt for protagonist on truly first install only AND only
  // inside an actual chat (not the ST home/landing screen).
  // The EventHooks backend-changed listener catches the case where the user
  // is on home now and opens a chat later.
  const shouldFirstRun = () =>
    !_strkSettings().firstRunComplete &&
    (getContext().chat?.length ?? 0) > 0 &&
    engine.listTrackers().length > 0 &&
    engine.listSubjects().length === 0;

  if (shouldFirstRun()) {
    openSubjectAddModal({ forceProtagonist: true });
  }

  // Chat-toolbar toggle button (matches ST extension-menu entry markup)
  const $btn = $(`
    <div id="strk-menu-button" class="list-group-item flex-container flexGap5 interactable" title="Toggle State Tracker panel" tabindex="0">
      <i class="fa-solid fa-list-check extensionsMenuExtensionButton"></i>
      <span>State Tracker</span>
    </div>
  `);
  $btn.on('click', () => panel.toggle());
  $('#extensionsMenu').append($btn);

  // Integration
  // Register macros using the new MacroRegistry API (ST 1.13+) which supports
  // `::`-separated arguments. Falls back to legacy MacrosParser if unavailable
  // (older ST versions — won't support args but registers the names).
  let macros = null;
  try {
    ({ macros } = await import('../../../macros/macro-system.js'));
  } catch (e) {
    console.warn('[state-referential] new macro-system.js not available, falling back to legacy MacrosParser:', e?.message);
  }
  Macros.register(engine, { macros, MacrosParser, proseStore });
  SlashCommands.register(engine, { SlashCommandParser, SlashCommand, panel, dialogs, autoUpdate, injection, standalone, getExtensionSettings: () => extension_settings, saveSettingsDebounced });
  EventHooks.register(engine, {
    versioning,
    descProbe,
    getSettings: () => extension_settings['state-referential'],
    hasActiveChat: () => (getContext().chat?.length ?? 0) > 0,
    panel,
    injection,
  });

  // Public API
  window.STTracker = {
    defineTracker: (d) => engine.defineTracker(d),
    updateTracker: (id, d) => engine.updateTracker(id, d),
    deleteTracker: (id) => engine.deleteTracker(id),
    getTracker: (id) => engine.getTracker(id),
    listTrackers: () => engine.listTrackers(),

    addSubject: (n, o) => engine.addSubject(n, o),
    removeSubject: (n) => engine.removeSubject(n),
    renameSubject: (a, b) => engine.renameSubject(a, b),
    setProtagonist: (n) => engine.setProtagonist(n),
    listSubjects: () => engine.listSubjects(),
    protagonist: () => engine.protagonist(),
    resolveSubject: (token) => engine.resolveSubject(token),

    getField: (...a) => engine.getField(...a),
    setField: (...a) => engine.setField(...a),
    applyDelta: (...a) => engine.applyDelta(...a),
    addListEntry: (...a) => engine.addListEntry(...a),
    removeListEntry: (...a) => engine.removeListEntry(...a),
    applyCommands: (t, o) => engine.applyCommands(t, o),

    getDescription: (...a) => engine.getDescription(...a),
    setDescription: (...a) => engine.setDescription(...a),
    invalidateDescription: (...a) => engine.invalidateDescription(...a),

    setSceneTag: (t, on) => engine.setSceneTag(t, on),
    toggleSceneTag: (t) => engine.toggleSceneTag(t),
    listActiveTags: () => engine.listActiveTags(),
    isTagActive: (tag) => engine.isTagActive(tag),

    snapshot: () => engine.snapshot(),
    loadSnapshot: (msgId) => engine.loadSnapshot(msgId),
    restoreSnapshot: (s) => engine.restoreSnapshot(s),
    diffSnapshots: (a, b) => engine.diffSnapshots(a, b),
    renderDiffAsCommands: (d) => engine.renderDiffAsCommands(d),
    pinSnapshot: (id, r) => engine.pinSnapshot(id, r),
    unpinSnapshot: (id) => engine.unpinSnapshot(id),
    listSnapshots: () => engine.listSnapshots(),
    dropSnapshots: (ids) => engine.dropSnapshots(ids),

    setStorageBackend: (b) => engine.setStorageBackend(b),

    on: (e, fn) => engine.on(e, fn),
    off: (e, fn) => engine.off(e, fn),

    // Unstable: direct engine reference for debugging only — not part of public spec.
    _engine: engine,
  };

  console.log('[state-referential] ready');
})();
