import { readTrackerMsgId } from '../util/id.js';

// Branches are seamless: a branch chat opens with the recent mainline context
// copied in (recap-of-pre-N + last N verbatim) and nothing else — no seed/framing
// message. The AI just continues the story in the new chat.
export function splitForSeed(chat, lastN) {
  const list = chat ?? [];
  if (list.length <= lastN) return { toRecap: [], verbatim: list.slice() };
  return { toRecap: list.slice(0, list.length - lastN), verbatim: list.slice(list.length - lastN) };
}

// Compose a findable name for a scene chat: "<mainline name> - branch - <timestamp>".
// `autoChatName` is doNewChat's default ("<character> - <timestamp>"); reuse its
// trailing ST timestamp (already filename-safe) instead of minting our own.
export function sceneChatName(mainlineChatId, autoChatName) {
  const auto = String(autoChatName ?? '');
  const i = auto.lastIndexOf(' - ');
  const ts = i >= 0 ? auto.slice(i + 3) : auto;
  return `${mainlineChatId} - branch - ${ts}`;
}

export function buildBranchMeta({ mainlineChatId, branchFromMessageId, snapshotKey, title, lastN, seedMessageCount, now }) {
  return { mainlineChatId, branchFromMessageId, snapshotKey, title, lastN, seedMessageCount, createdAt: now };
}

export function isBranchOpen(world) {
  return !!world?.openBranchChatId;
}

export function addBranchRecord(world, rec) {
  world.branches ??= [];
  world.branches.push(rec);
}

export function setBranchStatus(world, chatId, status, patch = {}) {
  const rec = (world.branches ?? []).find(b => b.chatId === chatId);
  if (rec) Object.assign(rec, { status }, patch);
}

// ── Fold-back (3b) ────────────────────────────────────────────────────────────

// The branch messages AFTER the seeded context (recap + verbatim copies + any
// new-chat greeting). This is the actual side-scene play that fold-back recaps.
export function playRange(branchChat, l3BranchMeta) {
  const list = branchChat ?? [];
  return list.slice(l3BranchMeta?.seedMessageCount ?? 0);
}

// Where to splice the fold-back recap in the mainline: after the branch point if
// it still exists, else after the last message (tail/drift fallback), else null.
export function foldbackAnchorId(mainChat, branchFromMessageId) {
  const list = mainChat ?? [];
  if (branchFromMessageId && list.some(m => readTrackerMsgId(m) === branchFromMessageId)) {
    return branchFromMessageId;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const id = readTrackerMsgId(list[i]);
    if (id) return id;
  }
  return null;
}

// Build the opts for buildSyntheticMessage/insertSyntheticAfter that splice the
// side-scene recap into the mainline as a PLAIN narration message — no visible
// "folded from branch" label in the name or body (it reads as ordinary story).
// The branch link is preserved in extra (l3BranchChatId/Title) for 3c, invisible
// to the user and the generation.
export function buildFoldbackMarker({ title, recap, branchChatId, name }) {
  return {
    kind: 'fold-back',
    name: name || 'Narrator',
    mes: recap,
    smallSys: false,
    extra: { l3BranchChatId: branchChatId, l3BranchTitle: title },
  };
}
