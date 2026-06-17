import { readTrackerMsgId } from '../util/id.js';
import { isAnchored } from './Anchors.js';

function isSynthetic(m) { return m?.extra?.from === 'state-referential'; }

/** A message is compactable if it's a normal narrative message, not anchored,
 *  not one of our synthetic markers. */
function isCompactable(m) { return !isAnchored(m) && !isSynthetic(m); }

/**
 * Pick the oldest contiguous run of compactable messages outside the protected
 * recent window.
 * @param {Array} chat
 * @param {{recentWindow:number, minSize:number, maxCount?:number}} opts
 * @returns {{startIndex:number, endIndex:number, msgIds:string[]}|null}
 */
export function computeCompactionRange(chat, opts) {
  const { recentWindow, minSize, maxCount } = opts;
  const list = chat ?? [];
  const protectedFrom = list.length - recentWindow; // indices >= this are protected
  if (protectedFrom <= 0) return null;

  // First compactable index within the unprotected region.
  let start = -1;
  for (let i = 0; i < protectedFrom; i++) {
    if (isCompactable(list[i])) { start = i; break; }
  }
  if (start === -1) return null;

  // Extend while contiguous + compactable + unprotected + under maxCount.
  let end = start;
  for (let i = start + 1; i < protectedFrom; i++) {
    if (!isCompactable(list[i])) break;
    if (maxCount != null && (i - start + 1) > maxCount) break;
    end = i;
  }

  if ((end - start + 1) < minSize) return null;
  const msgIds = list.slice(start, end + 1).map(readTrackerMsgId).filter(Boolean);
  return { startIndex: start, endIndex: end, msgIds };
}
