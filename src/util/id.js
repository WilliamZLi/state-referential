function uuid4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}

export function newId() { return uuid4(); }

/**
 * Tracker msgId lives at the MESSAGE TOP LEVEL — NOT in `extra` — because ST
 * stores `extra` per-swipe inside `swipe_info[swipe_id]`. When the user swipes
 * to a different alternative, `msg.extra` is replaced with that swipe's entry,
 * which wipes any per-extension state stored there. A top-level property on
 * the message object is preserved across swipes by ST.
 *
 * Legacy chats may still have the id in extra; readTrackerMsgId falls back to
 * those keys, and ensureTrackerMsgId hoists them to the top level on first use.
 */
const TOP_KEY = 'state_referential_msgId';
const LEGACY_KEYS = ['state_referential_msgId', 'trackerMsgId'];

export function ensureTrackerMsgId(message) {
  if (!message) return null;
  if (message[TOP_KEY]) return message[TOP_KEY];
  // Migration: hoist a legacy per-swipe id from `extra` if present.
  const legacy = LEGACY_KEYS.map(k => message.extra?.[k]).find(Boolean);
  message[TOP_KEY] = legacy ?? uuid4();
  return message[TOP_KEY];
}

/**
 * Read the tracker message-id from a message, preferring the top-level (swipe-
 * stable) key and falling back to legacy `extra.*` placements.
 */
export function readTrackerMsgId(message) {
  if (!message) return null;
  if (message[TOP_KEY]) return message[TOP_KEY];
  for (const k of LEGACY_KEYS) {
    const v = message.extra?.[k];
    if (v) return v;
  }
  return null;
}