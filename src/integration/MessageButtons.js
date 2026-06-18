import { toggleAnchor, isAnchored } from '../pipeline/Anchors.js';

const PIN = 'l3-anchor-btn';
// ST message-render + chat refresh events; the `if (event_types[name])` guard
// below skips any that don't exist on this ST build.
const EVENTS = ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED'];

/**
 * Mount per-message anchor controls. deps: { $, getChat, eventSource, event_types, saveChat }
 */
export function mountMessageButtons(deps) {
  const { $, getChat, eventSource, event_types, saveChat } = deps;

  const decorate = (mesEl) => {
    const $mes = $(mesEl);
    const idx = Number($mes.attr('mesid'));
    const msg = getChat()?.[idx];
    if (!msg) return;
    $mes.toggleClass('l3-anchored', isAnchored(msg));
    const existing = $mes.find('.' + PIN);
    if (existing.length) { existing.toggleClass('active', isAnchored(msg)); return; } // already decorated — just sync state
    const $row = $mes.find('.extraMesButtons').first();
    if (!$row.length) return; // no hover-button row yet
    const $pin = $(`<div class="mes_button ${PIN} fa-solid fa-thumbtack" title="Anchor (exclude from compaction)"></div>`);
    $pin.toggleClass('active', isAnchored(msg));
    $pin.on('click', () => {
      const m = getChat()?.[Number($mes.attr('mesid'))];
      if (!m) return;
      toggleAnchor(m, '', Date.now());
      saveChat();
      $mes.toggleClass('l3-anchored', isAnchored(m));
      $pin.toggleClass('active', isAnchored(m));
    });
    $row.prepend($pin);
  };

  const decorateAll = () => { for (const el of document.querySelectorAll('#chat .mes')) decorate(el); };

  for (const name of EVENTS) {
    const t = event_types[name];
    if (t) eventSource.on(t, () => decorateAll());
  }
  decorateAll();
  return decorateAll;
}
