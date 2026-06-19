const SEED_PROMPTS = {
  exploratory: 'You are running a side adventure: an exploratory side-scene. Keep it focused on what the protagonist discovers. Third person.',
  combat: 'You are running a side adventure: a combat encounter. Keep it tense and action-focused. Third person.',
  social: 'You are running a side adventure: a social scene. Focus on the exchange between characters. Third person.',
  flashback: 'You are running a side adventure: a flashback. Render a past event vividly. Third person.',
  'time-skip': 'You are running a side adventure: a time-skip. Cover the elapsed period briefly, then settle into the new moment. Third person.',
};

export function seedPromptForPurpose(purpose) {
  return SEED_PROMPTS[purpose] ?? 'You are running a side adventure in this story. Third person.';
}

export function splitForSeed(chat, lastN) {
  const list = chat ?? [];
  if (list.length <= lastN) return { toRecap: [], verbatim: list.slice() };
  return { toRecap: list.slice(0, list.length - lastN), verbatim: list.slice(list.length - lastN) };
}

export function buildBranchMeta({ mainlineChatId, branchFromMessageId, snapshotKey, title, purpose, lastN, seedMessageCount, now }) {
  return { mainlineChatId, branchFromMessageId, snapshotKey, title, purpose, lastN, seedMessageCount, createdAt: now };
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
