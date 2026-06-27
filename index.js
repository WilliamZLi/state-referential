import { eventSource, event_types, saveSettingsDebounced, saveChatConditional, setExtensionPrompt, doNewChat, getMaxContextTokens } from '../../../../script.js';
import { splitForSeed, buildBranchMeta, addBranchRecord, setBranchStatus, playRange, foldbackAnchorId, buildFoldbackMarker, sceneChatName } from './src/pipeline/Branches.js';
import { buildSyntheticMessage } from './src/pipeline/L3Insert.js';
import { buildTranscript } from './src/util/transcript.js';

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
import { newId, readTrackerMsgId } from './src/util/id.js';

import * as Macros from './src/integration/Macros.js';
import * as SlashCommands from './src/integration/SlashCommands.js';
import * as EventHooks from './src/integration/EventHooks.js';
import { WorldRegistry } from './src/engine/WorldRegistry.js';
import { ChronicleStore } from './src/engine/ChronicleStore.js';
import { WorldBinding, makeServerApi } from './src/pipeline/WorldBinding.js';
import { WorldBinder } from './src/pipeline/WorldBinder.js';
import { ChronicleInjection } from './src/pipeline/ChronicleInjection.js';
import { ChronicleOps } from './src/pipeline/ChronicleOps.js';
import { WorldLock } from './src/pipeline/WorldLock.js';
import { Compaction } from './src/pipeline/Compaction.js';
import { estimateChatTokens, resolveContextSize } from './src/pipeline/TokenBudget.js';
import { decideAutoCompact } from './src/pipeline/AutoCompact.js';
import { insertSyntheticAfter, actCompleteMarker, restoreArchive } from './src/pipeline/MainlineOps.js';
import { toggleAnchor, countAnchors } from './src/pipeline/Anchors.js';
import { register as registerL3Commands } from './src/integration/L3SlashCommands.js';
import { mountMessageButtons } from './src/integration/MessageButtons.js';
import { WorldManager } from './src/ui/WorldManager.js';
import { WorldView } from './src/ui/WorldView.js';
import { WorldBindingPrompt } from './src/ui/WorldBindingPrompt.js';

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
  //
  // generateRaw drops the user's chat/preset, so without a system prompt of our own
  // the model has no permission framing and silently returns empty for mature/explicit
  // values (a "dairy cow curse" with sexual effects) while innocuous ones (clothing)
  // succeed — that asymmetry is the blank-description bug. We supply a permissive
  // description-engine system prompt so the probe matches the chat's own content latitude.
  // Length and style are dictated by the per-field probe template (generic wants one
  // short clause; detailed wants the full mechanical effect list with exact numbers),
  // so this system prompt stays length-neutral — it only grants permission framing and
  // enforces output-only behavior.
  const PROBE_SYSTEM_PROMPT = 'You are a description engine for an adult interactive-fiction state tracker. '
    + 'Follow the prompt instructions exactly and output only the requested description — concrete and '
    + 'factual, at whatever length the prompt asks for. This is fiction for consenting adults; render '
    + 'mature, explicit, or taboo content plainly when the element calls for it. Never refuse, moralize, '
    + 'soften, or add disclaimers or preamble.';
  const generateProbePrompt = async (text) => {
    const ctx = getContext();
    if (typeof ctx.generateRaw === 'function') {
      try {
        return await ctx.generateRaw({
          prompt: text,
          systemPrompt: PROBE_SYSTEM_PROMPT,
          responseLength: 200,
        });
      } catch (e) {
        console.warn('[state-referential] generateRaw failed, falling back to generateQuietPrompt:', e?.message);
      }
    }
    return ctx.generateQuietPrompt(text, false, false);
  };

  // Isolated generation for chronicle summaries. Like the description probe, this
  // uses generateRaw to BYPASS the chat history, character card, and world info —
  // otherwise generateQuietPrompt summarizes "as the narrator, inside the story",
  // so the model continues the narrative instead of stepping out to summarize it.
  // The permissive system prompt keeps mature content from being refused or
  // sanitized (mirrors PROBE_SYSTEM_PROMPT).
  const CHRONICLE_SYSTEM_PROMPT = 'You are a chronicle summarizer for an adult interactive fiction. '
    + 'You do NOT continue, advance, or write new story — you ONLY summarize events that already happened. '
    + 'Read the events in the prompt and output a single concise, factual, past-tense paragraph of what occurred. '
    + 'Render mature, explicit, or taboo content plainly when present; never refuse, moralize, soften, or add '
    + 'preamble. Output only the summary paragraph.';
  const generateChronicleSummary = async (text) => {
    const ctx = getContext();
    if (typeof ctx.generateRaw === 'function') {
      try {
        return await ctx.generateRaw({ prompt: text, systemPrompt: CHRONICLE_SYSTEM_PROMPT, responseLength: 600 });
      } catch (e) {
        console.warn('[state-referential] generateRaw failed for chronicle, falling back to generateQuietPrompt:', e?.message);
      }
    }
    return ctx.generateQuietPrompt({ quietPrompt: text });
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

  // ── Layer 3 — Mainline mechanics ──────────────────────────────────────────────
  const L3_DEFAULTS = { auto: 'nudge', thresholdPct: 80, batchSize: 25, recentWindow: 50, minSize: 10, tokenCap: 400, branchLastN: 10 };
  const l3Settings = () => ({ ...L3_DEFAULTS, ...(_strkSettings().compaction ?? {}) });

  const stShell = {
    getChat: () => getContext().chat,
    getMeta: () => getContext().chatMetadata, // chat_metadata — persisted; archives live here
    saveChat: () => saveChatConditional(),
    reloadChat: () => getContext().reloadCurrentChat(),
    emit: (name, ...a) => eventSource.emit(name, ...a),
    eventTypes: event_types,
  };

  const l3GenerateSummary = async (messages, tokenCap) => {
    const body = buildTranscript(messages);
    // Transcript FIRST, instruction LAST. With a long transcript, an instruction
    // placed up top gets drowned out and the model just CONTINUES the story
    // (it ends mid-scene). Putting the recap instruction after the transcript
    // makes it the model's last/strongest signal so it summarizes instead.
    const prompt =
      'TRANSCRIPT OF EVENTS THAT ALREADY HAPPENED:\n\n'
      + body
      + '\n\n=== END OF TRANSCRIPT ===\n\n'
      + 'The transcript above is finished. Write a brief, factual, PAST-TENSE recap of what '
      + 'happened across ALL of it: key events, actions, decisions, outcomes, and changes to the '
      + 'situation, locations, items, or relationships. Do NOT continue the story, do NOT add anything '
      + 'beyond the transcript, do NOT re-narrate it scene-by-scene. '
      + `Recap only, third person, at most ~${tokenCap} tokens.`;
    // Use the ISOLATED summarizer (generateRaw), not the in-story generateQuietPrompt —
    // otherwise the compaction block comes back as a story continuation rather than a
    // summary (the same issue fixed for the chronicle). generateChronicleSummary is the
    // shared isolated path (generateRaw + a permissive summarizer system prompt).
    return (await generateChronicleSummary(prompt) ?? '').trim();
  };

  const compaction = new Compaction({
    getChat: stShell.getChat,
    getMeta: stShell.getMeta,
    saveChat: stShell.saveChat,
    reloadChat: stShell.reloadChat,
    generateSummary: l3GenerateSummary,
    dropSnapshots: (ids) => engine.dropSnapshots(ids),
    genId: newId,
    settings: l3Settings,
    now: () => Date.now(),
  });

  const _tokCache = new Map();
  let _autoCompactBusy = false;
  let _lastNudgeAt = 0;
  const _tokenCountFn = (msg) => {
    const ctx = getContext();
    const fn = ctx.getTokenCountAsync;
    if (typeof fn === 'function') return fn(msg?.mes ?? '');
    return Math.ceil((msg?.mes ?? '').length / 4); // heuristic fallback
  };

  const _runAutoCompaction = async () => {
    if (_autoCompactBusy) return;
    const s = l3Settings();
    if (s.auto === 'off') return;
    _autoCompactBusy = true;
    try {
      const ctx = getContext();
      const chat = ctx.chat ?? [];
      if (chat.length < (s.recentWindow + s.minSize)) return; // nothing foldable yet
      const chatTokens = await estimateChatTokens(chat, _tokenCountFn, _tokCache);
      // API-aware: getMaxContextTokens() returns the ACTIVE API's real context
      // (e.g. oai_settings.openai_max_context for chat completion). ctx.maxContext
      // is only the text-completion `max_context` global and badly under-reads on
      // chat-completion APIs (made a 12k chat look 150%+ full). Fall back to it.
      const apiMax = (typeof getMaxContextTokens === 'function') ? getMaxContextTokens() : undefined;
      const contextSize = resolveContextSize(apiMax, ctx.maxContext);
      const decision = decideAutoCompact({ chatTokens, contextSize, settings: s });
      if (!decision) return;
      const pct = contextSize ? Math.round((chatTokens / contextSize) * 100) : '?';
      if (decision === 'silent') {
        await compaction.run({ count: s.batchSize });
      } else { // nudge — debounced, dismissible toast
        if (Date.now() - _lastNudgeAt < 60000) return;
        _lastNudgeAt = Date.now();
        toastr.info(`Context ~${pct}% full — click to compact the oldest ${s.batchSize} messages.`,
          'State Tracker', { timeOut: 12000, onclick: () => compaction.run({ count: s.batchSize }) });
      }
    } finally {
      _autoCompactBusy = false;
    }
  };

  engine.bus.on?.('tracker:pipeline-completed', () => { _runAutoCompaction(); });
  eventSource.on(event_types.MESSAGE_RECEIVED, () => { _runAutoCompaction(); });

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
    get debug() { return _strkSettings().debug === true; },
  });
  const descProbe = new DescriptionProbe(engine, {
    generateQuietPrompt: generateProbePrompt, // isolated, no chat context
    template: _strkSettings().templates?.probe,
    getProbeContext: () => {
      const chat = getContext().chat ?? [];
      const CTX = _strkSettings().probeContextTurns ?? 2; // last N user inputs + N narrator replies
      const inputs = [], replies = [];
      for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.extra?.from === 'state-referential') continue; // skip our own inserts
        if (m.is_user) { if (inputs.length < CTX) inputs.push(m.mes ?? ''); }
        else { if (replies.length < CTX) replies.push(m.mes ?? ''); }
        if (inputs.length >= CTX && replies.length >= CTX) break;
      }
      // Collected newest-first → reverse to chronological order, drop blanks, join.
      const lastInput = inputs.reverse().filter(Boolean).join('\n\n');
      const lastReply = replies.reverse().filter(Boolean).join('\n\n');
      return { lastInput, lastReply };
    },
  });
  const proseStore = {};
  const standalone = new StandaloneProbe(engine, { generateQuietPrompt, insertSmallSysMessage, proseStore });
  const injection = new Injection(engine, { setExtensionPrompt });
  // Layer 2 — create serverApi and worldBinding early (needed by Versioning)
  const serverApi = makeServerApi();
  const worldBinding = new WorldBinding(backend, serverApi, ctx);

  const versioning = new Versioning(engine, {
    eventSource, event_types,
    getChat: () => getContext().chat,
    getChatId: () => getContext().chatId,
    getChatMetadata: () => getContext().chatMetadata,
    worldBinding,
    autoUpdate, descProbe, standalone, injection,
    throttleMs: 500,
    get debug() { return _strkSettings().debug === true; },
  });

  // PRE-GENERATION: detect regenerate/swipe BEFORE the LLM call so we can
  // restore the engine to the relevant pre-message state. Without this,
  // GENERATE_BEFORE_COMBINE_PROMPTS reads still-dirty state and the AI sees
  // old outfit/state in the injection block even though the tracker UI
  // later reverts (post-MESSAGE_RECEIVED).
  //
  // GENERATION_STARTED fires with (type, options, dryRun) where type is one
  // of 'normal' | 'swipe' | 'regenerate' | 'continue' | 'impersonate' | 'quiet'.
  // Older ST versions may not emit this — handler simply never fires; no harm.
  const REGEN_TYPES = new Set(['regenerate', 'swipe']);
  if (event_types.GENERATION_STARTED) {
    eventSource.on(event_types.GENERATION_STARTED, async (type) => {
      if (!REGEN_TYPES.has(type)) return;
      // Find the last AI message in chat — that's the one being regenerated/swiped.
      const chat = getContext().chat ?? [];
      for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        const msgId = readTrackerMsgId(msg);
        if (!msgId) break;
        const snap = engine.loadSnapshot(msgId);
        if (snap) engine.restoreSnapshot(snap);
        break;
      }
    });
  }

  // Re-run injection just before generation — runs AFTER GENERATION_STARTED's
  // restore (sync handlers fire in order), so injection slots see the
  // already-reverted state.
  eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
    injection.run();
    chronicleInjection.run();
  });

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

  // ── Layer 2 — World Model ─────────────────────────────────────────────────────

  // World registry — in-memory list of worlds; loaded from server on init.
  const worldRegistry = new WorldRegistry(serverApi, { getDefaults: () => _strkSettings().world?.defaultChronicleConfig ?? {} });
  try { await worldRegistry.init(); }
  catch (e) { console.warn('[state-referential] world registry init failed (server plugin not installed?):', e?.message); }

  // Chronicle store — loaded per-world on CHAT_CHANGED; starts empty until a world is bound.
  let _chronicle = new ChronicleStore({});
  const getChronicle = () => _chronicle;
  const setChronicle = (c) => { _chronicle = c; chronicleInjection.chronicle = c; chronicleOps.chronicle = c; };

  // Chronicle injection — renders chronicle → setExtensionPrompt before each generation.
  const chronicleInjection = new ChronicleInjection(_chronicle, { setExtensionPrompt });

  // Chronicle ops — act-complete pipeline. Uses the ISOLATED summarizer
  // (generateRaw) so entries are summaries of what happened, not story continuations.
  const chronicleOps = new ChronicleOps(_chronicle, { generateQuietPrompt: generateChronicleSummary });

  // WorldBinder — bind/unbind current chat + data migration.
  const worldBinder = new WorldBinder(engine, worldRegistry, worldBinding, {
    getChatMetadata: () => getContext().chatMetadata,
    getChatId: () => getContext().chatId,
    saveChatConditional,
    ctx,
    getChronicle,
    setChronicle,
    serverApi,
  });

  // Soft lock.
  const worldLock = new WorldLock(serverApi);

  // When backend changes to a world backend, also load the chronicle for that world.
  engine.on('tracker:backend-changed', async () => {
    const worldId = worldBinding.currentWorldId;
    if (!worldId) { setChronicle(new ChronicleStore({})); chronicleInjection.run(); return; }
    try {
      const chronicleData = await serverApi.getChronicle(worldId);
      const worldMeta = worldRegistry.get(worldId);
      setChronicle(ChronicleStore.hydrate({
        ...chronicleData,
        config: worldMeta?.chronicleConfig,
      }));
      // Acquire soft lock for this world
      await worldLock.release();
      await worldLock.acquire(worldId).catch(e => console.warn('[state-referential] lock not acquired:', e.message));
    } catch (e) {
      console.warn('[state-referential] chronicle load failed:', e?.message);
      setChronicle(new ChronicleStore({}));
    }
    chronicleInjection.run();
  });

  // Release lock when navigating away (best-effort)
  window.addEventListener('beforeunload', () => worldLock.release());

  const persistChronicle = async () => {
    const worldId = worldBinding.currentWorldId;
    if (!worldId) return;
    await serverApi.putChronicle(worldId, _chronicle.serialize());
  };

  // Layer 2 UI — mount world manager inside the settings drawer section.
  const worldView = new WorldView(worldRegistry, {
    callGenericPopup, POPUP_TYPE, chronicleOps, getChronicle, chronicleInjection, serverApi,
    closePopup: ($f) => _closePopup($f),
    dialogs,
    persistChronicle,
  });
  const worldManager = new WorldManager(worldRegistry, {
    worldBinding, worldBinder, callGenericPopup, POPUP_TYPE, dialogs, serverApi,
    getWorldView: (id) => worldView.open(id),
  });
  // Mount world drawer as a top-level sibling of the State Tracker drawer
  const worldDrawerHtml = await loadTemplate('world-drawer');
  const $worldDrawer = $(worldDrawerHtml);
  $('#extensions_settings').append($worldDrawer);
  await worldManager.mount($('.strk-world-manager-mount', $worldDrawer));
  engine.on('tracker:backend-changed', () => worldManager.render());

  // Wire world settings controls (now in world-drawer, not settings-drawer)
  const _ws = () => { _strkSettings().world ??= {}; return _strkSettings().world; };
  $('#strk-world-prompt-enabled', $worldDrawer)
    .prop('checked', _ws().bindingPromptDisabled !== true)
    .on('change', e => { _ws().bindingPromptDisabled = !e.target.checked; saveSettingsDebounced(); });
  $('#strk-world-default-window', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.verbatimWindow ?? 5)
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.verbatimWindow = Number(e.target.value); saveSettingsDebounced(); });
  $('#strk-world-default-strategy', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.updateStrategy ?? 'lazy')
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.updateStrategy = e.target.value; saveSettingsDebounced(); });
  $('#strk-world-default-bp-cap', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.bigPictureTokenCap ?? 300)
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.bigPictureTokenCap = Number(e.target.value); saveSettingsDebounced(); });
  $('#strk-world-default-entry-cap', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.entryTokenCap ?? 200)
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.entryTokenCap = Number(e.target.value); saveSettingsDebounced(); });
  $('#strk-world-default-inject-bp', $worldDrawer)
    .prop('checked', _ws().defaultChronicleConfig?.injectBigPicture !== false)
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.injectBigPicture = e.target.checked; saveSettingsDebounced(); });
  $('#strk-world-default-inject-pos', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.injectPosition ?? 'in-prompt')
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.injectPosition = e.target.value; saveSettingsDebounced(); });
  $('#strk-world-default-inject-depth', $worldDrawer)
    .val(_ws().defaultChronicleConfig?.injectDepth ?? 4)
    .on('change', e => { _ws().defaultChronicleConfig ??= {}; _ws().defaultChronicleConfig.injectDepth = Number(e.target.value); saveSettingsDebounced(); });
  const _syncDefaultDepthVis = () => $('#strk-world-default-inject-depth-field', $worldDrawer).toggle($('#strk-world-default-inject-pos', $worldDrawer).val() === 'in-chat');
  $('#strk-world-default-inject-pos', $worldDrawer).on('change', _syncDefaultDepthVis);
  _syncDefaultDepthVis();

  // Binding prompt — shown on new chats
  const worldBindingPrompt = new WorldBindingPrompt(worldRegistry, {
    worldBinder,
    getSettings: _strkSettings,
    saveSettingsDebounced,
  });

  // Show binding prompt when a NEW chat is detected (no messages yet, no worldId bound).
  const _maybeShowBindingPrompt = async () => {
    const chatMeta = getContext().chatMetadata ?? {};
    if (chatMeta.trackerWorldId) return; // already bound
    const chat = getContext().chat ?? [];
    if (chat.length > 0) return; // not a new chat
    if (_strkSettings().world?.bindingPromptDisabled) return;
    // Small delay to let ST finish rendering the new chat UI
    await new Promise(r => setTimeout(r, 500));
    await worldBindingPrompt.show();
  };
  eventSource.on(event_types.CHAT_CHANGED, _maybeShowBindingPrompt);

  // Nudge: when a bound chat accumulates many messages since the last act, suggest
  // marking one. Fires once per threshold crossing (every 25 msgs) to avoid spam.
  let _lastActNudgeAt = 0;
  const ACT_NUDGE_INTERVAL = 25;
  eventSource.on(event_types.MESSAGE_RECEIVED, () => {
    if (!worldBinding.currentWorldId) return;
    if (_strkSettings().world?.actNudgeDisabled) return;
    const count = chronicleOps.countSinceLastAct(getContext().chat ?? []);
    const milestone = Math.floor(count / ACT_NUDGE_INTERVAL) * ACT_NUDGE_INTERVAL;
    if (milestone >= ACT_NUDGE_INTERVAL && milestone !== _lastActNudgeAt) {
      _lastActNudgeAt = milestone;
      toastr.info(`${count} messages since the last act — consider /world-act-complete`, 'World Chronicle', { timeOut: 8000 });
    } else if (milestone < _lastActNudgeAt) {
      _lastActNudgeAt = milestone; // reset after an act is marked
    }
  });

  // Robust popup dismissal — ST's popup markup varies across versions.
  // Try native <dialog>.close(), then various known close-button selectors, then Escape.
  const _closePopup = ($contentJq) => {
    // Strategy 1: click ST's own close button so the Popup teardown runs (close
    // animation, DOM removal, promise resolution). The native <dialog>.close()
    // bypasses that bookkeeping and leaves the dialog lingering in the background
    // (you'd see just its circular ✕ peeking at the screen edge), so prefer this.
    const $popup = $contentJq.closest('.popup, .popup_container, .dialogue_popup');
    const closeSelectors = [
      '.popup-button-close', '.popup_cross', '.popup_close',
      '.menu_button.popup_button_cancel', '.popup_button_cancel', '.popup-button-cancel',
      '.fa-times', '.fa-xmark', '.fa-circle-xmark',
    ];
    for (const sel of closeSelectors) {
      const $btn = $popup.find(sel).first();
      if ($btn.length) { $btn.trigger('click'); return; }
    }
    // Strategy 2: native <dialog> close (only if no ST close button is present).
    const $dialog = $contentJq.closest('dialog');
    if ($dialog.length && typeof $dialog[0].close === 'function') {
      $dialog[0].close();
      return;
    }
    // Strategy 3: Escape key dispatched on document
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  const openSceneRosterModal = async () => {
    const html = await loadTemplate('scene-roster-modal');
    const $f = $(html);

    const ROLE_ORDER = ['protagonist', 'npc', 'location', 'faction', 'object'];
    const ROLE_LABELS = { protagonist: 'Protagonist', npc: 'NPCs', location: 'Locations', faction: 'Factions', object: 'Objects' };

    const renderGroups = () => {
      const $container = $('#strk-roster-groups', $f).empty();
      const subjects = engine.listSubjects();
      const byRole = {};
      for (const s of subjects) {
        if (!byRole[s.role]) byRole[s.role] = [];
        byRole[s.role].push(s);
      }
      for (const role of ROLE_ORDER) {
        const group = byRole[role];
        if (!group?.length) continue;
        const $group = $('<div class="strk-roster-group"></div>');
        $group.append($('<div class="strk-roster-role-header"></div>').text(ROLE_LABELS[role] ?? role));
        for (const s of group) {
          const isProtag = s.role === 'protagonist';
          const active = engine.isSubjectActive(s.id);
          const $row = $('<div class="strk-roster-row"></div>');
          const $cb = $(`<input type="checkbox"${active ? ' checked' : ''}${isProtag ? ' disabled' : ''}/>`);
          if (!isProtag) {
            $cb.on('change', e => {
              engine.setSubjectActive(s.id, e.target.checked);
            });
          }
          $row.append($cb);
          const $label = $('<span class="strk-roster-name"></span>').text(s.name);
          $row.append($label);
          if (isProtag) $row.append($('<span class="strk-roster-protag-badge"></span>').text('protagonist'));
          $group.append($row);
        }
        $container.append($group);
      }
    };

    renderGroups();
    const onChanged = () => renderGroups();
    engine.on('tracker:subject-active-changed', onChanged);
    engine.on('tracker:subject-added', onChanged);
    engine.on('tracker:subject-removed', onChanged);

    const cleanup = () => {
      engine.off('tracker:subject-active-changed', onChanged);
      engine.off('tracker:subject-added', onChanged);
      engine.off('tracker:subject-removed', onChanged);
    };

    $('#strk-roster-close', $f).on('click', () => { cleanup(); _closePopup($f); });
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', {});
    cleanup();
  };

  const openProseModal = async ({ title, text, name, turns, textLabel, onSave, onRefresh }) => {
    const html = await loadTemplate('prose-edit-modal');
    const $f = $(html);
    $('#strk-prose-title', $f).text(title);
    // Description / text box — hidden when text is explicitly undefined (e.g. renaming
    // a non-describable entry, where there's no prose to edit).
    if (text === undefined) {
      $('#strk-prose-text-row', $f).hide();
    } else {
      $('#strk-prose-text', $f).val(text ?? '');
      if (textLabel) $('#strk-prose-text-label', $f).text(textLabel);
    }
    // Optional Name field (enables rename from the detail popup).
    const hasName = name !== undefined && name !== null;
    if (hasName) { $('#strk-prose-name-row', $f).show(); $('#strk-prose-name', $f).val(name); }
    // Optional Turns field (countdown list entries).
    const hasTurns = turns && Number.isFinite(turns.value);
    if (hasTurns) {
      $('#strk-prose-turns-row', $f).show();
      $('#strk-prose-turns', $f).val(turns.value);
      if (turns.max != null) $('#strk-prose-turns', $f).attr('max', turns.max);
    }
    // Re-probe only makes sense for AI-described values; hide it otherwise.
    if (!onRefresh) $('#strk-prose-refresh', $f).hide();
    $('#strk-prose-save', $f).on('click', () => {
      const extra = {};
      if (hasName) extra.name = String($('#strk-prose-name', $f).val() ?? '').trim();
      if (hasTurns) { const n = parseInt($('#strk-prose-turns', $f).val(), 10); extra.turns = Number.isFinite(n) ? n : undefined; }
      onSave?.($('#strk-prose-text', $f).val(), extra);
      _closePopup($f);
    });
    $('#strk-prose-refresh', $f).on('click', async () => {
      if (!onRefresh) return;
      const $btn = $('#strk-prose-refresh', $f);
      const $ta = $('#strk-prose-text', $f);
      const origLabel = $btn.text();
      $btn.prop('disabled', true).text('Generating…');
      $ta.prop('disabled', true);
      try {
        // onRefresh awaits the probe and resolves to the freshly generated prose (or null).
        const fresh = await onRefresh();
        if (fresh) $ta.val(fresh);
        else toastr.info('No new description was generated.', 'Re-probe');
      } catch (e) {
        toastr.error(e?.message ?? String(e), 'Re-probe failed');
      } finally {
        $btn.prop('disabled', false).text(origLabel);
        $ta.prop('disabled', false);
      }
    });
    // Cancel: close via the robust helper
    $('#strk-prose-cancel', $f).on('click', () => _closePopup($f));
    await callGenericPopup($f[0], POPUP_TYPE.DISPLAY, '', { wide: true });
  };

  const openSubjectAddModal = async (opts = {}) => {
    const html = await loadTemplate('subject-add-modal');
    const $f = $(html);
    if (opts.forceProtagonist) { $('#strk-subj-role', $f).val('protagonist').prop('disabled', true); $('#strk-subject-modal-title', $f).text('Create protagonist'); }
    else { $('#strk-subj-role', $f).val(engine.protagonist() ? 'npc' : 'protagonist'); }
    // Show traits only for person-like roles; hide for location/faction/object.
    const PERSON_ROLES = new Set(['protagonist', 'npc']);
    const $traitsBlock = $('.strk-traits', $f);
    const syncTraits = () => $traitsBlock.toggle(PERSON_ROLES.has($('#strk-subj-role', $f).val()));
    $('#strk-subj-role', $f).on('change', syncTraits);
    syncTraits();
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
    openSceneRosterModal,
    requestProbe: (subjId, trackerId, fieldId, value) => {
      const rp = _strkSettings().reprobeProfile;
      const profile = (rp && rp !== 'field') ? rp : undefined;
      descProbe.enqueue([{ subjectId: subjId, trackerId, fieldId, value, profile }]);
      return descProbe.drain();
    },
    runManualProbe: (trackerId, subject) => standalone.runOne(trackerId, subject),
    descProbe,
    // Merge built-in defaults with user-added so the chips always include the
    // baseline set even when defaultTags setting is empty.
    getDefaultTags: () => {
      const builtins = ['combat', 'exploration', 'social', 'fashion', 'sexual'];
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
  Macros.register(engine, {
    macros, MacrosParser, proseStore,
    getWorldMeta: () => worldBinding.currentWorldId ? worldRegistry.get(worldBinding.currentWorldId) : null,
    getChronicle,
    getChat: () => getContext().chat,
  });
  SlashCommands.register(engine, {
    SlashCommandParser, SlashCommand, panel, dialogs, autoUpdate, injection, standalone,
    getExtensionSettings: () => extension_settings, saveSettingsDebounced,
    worldRegistry, worldBinding, worldBinder, serverApi,
    chronicleOps, getChronicle, chronicleInjection, persistChronicle,
    getChat: () => getContext().chat,
    getCurrentMsgId: () => {
      const chat = getContext().chat;
      return chat?.length ? (readTrackerMsgId(chat[chat.length - 1]) ?? null) : null;
    },
  });

  // ── Layer 3 — Branch creation ─────────────────────────────────────────────────
  const branchCreate = async ({ title, lastN, inheritTags }) => {
    const ctx = getContext();
    const worldId = worldBinding.currentWorldId;
    if (!worldId) { toastr.warning('Branch: this chat is not bound to a World.'); return; }
    const world = worldRegistry.get(worldId);
    if (!world) { toastr.warning('Branch: World not found in registry.'); return; }
    if (world?.openBranchChatId) { toastr.warning('A branch is already open — fold or discard it first.'); return; }

    const mainId = ctx.chatId;
    const mainChat = ctx.chat ?? [];
    const branchFromMessageId = readTrackerMsgId(mainChat[mainChat.length - 1]);

    // 1. snapshot the World state at the branch point + pin it as the undo target
    const snapshotKey = `branch:${newId()}`;
    const snap = engine.snapshot(snapshotKey);
    engine.snapshots.save(snapshotKey, snap);
    engine.pinSnapshot(snapshotKey, 'branch-start');
    await engine.backend?.flush?.(); // persist the pinned branch-start snapshot to the server BEFORE doNewChat re-hydrates the World backend (else discard can't restore it)

    // 2. build seamless seed context: recap-of-pre-N + last N verbatim.
    //    No framing/seed prompt — the branch just continues the story. The recap
    //    reuses the SAME summarizer as compaction (l3GenerateSummary: transcript-
    //    then-instruction via the isolated generateRaw path, same tokenCap) so the
    //    two paths can't drift.
    const { toRecap, verbatim } = splitForSeed(mainChat, lastN);
    const recapText = toRecap.length ? await l3GenerateSummary(toRecap, l3Settings().tokenCap) : '';
    const verbatimCopies = verbatim.map(m => ({ ...m, extra: { ...(m.extra ?? {}) } }));

    // 3. create the scene chat, rename it to "<mainline> - branch - <ts>" for
    //    findability (while it's still empty), then seed it. Rename changes the
    //    chat file → re-read the id; any failure falls back to ST's default name.
    await doNewChat();
    let branchId = getContext().chatId;
    try {
      const c = getContext();
      const desired = sceneChatName(mainId, branchId);
      if (typeof c.renameChat === 'function' && desired !== branchId) {
        await c.renameChat(branchId, desired);
        branchId = getContext().chatId; // renamed (+ server-sanitized) → id changed
      }
    } catch (e) {
      console.warn('[state-referential] scene rename failed; keeping default chat name:', e?.message);
      branchId = getContext().chatId;
    }
    const bc = getContext().chat;
    if (recapText) bc.push(buildSyntheticMessage({ kind: 'branch-seed-recap', name: 'Story so far', mes: recapText, smallSys: false }));
    for (const m of verbatimCopies) bc.push(m);
    const seedMessageCount = bc.length; // boundary between injected context and new side-scene play (used by 3b fold-back)

    // 4. bind to the World as a branch (shared backend) + write l3BranchMeta
    await worldBinder.bindCurrentChat(worldId, 'branch');
    const meta = getContext().chatMetadata;
    meta.l3BranchMeta = buildBranchMeta({ mainlineChatId: mainId, branchFromMessageId, snapshotKey, title, lastN, seedMessageCount, now: Date.now() });
    if (inheritTags) meta.l3InheritedTags = engine.listActiveTags?.() ?? [];

    // 5. lock + registry + persist
    // Mutate the in-registry world object then persist via worldRegistry.update
    // (mirrors the pattern in WorldBinder/WorldRegistry which calls serverApi.patchMeta).
    addBranchRecord(world, { chatId: branchId, title, status: 'open', branchFromMessageId, createdAt: Date.now() });
    world.openBranchChatId = branchId;
    await worldRegistry.update(worldId, { openBranchChatId: branchId, branches: world.branches });
    await saveChatConditional();
    await getContext().reloadCurrentChat();
  };

  const branchDiscard = async () => {
    const ctx = getContext();
    const meta = ctx.chatMetadata;
    const bm = meta?.l3BranchMeta;
    if (!bm) { toastr.warning('Not in a branch chat.'); return; }
    const worldId = worldBinding.currentWorldId;
    if (!worldId) { toastr.warning('Branch: no bound World.'); return; }
    const branchChatId = ctx.chatId;

    // 1. roll the World tracker state back to the branch-start snapshot (undo the
    //    side-scene), then drop that undo-point — it's consumed now, and leaving it
    //    pinned leaks into the snapshot store (and the delete-restore orphan scan).
    const snap = engine.loadSnapshot(bm.snapshotKey);
    if (snap) engine.restoreSnapshot(snap);
    engine.unpinSnapshot(bm.snapshotKey);
    engine.dropSnapshots([bm.snapshotKey]);
    // Flush the debounced PUTs that restoreSnapshot + the drop triggered so the
    // rolled-back World state AND the pin removal land on the server BEFORE
    // openCharacterChat fires CHAT_CHANGED and the mainline re-hydrates.
    await engine.backend?.flush?.();

    // 2. mark this branch's metadata discarded
    const discardedAt = Date.now();
    meta.l3BranchMeta.discardedAt = discardedAt;
    await saveChatConditional();

    // 3. update the World registry (status discarded) + clear the lock, persisted in one patch.
    //    NOTE: worldRegistry.update replaces the entry; build the patch from a fresh read, do not
    //    rely on a stale local world ref after updating.
    const world = worldRegistry.get(worldId);
    if (world) {
      setBranchStatus(world, branchChatId, 'discarded', { discardedAt });
      await worldRegistry.update(worldId, { openBranchChatId: null, branches: world.branches });
    }

    // 4. return to the mainline
    try {
      const c = getContext();
      if (typeof c.openCharacterChat === 'function') await c.openCharacterChat(bm.mainlineChatId);
      else console.warn('[state-referential] branchDiscard: no openCharacterChat on context; cannot switch to', bm.mainlineChatId);
    } catch (e) {
      console.warn('[state-referential] branchDiscard: failed to open mainline chat', bm.mainlineChatId, e?.message);
    }
  };

  const branchReturn = async () => {
    const ctx = getContext();
    const meta = ctx.chatMetadata;
    const bm = meta?.l3BranchMeta;
    if (!bm) { toastr.warning('Not in a branch chat.'); return; }
    if (bm.foldedAt || bm.discardedAt) { toastr.warning('This branch is already closed.'); return; }
    const worldId = worldBinding.currentWorldId;
    if (!worldId) { toastr.warning('Branch: no bound World.'); return; }
    const branchChatId = ctx.chatId;

    // 1. summarize the side-scene PLAY (messages after the seeded context).
    //    Reuse the shared summarizer (transcript-then-instruction, isolated generateRaw).
    //    An empty scene (no new play) gets no recap — nothing is spliced (step 4).
    const play = playRange(ctx.chat ?? [], bm);
    const recap = play.length ? await l3GenerateSummary(play, l3Settings().tokenCap) : '';

    // 2. mark THIS branch folded + persist BEFORE switching away (chat-scoped meta).
    const foldedAt = Date.now();
    meta.l3BranchMeta.foldedAt = foldedAt;
    await saveChatConditional();

    // 2b. drop the branch-start undo-point — the scene is kept, so it's no longer
    //     needed and would otherwise leak into the snapshot store. Flush so the
    //     pin removal lands BEFORE the switch re-hydrates the World backend.
    engine.unpinSnapshot(bm.snapshotKey);
    engine.dropSnapshots([bm.snapshotKey]);
    await engine.backend?.flush?.();

    // 3. switch to the mainline so the splice lands in ITS chat array.
    //    Returning changes no tracker state beyond the dropped pin above.
    try {
      const c = getContext();
      if (typeof c.openCharacterChat === 'function') await c.openCharacterChat(bm.mainlineChatId);
      else console.warn('[state-referential] branchReturn: no openCharacterChat; cannot switch to', bm.mainlineChatId);
    } catch (e) {
      console.warn('[state-referential] branchReturn: failed to open mainline chat', bm.mainlineChatId, e?.message);
    }

    // 4. if the scene produced any play, splice its recap into the mainline after the
    //    branch point (else tail), as PLAIN narration — no "folded from branch" label,
    //    name = the mainline narrator. An empty scene folds in nothing.
    const mainChat = getContext().chat ?? [];
    const anchorId = recap ? foldbackAnchorId(mainChat, bm.branchFromMessageId) : null;
    if (recap && anchorId) {
      await insertSyntheticAfter(stShell, {
        afterTrackerMsgId: anchorId,
        ...buildFoldbackMarker({ title: bm.title, recap, branchChatId, name: getContext().name2 }),
      });
    } else if (recap) {
      console.warn('[state-referential] branchReturn: no anchor message in mainline; recap not spliced');
    }

    // 5. mark folded in the registry + clear the lock (re-read; do not trust a stale ref).
    const world = worldRegistry.get(worldId);
    if (world) {
      setBranchStatus(world, branchChatId, 'folded', { foldedAt });
      await worldRegistry.update(worldId, { openBranchChatId: null, branches: world.branches });
    }
    toastr.success(`Returned from "${bm.title}".`);
  };

  // Drop the branch-start (undo-point) snapshots left behind by closed scenes.
  // Each scene pins a `branch:` snapshot for its discard undo; those are only
  // needed while the scene is open, but nothing currently unpins them, so they
  // accumulate in the World snapshot store. Keep the snapshot for the scene
  // you're currently in; drop the rest. Refuse if a scene is open elsewhere
  // (we can't tell which pin to keep without being inside it).
  const branchPrune = async () => {
    const ctx = getContext();
    const worldId = worldBinding.currentWorldId;
    if (!worldId) { toastr.warning('Scene prune: this chat is not bound to a World.'); return; }
    const world = worldRegistry.get(worldId);
    const openId = world?.openBranchChatId ?? null;
    const keepKey = ctx.chatMetadata?.l3BranchMeta?.snapshotKey ?? null;
    if (openId && ctx.chatId !== openId) {
      toastr.warning('A scene is open — run /scene-prune from inside it (or /scene-end / /scene-discard first).');
      return;
    }
    const dropping = engine.listSnapshots()
      .filter(s => s.pinned && String(s.msgId).startsWith('branch:') && s.msgId !== keepKey)
      .map(s => s.msgId);
    if (!dropping.length) { toastr.info('No closed-scene snapshots to prune.'); return; }
    for (const id of dropping) engine.unpinSnapshot(id);
    engine.dropSnapshots(dropping);
    await engine.backend?.flush?.();
    toastr.success(`Pruned ${dropping.length} closed-scene snapshot${dropping.length === 1 ? '' : 's'}.`);
  };

  // Layer 3 slash commands.
  registerL3Commands({
    SlashCommandParser: getContext().SlashCommandParser,
    SlashCommand: getContext().SlashCommand,
    compaction,
    restore: (id) => restoreArchive(stShell, id),
    actComplete: (title) => actCompleteMarker({ shell: stShell, chronicleOps, persistChronicle, chronicleInjection }, { title }),
    toggleAnchorAtSlash: (reason) => {
      const chat = getContext().chat ?? [];
      const msg = chat[chat.length - 1];
      if (!msg) return false;
      const on = toggleAnchor(msg, reason, Date.now());
      saveChatConditional();
      return on;
    },
    gotoMainline: async () => {
      // worldBinding exposes only currentWorldId; the world object (with
      // mainlineChatId) lives in the registry. Resolve the id reliably, then
      // best-effort switch via ST's chat-open API (signature varies by version).
      const worldId = worldBinding.currentWorldId;
      const mainlineId = worldId ? worldRegistry.get(worldId)?.mainlineChatId : null;
      if (!mainlineId) return;
      try {
        const c = getContext();
        if (typeof c.openCharacterChat === 'function') await c.openCharacterChat(mainlineId);
        else console.warn('[state-referential] /mainline-go: no openCharacterChat on context; cannot switch to', mainlineId);
      } catch (e) {
        console.warn('[state-referential] /mainline-go: failed to open mainline chat', mainlineId, e?.message);
      }
    },
    branchCreate,
    branchDiscard,
    branchReturn,
    branchPrune,
    branchLastN: () => l3Settings().branchLastN ?? 10,
  });

  mountMessageButtons({
    $: window.jQuery ?? window.$,
    getChat: () => getContext().chat,
    eventSource,
    event_types,
    saveChat: () => saveChatConditional(),
  });

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
    setSubjectActive: (id, active) => engine.setSubjectActive(id, active),
    isSubjectActive: (id) => engine.isSubjectActive(id),

    getField: (...a) => engine.getField(...a),
    setField: (...a) => engine.setField(...a),
    applyDelta: (...a) => engine.applyDelta(...a),
    addListEntry: (...a) => engine.addListEntry(...a),
    removeListEntry: (...a) => engine.removeListEntry(...a),
    getListMeta: (...a) => engine.getListMeta(...a),
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

    // Layer 2
    worldRegistry,
    worldBinding,
    worldBinder,
    getChronicle,
    chronicleOps,

    // Layer 3
    branchCreate: (opts) => branchCreate(opts),
    branchDiscard: () => branchDiscard(),
    compactNow: (count) => compaction.run(count ? { count } : {}),
    restoreArchive: (id) => restoreArchive(stShell, id),
    actComplete: (title) => actCompleteMarker({ shell: stShell, chronicleOps, persistChronicle, chronicleInjection }, { title }),
    insertSyntheticAfter: (opts) => insertSyntheticAfter(stShell, opts),
    countAnchors: () => countAnchors(getContext().chat ?? []),

    on: (e, fn) => engine.on(e, fn),
    off: (e, fn) => engine.off(e, fn),

    // Unstable: direct engine reference for debugging only — not part of public spec.
    _engine: engine,
  };

  console.log('[state-referential] ready — build 2026-06-27-struct-list');
})();
