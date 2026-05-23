/**
 * Click-popup helper. Single popup at a time. Driven by ST's callGenericPopup if available.
 * @param {object} deps - { callGenericPopup, POPUP_TYPE }
 */
export function makePopup(deps) {
  return {
    /**
     * @param {string|HTMLElement|jQuery} body
     * @param {object} opts - { title?, actions?: [{label, fn}] }
     */
    async show(body, opts = {}) {
      const wrapper = $('<div class="strk-popup-body"></div>');
      if (opts.title) wrapper.append($('<h4></h4>').text(opts.title));
      if (typeof body === 'string') wrapper.append(body); else wrapper.append(body);
      if (deps.callGenericPopup) {
        await deps.callGenericPopup(wrapper[0], deps.POPUP_TYPE?.DISPLAY ?? 1, '', { wide: false, large: false });
      } else {
        // Fallback: append to body, click-outside dismiss
        const $shroud = $('<div class="strk-popup-shroud"></div>').css({
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 2000,
        }).appendTo('body');
        const $card = $('<div class="strk-popup-card"></div>').css({
          position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
          background: '#222', color: '#ddd', padding: '12px', borderRadius: '6px', zIndex: 2001,
        }).append(wrapper).appendTo('body');
        $shroud.on('click', () => { $shroud.remove(); $card.remove(); });
        $(document).one('keydown.strk-popup', (e) => { if (e.key === 'Escape') { $shroud.remove(); $card.remove(); } });
      }
    },
  };
}