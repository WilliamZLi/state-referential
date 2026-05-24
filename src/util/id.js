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

export function ensureTrackerMsgId(message) {
  if (!message.extra) message.extra = {};
  // Migration: if the legacy key exists but the new key doesn't, promote it.
  if (!message.extra.state_referential_msgId && message.extra.trackerMsgId) {
    message.extra.state_referential_msgId = message.extra.trackerMsgId;
  }
  if (!message.extra.state_referential_msgId) message.extra.state_referential_msgId = uuid4();
  return message.extra.state_referential_msgId;
}

/**
 * Read the tracker message-id from a message, accepting both the current
 * namespaced key and the legacy key for backward compatibility.
 */
export function readTrackerMsgId(message) {
  return message?.extra?.state_referential_msgId ?? message?.extra?.trackerMsgId ?? null;
}