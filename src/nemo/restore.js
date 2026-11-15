import { peekNemoState } from './state.js';
import { isUserHidden } from './range.js';
import { getArchive, deleteArchive } from '../pipeline/ArchiveStore.js';
import { readTrackerMsgId } from '../util/id.js';

const markerIndex = (chat, id) => chat.findIndex(m => m?.extra?.nemoChapterId === id);

// Locates where every chapter goes back and rebuilds its original messages
// without touching the chat. Each chapter is placed by:
//   1. its marker (replacing it and its hidden messages right after it), else
//   2. its anchor, the message that followed the run (taking back this
//      chapter's hidden messages sitting right before the anchor), else
//   3. the spot of the next newer chapter being restored (same hidden rule).
// Planned newest first so step 3 can use the newer chapter's spot. Returns
// null (all-or-nothing) if any chapter can't be placed, an archive is missing,
// or two placements overlap.
function planRestore(chat, meta, chapters) {
  const plan = [];
  for (let k = chapters.length - 1; k >= 0; k--) {
    const c = chapters[k];
    const archive = getArchive(meta, c.archiveId);
    if (!archive) return null;
    const hiddenIds = new Set(archive.sequence.filter(s => s.kind === 'hidden').map(s => s.id));
    const ownHidden = m => isUserHidden(m) && hiddenIds.has(readTrackerMsgId(m));

    let start; let end;
    const marker = markerIndex(chat, c.id);
    if (marker !== -1) {
      start = marker; end = marker + 1;
      while (end < chat.length && ownHidden(chat[end])) end++;
    } else {
      let at = c.anchorId ? chat.findIndex(m => readTrackerMsgId(m) === c.anchorId) : -1;
      if (at === -1 && plan.length) at = plan[plan.length - 1].index;
      if (at === -1) return null;
      start = at; end = at;
      while (start > 0 && ownHidden(chat[start - 1])) start--;
    }

    const live = new Map();
    for (let i = start; i < end; i++) if (ownHidden(chat[i])) live.set(readTrackerMsgId(chat[i]), chat[i]);
    const replacement = [];
    for (const s of archive.sequence) {
      if (s.kind === 'msg') replacement.push(structuredClone(archive.messages[s.i]));
      else if (live.has(s.id)) replacement.push(live.get(s.id));
    }
    plan.push({ id: c.id, archiveId: c.archiveId, order: k, index: start, deleteCount: end - start, replacement });
  }
  const overlaps = (a, b) => a.index < b.index + b.deleteCount && b.index < a.index + a.deleteCount;
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) if (overlaps(plan[i], plan[j])) return null;
  }
  return plan;
}

// Applies from the highest index down so earlier indices stay valid. At one
// index, replacements go before plain insertions, and newer chapters before
// older ones, so an older chapter's messages always end up first. The restored
// chapters' archives are deleted: their messages are back in the chat.
const applyOrder = (a, b) => (b.index - a.index) || ((b.deleteCount > 0) - (a.deleteCount > 0)) || (b.order - a.order);
function applyPlan(chat, meta, state, plan) {
  for (const p of [...plan].sort(applyOrder)) chat.splice(p.index, p.deleteCount, ...p.replacement);
  for (const p of plan) deleteArchive(meta, p.archiveId);
  const done = new Set(plan.map(p => p.id));
  state.chapters = state.chapters.filter(c => !done.has(c.id));
}

// Pops the newest fold and puts its chapters back to live. Does not save.
function unfoldTop(chat, state) {
  const fold = state.folds.pop();
  state.earlier = fold.prevEarlier ? { text: fold.prevEarlier } : null;
  for (const id of fold.chapterIds) {
    const c = state.chapters.find(x => x.id === id);
    if (!c) continue;
    c.status = 'live';
    const marker = chat.find(m => m?.extra?.nemoChapterId === id);
    if (marker) marker.mes = `Compacted ${c.count} messages`;
  }
}

// Save; if a reply started during the save, wait it out and save again so the
// reload keeps it; then reload. waitForIdle is optional (defaults to idle).
const commit = async d => {
  await d.saveChat();
  const after = await (d.waitForIdle ?? (async () => 'idle'))();
  if (after === 'waited' || after === 'timeout') await d.saveChat();
  await d.reloadChat();
};

const findChapter = (state, chapterId) => (state ? state.chapters.findIndex(c => c.id === chapterId) : -1);

export async function restoreChapter(d, chapterId) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = peekNemoState(meta);
  const at = findChapter(state, chapterId);
  if (at === -1) return { restored: false, reason: 'not-found' };
  if (state.chapters[at].status === 'folded') {
    const f = state.folds.findIndex(x => x.chapterIds.includes(chapterId));
    return { restored: false, reason: 'folded', unfoldsNeeded: state.folds.length - Math.max(f, 0) };
  }
  const targets = state.chapters.slice(at).filter(c => c.status === 'live');
  const plan = planRestore(chat, meta, targets);
  if (!plan) return { restored: false, reason: 'not-found' };
  applyPlan(chat, meta, state, plan);
  await commit(d);
  return { restored: true, count: targets.length };
}

// Unfolds as far as the chapter needs and restores it (plus every newer
// chapter) with a single save. The restore is planned against the post-unfold
// state first: if it can't be placed, nothing changes, not even the unfolds.
export async function unfoldAndRestore(d, chapterId) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = peekNemoState(meta);
  const at = findChapter(state, chapterId);
  if (at === -1) return { restored: false, reason: 'not-found' };
  let unfolds = 0;
  if (state.chapters[at].status === 'folded') {
    const f = state.folds.findIndex(x => x.chapterIds.includes(chapterId));
    if (f === -1) return { restored: false, reason: 'not-found' };
    unfolds = state.folds.length - f;
  }
  const reopened = new Set(state.folds.slice(state.folds.length - unfolds).flatMap(f => f.chapterIds));
  const targets = state.chapters.slice(at).filter(c => c.status === 'live' || reopened.has(c.id));
  const plan = planRestore(chat, meta, targets);
  if (!plan) return { restored: false, reason: 'not-found' };
  for (let i = 0; i < unfolds; i++) unfoldTop(chat, state);
  applyPlan(chat, meta, state, plan);
  await commit(d);
  return { restored: true, count: targets.length };
}

export async function unfoldLatest(d) {
  const state = peekNemoState(d.getMeta());
  if (!state?.folds.length) return { unfolded: false };
  unfoldTop(d.getChat(), state);
  await commit(d);
  return { unfolded: true };
}

export async function restoreAll(d) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = peekNemoState(meta);
  if (!state || (!state.chapters.length && !state.folds.length)) return { restored: 0 };
  const plan = planRestore(chat, meta, state.chapters);
  if (!plan) return { restored: 0 };
  while (state.folds.length) unfoldTop(chat, state);
  applyPlan(chat, meta, state, plan);
  await commit(d);
  return { restored: plan.length };
}

// Escape hatch for a stranded chapter: forgets it entirely. Removes its state
// entry, its marker (if still there), its id from any fold, and its archive.
// User-hidden messages stay in the chat. A fold left empty leaves the stack:
// the fold above it (or, for the top fold, the live Earlier history) reverts to
// what preceded it, so unfolding still ends with no Earlier history.
export async function dropChapter(d, chapterId) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = peekNemoState(meta);
  const c = state?.chapters.find(x => x.id === chapterId);
  if (!c) return { dropped: false };
  state.chapters = state.chapters.filter(x => x !== c);
  const marker = markerIndex(chat, chapterId);
  if (marker !== -1) chat.splice(marker, 1);
  for (let i = state.folds.length - 1; i >= 0; i--) {
    const fold = state.folds[i];
    fold.chapterIds = fold.chapterIds.filter(id => id !== chapterId);
    if (fold.chapterIds.length) continue;
    if (i === state.folds.length - 1) state.earlier = fold.prevEarlier ? { text: fold.prevEarlier } : null;
    else state.folds[i + 1].prevEarlier = fold.prevEarlier;
    state.folds.splice(i, 1);
  }
  deleteArchive(meta, c.archiveId);
  await commit(d);
  return { dropped: true };
}
