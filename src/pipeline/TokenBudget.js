import { readTrackerMsgId } from '../util/id.js';

/**
 * Resolve the effective max-context (the denominator for the "% full" nudge).
 * Prefer ST's API-aware value (`apiMaxContext`, from getMaxContextTokens()),
 * which returns the ACTIVE API's real context — e.g. oai_settings.openai_max_context
 * for chat-completion. Fall back to `fallback` (getContext().maxContext, i.e. the
 * text-completion `max_context` global, which is stale/wrong on chat-completion
 * APIs and caused 12k-token chats to read as 150%+ full). Returns 0 when neither
 * is usable, so decideAutoCompact declines to decide rather than dividing by junk.
 */
export function resolveContextSize(apiMaxContext, fallback) {
  const api = Number(apiMaxContext);
  if (Number.isFinite(api) && api > 0) return api;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : 0;
}

/**
 * Sum per-message token counts for the chat. `countFn(message)` returns a count
 * (sync or async). `cache` (optional Map) keys by tracker id + a cheap text hash
 * so unchanged messages aren't recounted.
 */
export async function estimateChatTokens(chat, countFn, cache) {
  let total = 0;
  for (const m of (chat ?? [])) {
    const key = readTrackerMsgId(m) ?? m;
    const stamp = (m?.mes ?? '').length; // cheap change-detector
    const hit = cache?.get(key);
    if (hit && hit.stamp === stamp) { total += hit.count; continue; }
    const count = await countFn(m);
    cache?.set(key, { stamp, count });
    total += count;
  }
  return total;
}
