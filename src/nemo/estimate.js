// Pure helpers for estimating the real token count of a chat-completion prompt.

/** Joins string contents and the .text of content-part arrays with '\n'. Non-text parts are skipped. */
export function flattenPromptText(chat) {
  const out = [];
  for (const m of chat || []) {
    const c = m?.content;
    if (typeof c === 'string') out.push(c);
    else if (Array.isArray(c)) {
      for (const p of c) {
        if (typeof p === 'string') out.push(p);
        else if (p && typeof p.text === 'string') out.push(p.text);
      }
    }
  }
  return out.join('\n');
}

export function estimateRealTokens(stCount, multiplier) {
  return Math.round(stCount * multiplier);
}
