export function peekNemoState(meta) {
  return meta?.nemoCompaction ?? null;
}

export function getNemoState(meta) {
  if (!meta.nemoCompaction) {
    meta.nemoCompaction = { enabled: false, chapters: [], earlier: null, folds: [] };
  }
  return meta.nemoCompaction;
}

export function isNemoEnabled(meta) {
  return !meta?.trackerWorldId && !!peekNemoState(meta)?.enabled;
}

export function setNemoEnabled(meta, on) {
  if (meta?.trackerWorldId) return false;
  getNemoState(meta).enabled = !!on;
  return true;
}

export function hasChapters(state) {
  return state.chapters.length > 0 || state.earlier !== null;
}

export function liveChapters(state) {
  return state.chapters.filter(c => c.status === 'live');
}

export function buildSlotText(state) {
  const recaps = liveChapters(state).map(c => c.recap);
  const parts = [];
  if (state.earlier) parts.push(`Earlier history:\n${state.earlier.text}`);
  if (recaps.length) parts.push(recaps.join('\n\n'));
  return parts.join('\n\n');
}
