// src/ui/WorldBindingPrompt.js
import { loadTemplate } from './shared.js';

export class WorldBindingPrompt {
  constructor(worldRegistry, deps) {
    this.registry = worldRegistry;
    this.deps = deps;
    // deps: { worldBinder, getSettings, saveSettingsDebounced }
    this._$prompt = null;
  }

  /**
   * Show the binding prompt above the chat input.
   * Resolves when the user confirms or skips.
   */
  async show() {
    // Don't show if user has turned it off in settings
    const s = this.deps.getSettings?.() ?? {};
    if (s.worldBindingPromptDisabled) return;

    const html = await loadTemplate('world-binding-prompt');
    const $f = $(html);

    // Populate existing worlds dropdown
    const $sel = $('#strk-bind-world-select', $f).empty();
    for (const w of this.registry.list()) {
      $sel.append($('<option></option>').val(w.id).text(w.name));
    }

    // Show/hide select/input based on radio
    const syncVisibility = () => {
      const choice = $('input[name="strk-bind-choice"]:checked', $f).val();
      $('#strk-bind-world-select', $f).toggle(choice === 'existing');
      $('#strk-bind-new-name', $f).toggle(choice === 'new');
    };
    $('input[name="strk-bind-choice"]', $f).on('change', syncVisibility);
    syncVisibility();

    return new Promise((resolve) => {
      $('#strk-bind-confirm', $f).on('click', async () => {
        const choice = $('input[name="strk-bind-choice"]:checked', $f).val();
        $f.remove();
        if (choice === 'none') { resolve(null); return; }
        if (choice === 'existing') {
          const worldId = $('#strk-bind-world-select', $f).val();
          if (worldId) await this.deps.worldBinder?.bindCurrentChat?.(worldId);
        } else if (choice === 'new') {
          const name = $('#strk-bind-new-name', $f).val().trim() || 'New World';
          await this.deps.worldBinder?.bindCurrentChatToNewWorld?.(name);
        }
        resolve(choice);
      });
      $('#strk-bind-skip', $f).on('click', () => { $f.remove(); resolve(null); });

      // Render above the chat input
      const $target = $('#send_form, #chat, #sheld').first();
      $target.prepend($f);
    });
  }
}
