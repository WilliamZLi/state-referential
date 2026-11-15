// Removes scratchpad/state blocks from a message before it is summarized, so
// the summary only sees story prose. The <scene> header is kept.
const PAIRED_BLOCKS = [
  /<nemo-pad\b[^>]*>[\s\S]*?<\/nemo-pad>/g,
  /<nemo-offscreen\b[^>]*>[\s\S]*?<\/nemo-offscreen>/g,
  /<nemo-mp-state\b[^>]*>[\s\S]*?<\/nemo-mp-state>/g,
  /<nemo-mp-retain\b[^>]*>[\s\S]*?<\/nemo-mp-retain>/g,
  /<mental_state\b[^>]*>[\s\S]*?<\/mental_state>/g,
];

// A reply cut off mid-stream leaves an opener with no closer. Everything from
// such an opener to the end of the text is scratchpad, so it goes too. This
// runs after the paired pass, so closed blocks are already gone by then.
const UNCLOSED_TO_END = [
  /<nemo-pad\b[\s\S]*$/,
  /<nemo-offscreen\b[\s\S]*$/,
  /<nemo-mp-state\b[\s\S]*$/,
  /<nemo-mp-retain\b[\s\S]*$/,
  /<mental_state\b[\s\S]*$/,
];

// The legacy V2 pad is always the reply's trailing block, so it runs to the end.
const LEGACY_PAD_TO_END = /<div class="nemo-legacy-pad"[\s\S]*$/;

export function stripForSummary(text) {
  let out = String(text ?? '');
  for (const re of PAIRED_BLOCKS) out = out.replace(re, '');
  for (const re of UNCLOSED_TO_END) out = out.replace(re, '');
  out = out.replace(LEGACY_PAD_TO_END, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
