import { runRestoreFlow } from './nemoRestoreFlow.js';
import { peekNemoState } from '../nemo/state.js';
import { renderMarkerRecap } from './nemoUiLogic.js';

const BTN = 'l3-nemo-restore-btn';
const EVENTS = ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED'];

/** deps: { $, getChat, getMeta, restoreChapter, unfoldAndRestore, confirm, toast, isBusy, saveMeta, onChange (panel.refresh), eventSource, event_types } */
export function mountNemoMarkerButtons(deps) {
  const { $, getChat, eventSource, event_types } = deps;

  // Display-only recap block inside .mes_block after .mes_text; idempotent via a signature.
  const decorateRecap = ($mes, msg) => {
    const $block = $mes.find('.mes_block').first();
    if (!$block.length) return;
    const $old = $block.children('.strk-nemo-recap').first();
    const id = msg.extra.nemoChapterId;
    const ch = id ? peekNemoState(deps.getMeta?.())?.chapters?.find(c => c.id === id) : null;
    const html = renderMarkerRecap(ch);
    if (!html) { $old.remove(); return; }
    const sig = `${ch.id}|${ch.status}|${String(ch.recap).length}`;
    if ($old.length && $old.attr('data-sig') === sig) return;
    const $new = $(html).attr('data-sig', sig);
    $old.remove();
    const $text = $block.children('.mes_text').first();
    if ($text.length) $text.after($new); else $block.append($new);
  };

  const decorate = (mesEl) => {
    const $mes = $(mesEl);
    const msg = getChat()?.[Number($mes.attr('mesid'))];
    if (msg?.extra?.l3Kind !== 'nemo-chapter') return;
    decorateRecap($mes, msg);
    if ($mes.find('.' + BTN).length) return;
    const $row = $mes.find('.extraMesButtons').first();
    if (!$row.length) return;
    const $b = $(`<div class="mes_button ${BTN} fa-solid fa-rotate-left" title="Restore this chapter"></div>`);
    $b.on('click', () => {
      const m = getChat()?.[Number($mes.attr('mesid'))];
      const id = m?.extra?.nemoChapterId;
      if (id) runRestoreFlow(deps, id, afterOp);
    });
    $row.prepend($b);
  };

  const afterOp = () => { decorateAll(); deps.onChange?.(); };
  const decorateAll = () => { for (const el of document.querySelectorAll('#chat .mes')) decorate(el); };

  for (const name of EVENTS) {
    const t = event_types[name];
    if (t) eventSource.on(t, () => decorateAll());
  }
  decorateAll();
  return decorateAll;
}
