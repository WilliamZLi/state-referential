/**
 * Decide whether to compact. Returns the active mode ('nudge'|'silent') when the
 * chat exceeds thresholdPct of the context, else null. Off and unknown context → null.
 */
export function decideAutoCompact({ chatTokens, contextSize, settings }) {
  const mode = settings?.auto ?? 'nudge';
  if (mode === 'off') return null;
  if (!contextSize || contextSize <= 0) return null;
  const limit = contextSize * ((settings?.thresholdPct ?? 80) / 100);
  if (chatTokens <= limit) return null;
  return mode === 'silent' ? 'silent' : 'nudge';
}
