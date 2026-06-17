import { readTrackerMsgId } from '../util/id.js';

// Archives live in chat_metadata (the persisted `meta` object), NOT on the chat
// array. A property set on the array (chat.extra) is dropped when ST serializes
// the chat, which would silently lose every compacted message after a reload.
function bag(meta) {
  meta.l3Archives ??= {};
  return meta.l3Archives;
}

/**
 * Snapshot chat[startIndex..endIndex] into the archive bag on `meta` (chat_metadata).
 * `chat` is only the slice source; storage goes to `meta`. Returns archiveId.
 */
export function saveArchive(meta, chat, range, { genId, now }) {
  const { startIndex, endIndex } = range;
  const slice = chat.slice(startIndex, endIndex + 1);
  const archiveId = genId();
  bag(meta)[archiveId] = {
    archiveId,
    messages: structuredClone(slice),
    compactedAt: now,
    fromMessageId: readTrackerMsgId(slice[0]),
    toMessageId: readTrackerMsgId(slice[slice.length - 1]),
  };
  return archiveId;
}

export function getArchive(meta, archiveId) {
  return bag(meta)[archiveId];
}

export function listArchives(meta) {
  return Object.keys(bag(meta));
}
