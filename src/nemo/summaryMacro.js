import { peekNemoState, hasChapters, buildSlotText } from './state.js';

// Mirrors SillyTavern's memory extension: skip the last message, newest first.
export function latestMemoryFromChat(chat) {
  if (!Array.isArray(chat) || chat.length === 0) return '';
  for (let i = chat.length - 2; i >= 0; i--) {
    const memory = chat[i]?.extra?.memory;
    if (memory) return memory;
  }
  return '';
}

export function createSummaryProvider({ getMeta, getChat, readUiSummary }) {
  return () => {
    // peek, never get: this runs on every prompt build in every chat (R2)
    const state = peekNemoState(getMeta());
    if (state && hasChapters(state)) return buildSlotText(state);
    const ui = readUiSummary();
    if (String(ui ?? '').trim() !== '') return ui;
    return latestMemoryFromChat(getChat());
  };
}
