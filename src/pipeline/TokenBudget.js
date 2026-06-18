import { readTrackerMsgId } from '../util/id.js';

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
