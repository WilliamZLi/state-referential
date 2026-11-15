// Writes one chapter recap for a run of old messages.
import { isOurs, isUserHidden } from './range.js';
import { buildChapterRequest, isValidRecap } from './request.js';

export function nextMessageAfter(chat, index) {
  for (let i = index + 1; i < chat.length; i++) {
    if (!isOurs(chat[i]) && !isUserHidden(chat[i])) return chat[i];
  }
  return null;
}

export async function writeChapterRecap({ chat, run, consent, summarize, targetTokens }) {
  const messages = run.indices.map(i => chat[i]);
  const nextMessage = nextMessageAfter(chat, run.endIndex);
  const text = await summarize(buildChapterRequest({ messages, nextMessage, consent, targetTokens }));
  return isValidRecap(text) ? text : null;
}
