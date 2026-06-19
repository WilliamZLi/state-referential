// Branches are seamless: a branch chat opens with the recent mainline context
// copied in (recap-of-pre-N + last N verbatim) and nothing else — no seed/framing
// message. The AI just continues the story in the new chat.
export function splitForSeed(chat, lastN) {
  const list = chat ?? [];
  if (list.length <= lastN) return { toRecap: [], verbatim: list.slice() };
  return { toRecap: list.slice(0, list.length - lastN), verbatim: list.slice(list.length - lastN) };
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
