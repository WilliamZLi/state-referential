import { isAnchored } from '../pipeline/Anchors.js';

export function isOurs(m) {
  return m?.extra?.from === 'state-referential';
}

export function isUserHidden(m) {
  return m?.is_system === true && !isOurs(m);
}

// Picks which older messages compaction may cover. The last `keepLast`
// messages (at least 2, widened to start on a user message) stay verbatim.
// Older messages form runs of compactable members; our markers and anchored
// messages split runs, user-hidden messages are skipped without splitting.
export function computeNemoRuns(chat, { keepLast }) {
  let keptStart = Math.max(0, chat.length - Math.max(2, keepLast));
  while (keptStart > 0 && !chat[keptStart].is_user) keptStart--;

  const runs = [];
  let current = null;
  const close = () => {
    if (current && current.indices.length >= 2) runs.push(current);
    current = null;
  };

  for (let i = 0; i < keptStart; i++) {
    const m = chat[i];
    if (isOurs(m) || isAnchored(m)) { close(); continue; }
    if (isUserHidden(m)) continue;
    if (!current) current = { startIndex: i, endIndex: i, indices: [] };
    current.indices.push(i);
    current.endIndex = i;
  }
  close();

  return { keptStart, runs };
}
