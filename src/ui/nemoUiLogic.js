// Pure helpers for the Nemo compaction UI (no jQuery / DOM).

const MINS = { thresholdTokens: 1000, multiplier: 0, keepLast: 2, keepRecaps: 1, chapterTokens: 100, earlierTokens: 100 };

/** Shown when an op is refused because a reply is generating or a compaction is running. */
export const NEMO_BUSY_TEXT = 'Busy — wait for the reply or compaction to finish.';

/** Returns allow(): true at most once per `intervalMs` (for toasts). */
export function createThrottle(intervalMs, now = Date.now) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    return true;
  };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse a numeric setting; null when invalid or below its minimum. */
export function parseNemoNumber(key, raw) {
  if (!(key in MINS)) return null;
  const n = key === 'multiplier' ? parseFloat(raw) : parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (key === 'multiplier') return n > 0 ? n : null;
  return n >= MINS[key] ? n : null;
}

/** What restoring a chapter involves; null for an unknown id. */
export function restoreIntent(state, chapterId) {
  const chapters = state?.chapters ?? [];
  const idx = chapters.findIndex(c => c.id === chapterId);
  if (idx < 0) return null;
  const ch = chapters[idx];
  if (ch.status === 'folded') {
    const folds = state.folds ?? [];
    const fi = folds.findIndex(f => (f.chapterIds ?? []).includes(chapterId));
    if (fi < 0) return null;
    return { kind: 'folded', unfolds: folds.length - fi, newer: chapters.length - idx - 1 };
  }
  const newer = chapters.slice(idx + 1).filter(c => c.status === 'live').length;
  return { kind: 'live', newer };
}

export function restoreConfirmText(intent) {
  if (intent.kind === 'folded') {
    return intent.newer > 0
      ? `Unfold ${intent.unfolds} time(s) and restore this chapter and the ${intent.newer} newer chapter(s)?`
      : `Unfold ${intent.unfolds} time(s) and restore this chapter?`;
  }
  return intent.newer > 0 ? `Restore this chapter and the ${intent.newer} newer chapter(s)?` : 'Restore this chapter?';
}

export function compactResultMessage(r) {
  if (r?.compacted) {
    return { level: 'success', text: `Compacted ${r.messages} messages into ${r.chapters} chapter(s)${r.folded ? ' and folded older recaps into Earlier history' : ''}` };
  }
  switch (r?.reason) {
    case 'summary-failed': return { level: 'warning', text: 'Summary failed — nothing changed.' };
    case 'changed': return { level: 'info', text: 'Chat changed while summarizing — nothing changed.' };
    default: return { level: 'info', text: 'Nothing to compact yet.' };
  }
}

/** hasMarker(id): whether the chapter's marker is still in the chat; a missing one is flagged. */
export function renderChapterList(state, hasMarker = () => true) {
  const chapters = state?.chapters ?? [];
  const hasFolds = (state?.folds ?? []).length > 0;
  if (!chapters.length && !state?.earlier && !hasFolds) return '<div class="strk-nemo-empty">No chapters yet.</div>';
  const rows = [];
  if (hasFolds) {
    rows.push(`<div class="strk-nemo-row strk-nemo-earlier"><span>Earlier history (${state.folds.length} fold${state.folds.length === 1 ? '' : 's'})</span> <button class="menu_button" data-nemo-unfold>Unfold</button></div>`);
  }
  for (const c of chapters) {
    const status = c.status === 'folded' ? 'folded' : 'live';
    rows.push(`<div class="strk-nemo-row strk-nemo-${status}" title="${escapeHtml(c.recap)}"><span>${escapeHtml(c.count)} messages${hasMarker(c.id) ? '' : ' (marker missing)'}</span> <span class="strk-nemo-status">${status}</span> <button class="menu_button" data-nemo-restore="${escapeHtml(c.id)}">Restore</button></div>`);
  }
  return rows.join('');
}
