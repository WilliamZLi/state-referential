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
