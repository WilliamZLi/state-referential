import { peekNemoState } from '../nemo/state.js';
import { restoreIntent, restoreConfirmText, NEMO_BUSY_TEXT } from './nemoUiLogic.js';

/**
 * Shared restore flow for panel + marker buttons.
 * deps: { getMeta, restoreChapter, unfoldAndRestore, confirm, toast, isBusy }
 * isBusy is re-checked right before the (single) mutating call: a reply may
 * have started while the confirm dialog was open.
 */
export async function runRestoreFlow(deps, chapterId, refresh) {
  if (deps.isBusy()) { deps.toast.info(NEMO_BUSY_TEXT); return; }
  const intent = restoreIntent(peekNemoState(deps.getMeta()), chapterId);
  if (!intent) { deps.toast.warning("Couldn't restore — the chapter's marker is missing."); refresh?.(); return; }
  if (!(await deps.confirm(restoreConfirmText(intent)))) return;
  if (deps.isBusy()) { deps.toast.info(NEMO_BUSY_TEXT); return; }
  try {
    const r = intent.kind === 'folded'
      ? await deps.unfoldAndRestore(chapterId)
      : await deps.restoreChapter(chapterId);
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
