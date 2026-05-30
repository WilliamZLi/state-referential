// src/ui/WorldView.js
import { loadTemplate } from './shared.js';

export class WorldView {
  constructor(worldRegistry, deps) {
    this.registry = worldRegistry;
    this.deps = deps;
    // deps: { callGenericPopup, POPUP_TYPE, chronicleOps, getChronicle,
    //         chronicleInjection, serverApi, closePopup }
  }

  async open(worldId) {
    const world = this.registry.get(worldId);
    if (!world) return;

    const html = await loadTemplate('world-view');
    const $f = $(html);

    $('#strk-wv-name', $f).val(world.name);
    $('#strk-wv-narrator-hint', $f).val(world.narratorCardHint ?? '');
    const created = new Date(world.createdAt).toLocaleDateString();
    const mainlineText = world.mainlineChatId ? 'Mainline: linked' : 'Mainline: none';
    $('#strk-wv-info', $f).text(`Created: ${created} · ${mainlineText}`);

    // Chronicle config
    const chronicle = this.deps.getChronicle?.();
    const config = chronicle?.getConfig() ?? { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200 };
    $('#strk-chron-window', $f).val(config.verbatimWindow);
    $('#strk-chron-strategy', $f).val(config.updateStrategy);
    $('#strk-chron-bp-cap', $f).val(config.bigPictureTokenCap);
    $('#strk-chron-entry-cap', $f).val(config.entryTokenCap);

    // Big picture display
    $('#strk-wv-bigpicture', $f).text(chronicle?.getBigPicture() || '(none yet)');

    // Entries list
    const $entries = $('#strk-wv-entries', $f).empty();
    const entries = chronicle?.getEntries() ?? [];
    if (!entries.length) $entries.text('(no acts yet)');
    for (const e of [...entries].reverse()) {
      const $row = $('<div class="strk-chronicle-entry"></div>');
      $row.append($('<strong></strong>').text(e.title));
      $row.append($('<span class="strk-entry-date"></span>').text(` — ${new Date(e.createdAt).toLocaleDateString()}`));
      $row.append($('<p></p>').text(e.body));
      $entries.append($row);
    }

    // Save config
    $('#strk-chron-save-config', $f).on('click', async () => {
      const newConfig = {
        verbatimWindow: parseInt($('#strk-chron-window', $f).val(), 10) || 5,
        updateStrategy: $('#strk-chron-strategy', $f).val(),
        bigPictureTokenCap: parseInt($('#strk-chron-bp-cap', $f).val(), 10) || 300,
        entryTokenCap: parseInt($('#strk-chron-entry-cap', $f).val(), 10) || 200,
      };
      chronicle?.setConfig(newConfig);
      // Persist config to server (world.json chronicleConfig)
      await this.registry.update(worldId, { chronicleConfig: newConfig });
    });

    // Regenerate big picture
    $('#strk-chron-refresh-bp', $f).on('click', async () => {
      const ops = this.deps.chronicleOps;
      if (!ops) return;
      await ops._regenerateAllBigPicture(chronicle.getConfig().bigPictureTokenCap);
      this.deps.chronicleInjection?.run?.();
      $('#strk-wv-bigpicture', $f).text(chronicle.getBigPicture() || '(none)');
    });

    // Save metadata
    $('#strk-wv-save', $f).on('click', async () => {
      await this.registry.update(worldId, {
        name: $('#strk-wv-name', $f).val().trim() || world.name,
        narratorCardHint: $('#strk-wv-narrator-hint', $f).val().trim() || null,
      });
    });

    // Export
    $('#strk-wv-export', $f).on('click', async () => {
      try {
        const blob = await this.deps.serverApi?.exportWorld(worldId);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `world-${worldId}.json`; a.click();
        URL.revokeObjectURL(url);
      } catch (e) { alert(`Export failed: ${e.message}`); }
    });

    $('#strk-wv-close', $f).on('click', () => this.deps.closePopup?.($f));

    await this.deps.callGenericPopup($f[0], this.deps.POPUP_TYPE?.DISPLAY ?? 1, '', { wide: true, large: true });
  }
}
