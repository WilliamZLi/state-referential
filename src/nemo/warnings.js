export function hasEnabledSummarySlot(prompts, isDisabled) {
  if (!Array.isArray(prompts)) return false;
  return prompts.some(p => !isDisabled(p.identifier) && String(p.content ?? '').includes('{{summary}}'));
}

export function chatUsesBuiltinSummary(chat) {
  if (!Array.isArray(chat)) return false;
  return chat.some(m => !!m?.extra?.memory);
}
