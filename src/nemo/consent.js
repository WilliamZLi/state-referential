// Reads the user's consent prompts live from their active preset, so edits to
// the preset are picked up on every summary. Pure: ST lookups are injected.
export const CONSENT_PROMPT_IDS = [
  'v11-254-consent-consent-user',
  'v11-248-utility-extreme-content',
  'v11-255-consent-consent-acknowledged',
];

export function readConsentPrompts({ getPromptById, isDisabled, substitute }) {
  const out = [];
  for (const id of CONSENT_PROMPT_IDS) {
    const p = getPromptById(id);
    if (!p || isDisabled(id)) continue;
    const content = substitute(String(p.content ?? ''));
    if (!content.trim()) continue;
    out.push({ role: p.role, content });
  }
  return out;
}
