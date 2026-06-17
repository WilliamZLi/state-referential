// SPIKE (Layer 3) — synthetic message insertion primitive.
//
// Pure, array-level logic: stamp a small-system message and splice it
// immediately after a target message identified by its tracker id. The
// imperative ST shell (saveChatConditional + reloadCurrentChat) lives in the
// browser harness (spike/l3-insert-harness.js), NOT here, so this stays unit
// testable under `node --test`.
//
// Findings baked in:
//  - Tracker ids live at the message TOP LEVEL (state_referential_msgId), not in
//    `extra`, because ST swaps `msg.extra` per swipe. We use ensureTrackerMsgId.
//  - Layer 1's auto-update / chronicle skip-gate is `extra.from ===
//    'state-referential'` (Versioning.js:34, index.js:125). We set it so our own
//    inserts are excluded from re-derivation.

import { ensureTrackerMsgId, readTrackerMsgId } from '../util/id.js';

/**
 * Build (but do not insert) a stamped Layer 3 small-system message.
 * @param {{kind:'fold-back'|'compaction'|'act-complete', mes:string, name?:string, id?:string, extra?:object}} opts
 */
export function buildSyntheticMessage({ kind, mes, name, id, extra }) {
  const message = {
    name: name ?? 'State',
    is_user: false,
    is_system: false, // kept in AI history (spec §3.3); collapsed via CSS in Plan 2
    mes,
    extra: { isSmallSys: true, from: 'state-referential', l3Kind: kind, ...extra },
  };
  if (id) message.state_referential_msgId = id;
  ensureTrackerMsgId(message);
  return message;
}

/** Splice an already-built message into chat at index. Returns the index. */
export function spliceAtIndex(chat, index, message) {
  chat.splice(index, 0, message);
  return index;
}

/**
 * Splice a synthetic message immediately after the message whose tracker id is
 * `afterTrackerMsgId`. Mutates `chat` in place. Returns { index, message }.
 */
export function spliceSyntheticMessage(chat, opts) {
  const { afterTrackerMsgId } = opts;
  const targetIdx = chat.findIndex(m => readTrackerMsgId(m) === afterTrackerMsgId);
  if (targetIdx < 0) throw new Error(`unknown afterTrackerMsgId: ${afterTrackerMsgId}`);
  const message = buildSyntheticMessage(opts);
  const index = spliceAtIndex(chat, targetIdx + 1, message);
  return { index, message };
}
