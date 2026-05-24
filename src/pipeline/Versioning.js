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

  _onDeleted(index) {
    // MESSAGE_DELETED fires after ST has removed the message at `index` from chat.
    // We:
    //   1. Drop snapshots for any msgIds no longer present in chat.
    //   2. Restore engine state from the snapshot of chat[index - 1] (the message
    //      immediately before the deleted one). If index === 0, no restore happens
    //      (nothing was before it).
    const chat = this.deps.getChat();
    const fromIdx = Math.max(0, index);
    const dropIds = [];
    for (let i = fromIdx; i < chat.length; i++) {
      const id = readTrackerMsgId(chat[i]);
      if (id) dropIds.push(id);
    }
    // Also drop snapshots whose msgId no longer exists in chat.
    const liveIds = new Set(chat.map(m => readTrackerMsgId(m)).filter(Boolean));
    for (const snap of this.engine.listSnapshots()) {
      if (!liveIds.has(snap.msgId)) dropIds.push(snap.msgId);
    }
    this.engine.dropSnapshots(dropIds);
    const prevId = readTrackerMsgId(chat[fromIdx - 1]);
    if (prevId) {
      const snap = this.engine.loadSnapshot(prevId);
      if (snap) this.engine.restoreSnapshot(snap);
    }
  }

  _onChatChanged() {
    this._busy = false;
    this.engine.backend.invalidate?.();
    this.engine.setStorageBackend(this.engine.backend);
    this.deps.injection?.run?.();
  }
}
