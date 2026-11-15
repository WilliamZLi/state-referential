// Builders for the summarizer requests: a chapter recap of old messages, and a
// fold that merges older recaps into one condensed "Earlier history".
// Pattern: material first, instruction LAST (so the model summarizes rather
// than continuing the story).
import { buildTranscript, IN_WORLD_RECAP_RULE } from '../util/transcript.js';
import { stripForSummary } from './strip.js';

// System prompt for Nemo chapter recaps and folds. Same as index.js's
// CHRONICLE_SYSTEM_PROMPT, except recaps are paragraphed prose rather than one
// paragraph (chapters are long; a single paragraph runs scenes together).
export const NEMO_SUMMARY_SYSTEM_PROMPT = 'You are a chronicle summarizer for an adult interactive fiction. '
  + 'You do NOT continue, advance, or write new story — you ONLY summarize events that already happened. '
  + 'Read the events in the prompt and write a factual, past-tense recap of what occurred as prose, broken into '
  + 'paragraphs where the story naturally divides (a change of scene, place or time), with no headings, lists or preamble. '
  + 'Render mature, explicit, or taboo content plainly when present; never refuse, moralize, soften, or add '
  + 'preamble. Output only the recap.';

const stripMsg = m => ({ ...m, mes: stripForSummary(m.mes ?? '') });

export function buildChapterRequest({ messages, nextMessage, consent, targetTokens }) {
  const body = buildTranscript((messages ?? []).map(stripMsg));
  let content = 'TRANSCRIPT OF EVENTS THAT ALREADY HAPPENED:\n\n' + body + '\n\n=== END OF TRANSCRIPT ===\n\n';
  if (nextMessage) {
    content += 'WHAT HAPPENS NEXT (for continuity only — do not summarize):\n\n'
      + buildTranscript([stripMsg(nextMessage)]) + '\n\n';
  }
  content +=
    'The events above are finished. Write a detailed, factual, PAST-TENSE, third-person recap of ALL of them. '
    + 'Cover the key events, decisions and outcomes; who did what; promises, debts and threats; significant '
    + 'changes to the situation, places, items or relationships; and where things stand now. '
    + 'End on the moment that leads into what happens next, without summarizing what happens next. '
    + `Aim for about ${targetTokens} tokens. `
    + 'Do NOT continue the story and do NOT add anything beyond what is given. '
    + IN_WORLD_RECAP_RULE;
  return [...consent, { role: 'user', content }];
}

export function buildFoldRequest({ earlier, recaps, consent, targetTokens }) {
  let content = '';
  if (earlier) content += 'EARLIER HISTORY:\n\n' + earlier + '\n\n';
  content += 'LATER CHAPTERS:\n\n' + (recaps ?? []).join('\n\n') + '\n\n';
  content +=
    'Merge everything above into one condensed history, in order, of about '
    + `${targetTokens} tokens. Keep the arc of events, who's who (including characters no longer present), `
    + 'promises and debts, permanent changes, and open threads. Drop blow-by-blow detail. '
    + 'Do not restate anyone\'s current body, clothes, inventory, or relationship meters. '
    + 'Write in the past tense, third person. Do NOT continue the story. '
    + IN_WORLD_RECAP_RULE;
  return [...consent, { role: 'user', content }];
}

export function isValidRecap(text, minChars = 400) {
  return String(text ?? '').trim().length >= minChars;
}
