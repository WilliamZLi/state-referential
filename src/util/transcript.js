// src/util/transcript.js
// Canonical chat→transcript renderer shared by the isolated summarizers
// (compaction's l3GenerateSummary and ChronicleOps._generateSummary). One
// labeling/join convention so the two can't drift: user turns render as
// "User", everything else uses the message name (falling back to "Narrator"),
// null/blank bodies are guarded, lines are single-newline separated.
export function buildTranscript(messages) {
  return (messages ?? [])
    .map(m => `${m.is_user ? 'User' : (m.name ?? 'Narrator')}: ${m.mes ?? ''}`)
    .join('\n');
}

// The isolated summarizers show events framed as a "TRANSCRIPT" with an explicit
// end marker. Without an in-world constraint the model leaks that framing into
// the prose — e.g. ending a recap with "...when the transcript ended" instead of
// describing the situation. Appended to both summarizer instructions so recaps
// stay diegetic.
export const IN_WORLD_RECAP_RULE =
  'Write entirely in-world. Never refer to "the transcript", "the recap", "the summary", "the log", ' +
  'or "the conversation", and never mention that these events were recorded or that they ended. ' +
  'At the latest moment, describe the situation itself (e.g. "Cersia stood weighing her choice") — ' +
  'never "when the transcript ended" or any similar meta phrasing.';
