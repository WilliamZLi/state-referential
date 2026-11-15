import { peekNemoState, isNemoEnabled, setNemoEnabled } from '../nemo/state.js';
import { resolveNemoSettings } from '../nemo/settings.js';
import { chatUsesBuiltinSummary } from '../nemo/warnings.js';
import { parseNemoNumber, compactResultMessage, renderChapterList, NEMO_BUSY_TEXT } from './nemoUiLogic.js';
import { runRestoreFlow } from './nemoRestoreFlow.js';

export { renderChapterList };

const NUM_FIELDS = [
  ['#strk-nemo-threshold', 'thresholdTokens'],
  ['#strk-nemo-multiplier', 'multiplier'],
  ['#strk-nemo-keeplast', 'keepLast'],
  ['#strk-nemo-keeprecaps', 'keepRecaps'],
  ['#strk-nemo-chaptertokens', 'chapterTokens'],
  ['#strk-nemo-earliertokens', 'earlierTokens'],
];

/** deps: see task brief + { isBusy (compaction running OR a reply generating), saveMeta }. Returns { refresh }. */
export function mountNemoPanel(deps) {
  const { $, getMeta, getChat, store, save, toast, eventSource, event_types } = deps;
  const busyGate = () => { if (deps.isBusy()) { toast.info(NEMO_BUSY_TEXT); return true; } return false; };
  const settings = () => resolveNemoSettings(store());

  function refresh() {
    const meta = getMeta();
    const bound = !!meta?.trackerWorldId;
    $('#strk-nemo-enabled').prop('checked', !bound && isNemoEnabled(meta)).prop('disabled', bound);
    $('#strk-nemo-bound-note').toggleClass('strk-hidden', !bound);
    $('#strk-nemo-compact-now').prop('disabled', !isNemoEnabled(meta));
    const s = settings();
    $('#strk-nemo-mode').val(s.mode);
    for (const [id, key] of NUM_FIELDS) $(id).val(s[key]);
    const est = deps.getLastEstimate();
    $('#strk-nemo-estimate').text(est == null
      ? 'No measurement yet'
      : `Last prompt ≈ ${Number(est).toLocaleString()} tokens (threshold ${Number(s.thresholdTokens).toLocaleString()})`);
    const markers = new Set((getChat() ?? []).map(m => m?.extra?.nemoChapterId).filter(Boolean));
    $('#strk-nemo-chapters').html(renderChapterList(peekNemoState(meta), id => markers.has(id)));
  }

  $('#strk-nemo-enabled').on('change', e => {
    const on = e.target.checked;
    if (!setNemoEnabled(getMeta(), on)) { refresh(); return; }
    deps.saveMeta();
    if (on) {
      if (!deps.hasSlot()) toast.warning('No enabled {{summary}} slot in the active preset — recaps would go nowhere.');
      if (chatUsesBuiltinSummary(getChat())) toast.warning("This chat uses SillyTavern's built-in Summarize — its summary is replaced by Nemo recaps while chapters exist.");
    }
    refresh();
  });

  $('#strk-nemo-mode').on('change', e => { store().mode = e.target.value; save(); });
  for (const [id, key] of NUM_FIELDS) {
    $(id).on('change', e => {
      const n = parseNemoNumber(key, e.target.value);
      if (n === null) { $(id).val(settings()[key]); return; }
      store()[key] = n; save();
    });
  }

  // Run an async op with error reporting; always refresh afterwards.
  const guarded = async (label, fn) => {
    try { await fn(); }
    catch (e) { console.error(`[nemo] ${label} failed`, e); toast.error(`${label} failed: ${e?.message ?? e}`); }
    finally { refresh(); }
  };

  $('#strk-nemo-compact-now').on('click', () => {
    if (busyGate()) return;
    return guarded('Compact', async () => {
      const m = compactResultMessage(await deps.compactNow());
      toast[m.level](m.text);
    });
  });

  $('#strk-nemo-restore-all').on('click', async () => {
    if (busyGate()) return;
    if (!(await deps.confirm('Unfold all and restore every chapter?'))) return;
    if (busyGate()) return; // a reply may have started while the dialog was open
    const had = (peekNemoState(getMeta())?.chapters ?? []).length > 0;
    return guarded('Restore everything', async () => {
      const r = await deps.restoreAll();
      if ((r?.restored ?? 0) > 0) toast.success(`Restored ${r.restored} chapter(s).`);
      else if (had) toast.warning("Couldn't restore everything — a chapter marker is missing.");
    });
  });

  $('#strk-nemo-chapters').on('click', '[data-nemo-restore]', e => {
    runRestoreFlow(deps, String($(e.currentTarget).attr('data-nemo-restore')), refresh);
  });
  $('#strk-nemo-chapters').on('click', '[data-nemo-unfold]', () => {
    if (busyGate()) return;
    return guarded('Unfold', () => deps.unfoldLatest());
  });

  // CHARACTER_MESSAGE_RENDERED: the estimate measured for that reply is in by now.
  // MESSAGE_DELETED: a deleted marker shows up as "(marker missing)".
  for (const name of ['CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_DELETED']) {
    if (event_types[name]) eventSource.on(event_types[name], refresh);
  }
  refresh();
  return { refresh };
}
