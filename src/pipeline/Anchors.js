// Anchor flag lives at the message TOP LEVEL (swipe-stable), not in extra.
export function isAnchored(message) {
  return !!message?.l3Anchor;
}

export function setAnchor(message, on, reason, now) {
  if (on) message.l3Anchor = { anchoredAt: now ?? Date.now(), reason: reason ?? '' };
  else delete message.l3Anchor;
}

export function toggleAnchor(message, reason, now) {
  setAnchor(message, !isAnchored(message), reason, now);
  return isAnchored(message);
}

export function countAnchors(chat) {
  return (chat ?? []).filter(isAnchored).length;
}
