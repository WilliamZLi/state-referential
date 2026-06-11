import { ensureTrackerMsgId, readTrackerMsgId } from '../util/id.js';

export class Versioning {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { eventSource, event_types, getChat, getChatMetadata?, worldBinding?,
   *                          autoUpdate, descProbe, standalone, injection, throttleMs }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._busy = false;
    this._throttle = deps.throttleMs ?? 500;
  }

  register() {
    const { eventSource, event_types } = this.deps;
    eventSource.on(event_types.MESSAGE_RECEIVED, (i) => { this._dbg('MESSAGE_RECEIVED', i, '→ _onReceived (will re-derive)'); return this._onReceived(i); });
    eventSource.on(event_types.MESSAGE_SWIPED, (i) => { this._dbg('MESSAGE_SWIPED', i, '→ _onSwiped (restore + re-derive)'); return this._onSwiped(i); });
    eventSource.on(event_types.MESSAGE_EDITED, (i) => { this._dbg('MESSAGE_EDITED', i, '→ _onEdited (NO-OP, state left alone)'); return this._onEdited(i); });
    eventSource.on(event_types.MESSAGE_DELETED, (i) => { this._dbg('MESSAGE_DELETED', i, '→ _onDeleted (snapshot restore)'); return this._onDeleted(i); });
    eventSource.on(event_types.CHAT_CHANGED, () => { this._dbg('CHAT_CHANGED', null, '→ _onChatChanged (backend swap)'); return this._onChatChanged(); });
  }

  _dbg(event, index, note) {
    if (this.deps.debug) console.debug(`[state-referential][stateflow] ${event}`, index ?? '', note);
  }

  async _onReceived(index) {
    if (this._busy) return;
    const chat = this.deps.getChat();
    const msg = chat[index];
    if (!msg || msg.is_user) return;
    if (msg.extra?.from === 'state-referential') return; // skip our own inserts

    if (this._throttle) await new Promise(r => setTimeout(r, this._throttle));

    this._busy = true;
    const msgId = ensureTrackerMsgId(msg);
    let snapshotBefore;
    const changedTrackerIds = new Set();
    const _valueChangedHandler = (e) => changedTrackerIds.add(e.tracker);
    this.engine.on('tracker:value-changed', _valueChangedHandler);
    try {
      // If we've already snapshotted this msgId, this is a regenerate / re-receive
      // (ST's ♻️ button replaces msg.mes in-place and fires MESSAGE_RECEIVED only —
      // no MESSAGE_SWIPED, so _onSwiped's restore step doesn't run). Restore from
      // the original pre-N snapshot so autoupdate sees the same starting state as
      // the first time. Otherwise we'd overwrite the pre-state with the now-dirty
      // post-N values and outfit/state changes from the old generation would stick.
      const existingSnapshot = this.engine.loadSnapshot(msgId);
      if (existingSnapshot) {
        this.engine.restoreSnapshot(existingSnapshot);
        snapshotBefore = existingSnapshot;
      } else {
        snapshotBefore = this.engine.snapshot(msgId);
        this.engine.snapshots.save(msgId, snapshotBefore);
      }
      let lastUserMessage = '';
      for (let i = index - 1; i >= 0; i--) {
        if (chat[i]?.is_user) { lastUserMessage = chat[i].mes ?? ''; break; }
      }
      const result = await this.deps.autoUpdate.run({ lastNarratorReply: msg.mes ?? '', lastUserMessage, msgId });
      // descProbe queue is filled by AutoUpdate via tracker:value-changed listener wired in Phase 8;
      // for now, fire drain regardless — implementation can be a no-op if queue empty.
      await this.deps.descProbe.drain();
      const subject = this.engine.protagonist();
      if (subject) await this.deps.standalone.run({ changedTrackerIds, subject });
      this.deps.injection.run();
    } catch (e) {
      console.error('[state-referential] pipeline error', e);
      if (snapshotBefore) this.engine.restoreSnapshot(snapshotBefore);
    } finally {
      this.engine.off('tracker:value-changed', _valueChangedHandler);
      this._busy = false;
      this.engine.bus.emit('tracker:pipeline-completed', {});
    }
  }

  async _onSwiped(index) {
    const chat = this.deps.getChat();
    const msg = chat[index];
    if (!msg) return;
    const msgId = readTrackerMsgId(msg);
    if (msgId) {
      const snap = this.engine.loadSnapshot(msgId);
      if (snap) this.engine.restoreSnapshot(snap);
    }
    await this._onReceived(index);
  }

  _onEdited(_index) {
    // Editing an AI message is a manual prose tweak — the user is keeping the
    // generation and just adjusting wording — so we deliberately do NOT re-run the
    // pipeline: no state re-extraction, no re-probe. The state already reflects this
    // message from when it was first received. New AI content still re-derives via
    // its own events: a fresh reply / regenerate (♻️) fires MESSAGE_RECEIVED, and a
    // swipe fires MESSAGE_SWIPED.
  }

  _onDeleted(index) {
    // MESSAGE_DELETED firing-order varies by ST version: some emit BEFORE the
    // chat splice, others AFTER. We handle both.
    //
    // Snapshot semantics: snapshot[X] is taken BEFORE X's auto-update runs,
    // capturing the state as it existed just before X was processed — which is
    // exactly the state we want to restore to when X is deleted.
    //
    // Strategy:
    //   1. POST-splice path: find orphan snapshots (msgIds not in chat).
    //      Earliest orphan = the earliest deleted message; restore from it,
    //      drop all orphans to keep store clean.
    //   2. PRE-splice fallback: if no orphans but chat[index] still has the
    //      message being deleted, restore from its snapshot directly. The
    //      snapshot will become an orphan after ST splices; CHAT_CHANGED
    //      cleanup or a subsequent delete will drop it.
    const chat = this.deps.getChat();
    const liveIds = new Set(chat.map(m => readTrackerMsgId(m)).filter(Boolean));
    const orphans = this.engine.listSnapshots()
      .filter(s => !liveIds.has(s.msgId))
      .sort((a, b) => a.takenAt - b.takenAt);

    if (orphans.length) {
      const snap = this.engine.loadSnapshot(orphans[0].msgId);
      if (snap) this.engine.restoreSnapshot(snap);
      this.engine.dropSnapshots(orphans.map(s => s.msgId));
      // Re-emit after drop so the panel re-renders with the now-clean snapshot list.
      // restoreSnapshot already fired tracker:backend-changed before the drop, so
      // countdown badges would show stale counts without this second signal.
      this.engine.bus.emit('tracker:state-restored', {});
      // Refresh the injected itemization. restoreSnapshot emits tracker:state-restored,
      // not tracker:value-changed, so EventHooks' injection refresh never fires — the
      // prompt block would otherwise still list the deleted gens' values. Mirrors the
      // injection.run() in _onReceived and _onChatChanged.
      this.deps.injection?.run?.();
      return;
    }
    // Pre-splice fallback: chat[index] may still hold the message being deleted.
    const atIndex = chat[index];
    if (atIndex) {
      const id = readTrackerMsgId(atIndex);
      const snap = id ? this.engine.loadSnapshot(id) : null;
      if (snap) {
        this.engine.restoreSnapshot(snap);
        this.deps.injection?.run?.();
      }
    }
  }

  async _onChatChanged() {
    // Block MESSAGE_RECEIVED processing during backend selection.
    // This is Layer 2's IS_BUSY semantics (spec §4.0).
    this._busy = true;

    // Select the correct backend for the newly-loaded chat.
    // If worldBinding is wired, it fetches the world data from the server
    // and returns a WorldScopedBackend; otherwise returns the chat-scoped backend.
    let backend = this.engine.backend;
    if (this.deps.worldBinding) {
      const chatMeta = this.deps.getChatMetadata?.();
      try {
        backend = await this.deps.worldBinding.selectBackend(chatMeta);
      } catch (e) {
        console.error('[state-referential] _onChatChanged world backend error:', e);
        backend = this.engine.backend;
      }
    }

    backend.invalidate?.();
    this.engine.setStorageBackend(backend);

    // Migration sweep: hoist any legacy in-extra msgIds to the top level on
    // every AI message so the first swipe/regen after a fresh load doesn't
    // lose the id when ST replaces msg.extra per swipe.
    const chat = this.deps.getChat?.() ?? [];
    for (const msg of chat) {
      if (!msg || msg.is_user) continue;
      readTrackerMsgId(msg);
    }

    // Cleanup: drop orphan snapshots that accumulated from forward-swipes.
    const liveIds = new Set(chat.map(m => readTrackerMsgId(m)).filter(Boolean));
    const orphanIds = this.engine.listSnapshots()
      .filter(s => !liveIds.has(s.msgId))
      .map(s => s.msgId);
    if (orphanIds.length) {
      this.engine.dropSnapshots(orphanIds);
      this.engine.bus.emit('tracker:state-restored', {});
    }

    this.deps.injection?.run?.();
    this._busy = false;
  }
}
