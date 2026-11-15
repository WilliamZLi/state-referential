import { getNemoState } from './state.js';
import { isUserHidden } from './range.js';
import { getArchive } from '../pipeline/ArchiveStore.js';
import { readTrackerMsgId } from '../util/id.js';

// Locates every chapter's marker and rebuilds its original messages without
// touching the chat. Returns null if any marker or archive is missing.
function planRestore(chat, meta, chapters) {
  const plan = [];
  for (const c of chapters) {
    const index = chat.findIndex(m => m?.extra?.nemoChapterId === c.id);
    const archive = getArchive(meta, c.archiveId);
    if (index === -1 || !archive) return null;

    const hiddenIds = new Set(archive.sequence.filter(s => s.kind === 'hidden').map(s => s.id));
    const live = new Map();
    let end = index + 1;
    while (end < chat.length && isUserHidden(chat[end]) && hiddenIds.has(readTrackerMsgId(chat[end]))) {
      live.set(readTrackerMsgId(chat[end]), chat[end]);
      end++;
    }

    const replacement = [];
    for (const s of archive.sequence) {
      if (s.kind === 'msg') replacement.push(structuredClone(archive.messages[s.i]));
      else if (live.has(s.id)) replacement.push(live.get(s.id));
    }
    plan.push({ id: c.id, index, deleteCount: end - index, replacement });
  }
  return plan;
}

// Applies from the highest index down so earlier indices stay valid.
function applyPlan(chat, state, plan) {
  for (const p of [...plan].sort((a, b) => b.index - a.index)) {
    chat.splice(p.index, p.deleteCount, ...p.replacement);
  }
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

const commit = async d => { await d.saveChat(); await d.reloadChat(); };

export async function restoreChapter(d, chapterId) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = getNemoState(meta);
  const at = state.chapters.findIndex(c => c.id === chapterId);
  if (at === -1) return { restored: false, reason: 'not-found' };
  if (state.chapters[at].status === 'folded') {
    const f = state.folds.findIndex(x => x.chapterIds.includes(chapterId));
    return { restored: false, reason: 'folded', unfoldsNeeded: state.folds.length - Math.max(f, 0) };
  }
  const targets = state.chapters.slice(at).filter(c => c.status === 'live');
  const plan = planRestore(chat, meta, targets);
  if (!plan) return { restored: false, reason: 'not-found' };
  applyPlan(chat, state, plan);
  await commit(d);
  return { restored: true, count: targets.length };
}

export async function unfoldLatest(d) {
  const state = getNemoState(d.getMeta());
  if (!state.folds.length) return { unfolded: false };
  unfoldTop(d.getChat(), state);
  await commit(d);
  return { unfolded: true };
}

export async function restoreAll(d) {
  const chat = d.getChat();
  const meta = d.getMeta();
  const state = getNemoState(meta);
  if (!state.chapters.length && !state.folds.length) return { restored: 0 };
  const plan = planRestore(chat, meta, state.chapters);
  if (!plan) return { restored: 0 };
  while (state.folds.length) unfoldTop(chat, state);
  applyPlan(chat, state, plan);
  await commit(d);
  return { restored: plan.length };
}
