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
      snapshotBefore = this.engine.snapshot(msgId);
      this.engine.snapshots.save(msgId, snapshotBefore);
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

  _onDeleted(/* index */) {
    // MESSAGE_DELETED fires after ST has removed the message from chat. The
    // deleted message's msgId is no longer present in chat[], but its snapshot
    // still lives in the snapshot store.
    //
    // Snapshot semantics: snapshot[X] is taken BEFORE X's auto-update runs, so
    // it captures the state as it existed just before X was processed — which
    // is exactly the state we want to restore to when X is deleted (effectively
    // "as if X never happened").
    //
    // Strategy:
    //   1. Find all orphan snapshots (msgIds not in current chat).
    //   2. Sort by takenAt ascending. The EARLIEST orphan = the earliest deleted
    //      message; its snapshot is the state we want.
    //   3. Restore from it, then drop all orphan snapshots so they don't pile up.
    const chat = this.deps.getChat();
    const liveIds = new Set(chat.map(m => readTrackerMsgId(m)).filter(Boolean));
    const orphans = this.engine.listSnapshots()
      .filter(s => !liveIds.has(s.msgId))
      .sort((a, b) => a.takenAt - b.takenAt);
    if (!orphans.length) return;
    const earliest = orphans[0];
    const snap = this.engine.loadSnapshot(earliest.msgId);
    if (snap) this.engine.restoreSnapshot(snap);
    this.engine.dropSnapshots(orphans.map(s => s.msgId));
  }

  _onChatChanged() {
    this._busy = false;
    this.engine.backend.invalidate?.();
    this.engine.setStorageBackend(this.engine.backend);
    this.deps.injection?.run?.();
  }
}
