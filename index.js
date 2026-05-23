import { eventSource, event_types, getContext, saveSettingsDebounced, saveChatConditional, setExtensionPrompt } from '../../../../script.js';
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
import { loadTemplate } from './src/ui/shared.js';

import * as Macros from './src/integration/Macros.js';
import * as SlashCommands from './src/integration/SlashCommands.js';
import * as EventHooks from './src/integration/EventHooks.js';

(async function init() {
  const ctx = {
    getChat: () => getContext().chat,
    getExtensionSettings: () => extension_settings,
    saveChatConditional,
    saveSettingsDebounced,
    chatMetadata: getContext().chatMetadata,
  };

  const backend = new ChatScopedBackend(ctx);
  const engine = new TrackerEngine(backend);

  const popup = makePopup({ callGenericPopup, POPUP_TYPE });

  const generateQuietPrompt = async (text) => getContext().generateQuietPrompt(text, false, false);
  const insertSmallSysMessage = (opts) => {
    const chat = getContext().chat;
    chat.push({ name: opts.name, is_user: false, is_system: false, mes: opts.mes, extra: opts.extra });
    saveChatConditional();
    eventSource.emit(event_types.MESSAGE_RECEIVED, chat.length - 1);
  };

  const autoUpdate = new AutoUpdate(engine, {
    generateQuietPrompt,
    getCurrentMsgId: () => {
      const chat = getContext().chat;
      return chat[chat.length - 1]?.extra?.trackerMsgId ?? null;
    },
    getMsgIndex: (id) => {
      const chat = getContext().chat;
      const i = chat.findIndex(m => m?.extra?.trackerMsgId === id);
      return i < 0 ? null : i;
    },
  });
  const descProbe = new DescriptionProbe(engine, { generateQuietPrompt });
  const standalone = new StandaloneProbe(engine, { generateQuietPrompt, insertSmallSysMessage, proseStore: {} });
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
  const schemaEditor = new SchemaEditor(engine, { callGenericPopup, POPUP_TYPE, close: () => {} });
  const settingsDrawer = new SettingsDrawer(engine, {
    schemaEditor,
    getExtensionSettings: () => extension_settings,
    saveSettingsDebounced,
  });
  await settingsDrawer.mount();

  const openProseModal = async ({ title, text, onSave, onRefresh }) => {
    const html = await loadTemplate('prose-edit-modal');
    const $f = $(html);
    $('#strk-prose-title', $f).text(title);
    $('#strk-prose-text', $f).val(text);
    $('#strk-prose-save', $f).on('click', () => { onSave?.($('#strk-prose-text', $f).val()); });
    $('#strk-prose-refresh', $f).on('click', () => { onRefresh?.(); });
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', { wide: true });
  };

  const openSubjectAddModal = async (opts = {}) => {
    const html = await loadTemplate('subject-add-modal');
    const $f = $(html);
    if (opts.forceProtagonist) { $('#strk-subj-role', $f).val('protagonist').prop('disabled', true); $('#strk-subject-modal-title', $f).text('Create protagonist'); }
    $('#strk-subj-save', $f).on('click', () => {
      const name = $('#strk-subj-name', $f).val().trim();
      const role = $('#strk-subj-role', $f).val();
      const traits = {
        height: $('#strk-trait-height', $f).val(),
        build: $('#strk-trait-build', $f).val(),
        complexion: $('#strk-trait-complexion', $f).val(),
        hair: $('#strk-trait-hair', $f).val(),
        eyes: $('#strk-trait-eyes', $f).val(),
        distinguishing_features: $('#strk-trait-distinguishing', $f).val(),
      };
      if (name) engine.addSubject(name, { role, traits });
    });
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', { wide: true });
  };

  const panel = new Panel(engine, {
    popup,
    openProseModal,
    openSubjectAddModal,
    requestProbe: (subjId, trackerId, fieldId, value) => descProbe.enqueue([{ subjectId: subjId, trackerId, fieldId, value }]).then(()=>descProbe.drain()),
    runManualProbe: (trackerId, subject) => standalone.runOne(trackerId, subject),
  });
  await panel.mount();

  // Chat-toolbar toggle button
  const $btn = $(`<div class="fa-solid fa-list-check strk-toolbar-btn" title="State Tracker" style="cursor:pointer;padding:4px;"></div>`);
  $btn.on('click', () => panel.toggle());
  $('#extensionsMenu').append($btn);

  // Integration
  Macros.register(engine, { MacrosParser });
  SlashCommands.register(engine, { SlashCommandParser, SlashCommand, panel, autoUpdate, injection, standalone });
  EventHooks.register(engine, { versioning, descProbe, getSettings: () => extension_settings['state-referential'], panel, injection });

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

    snapshot: () => engine.snapshot(),
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
  };

  console.log('[state-referential] ready');
})();
