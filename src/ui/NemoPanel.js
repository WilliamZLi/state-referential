import { peekNemoState, isNemoEnabled, setNemoEnabled } from '../nemo/state.js';
import { resolveNemoSettings } from '../nemo/settings.js';
import { chatUsesBuiltinSummary } from '../nemo/warnings.js';
import { parseNemoNumber, compactResultMessage, renderChapterList } from './nemoUiLogic.js';
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

/** deps: see task brief + { isBusy, saveMeta }. Returns { refresh }. */
export function mountNemoPanel(deps) {
  const { $, getMeta, getChat, store, save, toast, eventSource, event_types } = deps;
  const busyGate = () => { if (deps.isBusy()) { toast.info('Compaction in progress'); return true; } return false; };
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
    $('#strk-nemo-chapters').html(renderChapterList(peekNemoState(meta)));
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

  $('#strk-nemo-compact-now').on('click', async () => {
    if (busyGate()) return;
    const m = compactResultMessage(await deps.compactNow());
    toast[m.level](m.text);
    refresh();
  });

  $('#strk-nemo-restore-all').on('click', async () => {
    if (busyGate()) return;
    const had = (peekNemoState(getMeta())?.chapters ?? []).length > 0;
    if (!(await deps.confirm('Unfold all and restore every chapter?'))) return;
    const r = await deps.restoreAll();
    if ((r?.restored ?? 0) > 0) toast.success(`Restored ${r.restored} chapter(s).`);
    else if (had) toast.warning("Couldn't restore everything — a chapter marker is missing.");
    refresh();
  });

  $('#strk-nemo-chapters').on('click', '[data-nemo-restore]', e => {
    runRestoreFlow(deps, String($(e.currentTarget).attr('data-nemo-restore')), refresh);
  });
  $('#strk-nemo-chapters').on('click', '[data-nemo-unfold]', async () => {
    if (busyGate()) return;
    await deps.unfoldLatest();
    refresh();
  });

  if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, refresh);
  refresh();
  return { refresh };
}
