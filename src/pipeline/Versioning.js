import { ensureTrackerMsgId, readTrackerMsgId } from '../util/id.js';

export class Versioning {
  /**
   * @param {TrackerEngine} engine
   * @param {object} deps - { eventSource, event_types, getChat, autoUpdate, descProbe, standalone, injection, throttleMs }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps;
    this._busy = false;
    this._throttle = deps.throttleMs ?? 500;
  }

  register() {
    const { eventSource, event_types } = this.deps;
    eventSource.on(event_types.MESSAGE_RECEIVED, (i) => this._onReceived(i));
    eventSource.on(event_types.MESSAGE_SWIPED, (i) => this._onSwiped(i));
    eventSource.on(event_types.MESSAGE_EDITED, (i) => this._onEdited(i));
    eventSource.on(event_types.MESSAGE_DELETED, (i) => this._onDeleted(i));
    eventSource.on(event_types.CHAT_CHANGED, () => this._onChatChanged());
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
      const result = await this.deps.autoUpdate.run({ lastNarratorReply: msg.mes ?? '', msgId });
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

  async _onEdited(index) {
    const chat = this.deps.getChat();
    const msg = chat[index];
    if (!msg || msg.is_user) return; // user edits don't drive auto-update
    await this._onSwiped(index);
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
      return;
    }
    // Pre-splice fallback: chat[index] may still hold the message being deleted.
    const atIndex = chat[index];
    if (atIndex) {
      const id = readTrackerMsgId(atIndex);
      const snap = id ? this.engine.loadSnapshot(id) : null;
      if (snap) this.engine.restoreSnapshot(snap);
    }
  }

  _onChatChanged() {
    this._busy = false;
    this.engine.backend.invalidate?.();
    this.engine.setStorageBackend(this.engine.backend);
    // Migration sweep: hoist any legacy in-extra msgIds to the top level on
    // every AI message so the first swipe/regen after a fresh load doesn't
    // lose the id when ST replaces msg.extra per swipe.
    const chat = this.deps.getChat?.() ?? [];
    for (const msg of chat) {
      if (!msg || msg.is_user) continue;
      readTrackerMsgId(msg); // side-effect: lazy hoist legacy → top-level
    }
    // Cleanup pass: drop orphan snapshots — these accumulate from pre-fix
    // forward-swipes that minted new msgIds while abandoning old ones.
    // Without this, _onDeleted's "earliest orphan" heuristic can land on
    // ancient cruft and restore to a wrong state.
    const liveIds = new Set(chat.map(m => readTrackerMsgId(m)).filter(Boolean));
    const orphanIds = this.engine.listSnapshots()
      .filter(s => !liveIds.has(s.msgId))
      .map(s => s.msgId);
    if (orphanIds.length) {
      this.engine.dropSnapshots(orphanIds);
      // Re-emit so the panel re-renders with the clean snapshot list — same
      // reasoning as in _onDeleted: setStorageBackend already fired
      // tracker:backend-changed before the drop, leaving stale counts.
      this.engine.bus.emit('tracker:state-restored', {});
    }
    this.deps.injection?.run?.();
  }
}
