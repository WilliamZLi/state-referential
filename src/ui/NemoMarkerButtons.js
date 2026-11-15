import { runRestoreFlow } from './nemoRestoreFlow.js';

const BTN = 'l3-nemo-restore-btn';
const EVENTS = ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED'];

/** deps: { $, getChat, getMeta, restoreChapter, unfoldLatest, confirm, toast, isBusy, saveMeta, onChange (panel.refresh), eventSource, event_types } */
export function mountNemoMarkerButtons(deps) {
  const { $, getChat, eventSource, event_types } = deps;

  const decorate = (mesEl) => {
    const $mes = $(mesEl);
    const msg = getChat()?.[Number($mes.attr('mesid'))];
    if (msg?.extra?.l3Kind !== 'nemo-chapter') return;
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
