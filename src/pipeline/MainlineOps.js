import { spliceSyntheticMessage } from './L3Insert.js';
import { readTrackerMsgId } from '../util/id.js';
import { getArchive } from './ArchiveStore.js';

/**
 * Insert a synthetic message after `afterTrackerMsgId` against the LIVE chat,
 * using ST's mid-array idiom (splice -> saveChat -> emit -> reloadChat).
 * The emit is gated out by Layer 1 via extra.from === 'state-referential'.
 */
export async function insertSyntheticAfter(shell, opts) {
  const chat = shell.getChat();
  const { index, message } = spliceSyntheticMessage(chat, opts);
  await shell.saveChat();
  await shell.emit(shell.eventTypes.MESSAGE_RECEIVED, index);
  await shell.reloadChat();
  return { index, message };
}

/**
 * Fire Layer 2's chronicle append (summarizing over the current chat), persist
 * it, then mark the mainline with an act-complete-marker after the latest message.
 *
 * Persist happens BEFORE insertSyntheticAfter() because that call reloads the
 * chat, which fires CHAT_CHANGED and re-hydrates the chronicle from the server —
 * an unpersisted entry would be lost. Persisting first means the reload reads it back.
 * @param {{shell:object, chronicleOps:object, persistChronicle?:Function, chronicleInjection?:object}} ctx
 * @param {{title:string}} opts
 */
export async function actCompleteMarker({ shell, chronicleOps, persistChronicle, chronicleInjection }, { title }) {
  const chat = shell.getChat();
  const latestId = readTrackerMsgId(chat[chat.length - 1]);
  const entry = await chronicleOps.actComplete(title, { messages: chat, msgId: latestId });
  await persistChronicle?.();
  await insertSyntheticAfter(shell, {
    afterTrackerMsgId: latestId,
    kind: 'act-complete',
    // Terse in-chat beat; the full summary lives in the chronicle and on extra.l3Body.
    // smallSys:false → a normal, manageable message (ST keeps hide/edit/delete).
    mes: `✓ Act complete: ${title}`,
    smallSys: false,
    extra: { l3Title: title, l3Body: entry?.body ?? '' },
  });
  chronicleInjection?.run?.();
  return entry;
}

/** Splice a compaction-block's archived originals back into the chat. */
export async function restoreArchive(shell, archiveId) {
  const chat = shell.getChat();
  const archive = getArchive(chat, archiveId);
  const blockIndex = chat.findIndex(
    m => m?.extra?.l3Kind === 'compaction' && m?.extra?.l3ArchiveId === archiveId,
  );
  if (!archive || blockIndex < 0) return { restored: false };

  chat.splice(blockIndex, 1, ...structuredClone(archive.messages));
  await shell.saveChat();
  await shell.reloadChat();
  return { restored: true, count: archive.messages.length };
}
