import { ensureTrackerMsgId } from '../util/id.js';

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
    try {
      snapshotBefore = this.engine.snapshot(msgId);
      this.engine.snapshots.save(msgId, snapshotBefore);
      const changedTrackerIds = new Set();
      const off = this.engine.bus.on('tracker:value-changed', (e) => changedTrackerIds.add(e.tracker));
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
      this._busy = false;
    }
  }

  async _onSwiped(index) {
    const chat = this.deps.getChat();
    const msg = chat[index];
    if (!msg) return;
    const msgId = msg.extra?.trackerMsgId;
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
    const chat = this.deps.getChat();
    const fromIdx = Math.max(0, index);
    const dropIds = [];
    for (let i = fromIdx; i < chat.length + 1; i++) {
      const m = chat[i];
      if (m?.extra?.trackerMsgId) dropIds.push(m.extra.trackerMsgId);
    }
    // Also drop snapshots whose msgId no longer exists in chat.
    const liveIds = new Set(chat.filter(m => m?.extra?.trackerMsgId).map(m => m.extra.trackerMsgId));
    for (const snap of this.engine.listSnapshots()) {
      if (!liveIds.has(snap.msgId)) dropIds.push(snap.msgId);
    }
    this.engine.dropSnapshots(dropIds);
    if (chat[fromIdx - 1]?.extra?.trackerMsgId) {
      const snap = this.engine.loadSnapshot(chat[fromIdx - 1].extra.trackerMsgId);
      if (snap) this.engine.restoreSnapshot(snap);
    }
  }

  _onChatChanged() {
    this._busy = false;
    this.deps.injection?.run?.();
  }
}
