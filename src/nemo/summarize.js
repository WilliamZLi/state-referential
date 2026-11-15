// Adapter over SillyTavern's generateRaw. Never throws: a failed call yields ''
// (which fails isValidRecap, so the caller treats it as "no recap").
export function makeSummarizer({ generateRaw, systemPrompt, responseLength = 16000 }) {
  return async (prompt) => {
    try {
      const out = await generateRaw({ prompt, systemPrompt, responseLength });
      return String(out ?? '').trim();
    } catch (e) {
      console.warn('[state-referential] nemo summarize failed:', e?.message);
      return '';
    }
  };
}
