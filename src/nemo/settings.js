export const NEMO_DEFAULTS = Object.freeze({
  mode: 'auto',
  thresholdTokens: 120000,
  multiplier: 2.5,
  keepLast: 12,
  keepRecaps: 4,
  chapterTokens: 1500,
  earlierTokens: 3000,
});

export function resolveNemoSettings(stored = {}) {
  const s = { ...NEMO_DEFAULTS };
  for (const key of Object.keys(NEMO_DEFAULTS)) {
    if (stored?.[key] !== undefined) s[key] = stored[key];
  }
  s.keepLast = Math.max(2, s.keepLast);
  s.keepRecaps = Math.max(1, s.keepRecaps);
  return s;
}
