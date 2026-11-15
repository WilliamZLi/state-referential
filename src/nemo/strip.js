// Removes scratchpad/state blocks from a message before it is summarized, so
// the summary only sees story prose. The <scene> header is kept.
const PAIRED_BLOCKS = [
  /<nemo-pad\b[^>]*>[\s\S]*?<\/nemo-pad>/g,
  /<nemo-offscreen\b[^>]*>[\s\S]*?<\/nemo-offscreen>/g,
  /<nemo-mp-state\b[^>]*>[\s\S]*?<\/nemo-mp-state>/g,
  /<nemo-mp-retain\b[^>]*>[\s\S]*?<\/nemo-mp-retain>/g,
  /<mental_state\b[^>]*>[\s\S]*?<\/mental_state>/g,
];

// The legacy V2 pad is always the reply's trailing block, so it runs to the end.
const LEGACY_PAD_TO_END = /<div class="nemo-legacy-pad"[\s\S]*$/;

export function stripForSummary(text) {
  let out = String(text ?? '');
  for (const re of PAIRED_BLOCKS) out = out.replace(re, '');
  out = out.replace(LEGACY_PAD_TO_END, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
