import { peekNemoState } from '../nemo/state.js';
import { restoreIntent, restoreConfirmText } from './nemoUiLogic.js';

/**
 * Shared restore flow for panel + marker buttons.
 * deps: { getMeta, restoreChapter, unfoldLatest, confirm, toast, isBusy }
 */
export async function runRestoreFlow(deps, chapterId, refresh) {
  if (deps.isBusy()) { deps.toast.info('Compaction in progress'); return; }
  const intent = restoreIntent(peekNemoState(deps.getMeta()), chapterId);
  if (!intent) { deps.toast.warning("Couldn't restore — the chapter's marker is missing."); refresh?.(); return; }
  if (!(await deps.confirm(restoreConfirmText(intent)))) return;
  try {
    if (intent.kind === 'folded') {
      for (let i = 0; i < intent.unfolds; i++) {
        const u = await deps.unfoldLatest();
        if (!u?.unfolded) { deps.toast.warning("Couldn't unfold — nothing left to unfold."); return; }
      }
    }
    const r = await deps.restoreChapter(chapterId);
    if (r?.restored) deps.toast.success(`Restored ${r.count} chapter(s).`);
    else if (r?.reason === 'folded') deps.toast.warning('Chapter is still folded — try unfolding first.');
    else deps.toast.warning("Couldn't restore — the chapter's marker is missing.");
  } catch (e) {
    console.error('[nemo] restore failed', e);
    deps.toast.error(`Restore failed: ${e?.message ?? e}`);
  } finally {
    refresh?.();
  }
}
