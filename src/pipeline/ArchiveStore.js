import { readTrackerMsgId } from '../util/id.js';

function bag(chat) {
  chat.extra ??= {};
  chat.extra.l3Archives ??= {};
  return chat.extra.l3Archives;
}

/** Snapshot chat[startIndex..endIndex] into the archive bag. Returns archiveId. */
export function saveArchive(chat, range, { genId, now }) {
  const { startIndex, endIndex } = range;
  const slice = chat.slice(startIndex, endIndex + 1);
  const archiveId = genId();
  bag(chat)[archiveId] = {
    archiveId,
    messages: structuredClone(slice),
    compactedAt: now,
    fromMessageId: readTrackerMsgId(slice[0]),
    toMessageId: readTrackerMsgId(slice[slice.length - 1]),
  };
  return archiveId;
}

export function getArchive(chat, archiveId) {
  return bag(chat)[archiveId];
}

export function listArchives(chat) {
  return Object.keys(bag(chat));
}
