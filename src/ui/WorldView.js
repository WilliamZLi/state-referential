// src/ui/WorldView.js
import { loadTemplate } from './shared.js';

export class WorldView {
  constructor(worldRegistry, deps) {
    this.registry = worldRegistry;
    this.deps = deps;
    // deps: { callGenericPopup, POPUP_TYPE, chronicleOps, getChronicle,
    //         chronicleInjection, serverApi, closePopup, persistChronicle, dialogs }
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
    const config = chronicle?.getConfig() ?? { verbatimWindow: 5, updateStrategy: 'lazy', bigPictureTokenCap: 300, entryTokenCap: 200, maxActMessages: 60 };
    $('#strk-chron-window', $f).val(config.verbatimWindow);
    $('#strk-chron-strategy', $f).val(config.updateStrategy);
    $('#strk-chron-bp-cap', $f).val(config.bigPictureTokenCap);
    $('#strk-chron-entry-cap', $f).val(config.entryTokenCap);
    $('#strk-chron-max-msgs', $f).val(config.maxActMessages ?? 60);

    // Big picture display
    $('#strk-wv-bigpicture', $f).text(chronicle?.getBigPicture() || '(none yet)');

    // Entries list
    const renderEntries = () => {
      const $entries = $('#strk-wv-entries', $f).empty();
      const entries = chronicle?.getEntries() ?? [];

      // Insert act button
      const $insertBtn = $('<button class="menu_button" style="margin-bottom:8px">+ Insert act manually</button>');
      $insertBtn.on('click', async () => {
        const title = await (this.deps.dialogs?.prompt?.('Act title:') ?? Promise.resolve(prompt('Act title:')));
        if (!title?.trim()) return;
        const body = await (this.deps.dialogs?.prompt?.('Act body (summary):') ?? Promise.resolve(prompt('Act body:')));
        if (body == null) return;
        chronicle.appendEntry(title.trim(), body.trim(), null);
        await this.deps.persistChronicle?.();
        this.deps.chronicleInjection?.run?.();
        renderEntries();
      });
      $entries.append($insertBtn);

      if (!entries.length) { $entries.append($('<div>(no acts yet)</div>')); return; }

      for (const e of [...entries].reverse()) {
        const $row = $('<div class="strk-chronicle-entry"></div>');
        const $header = $('<div class="strk-entry-header"></div>');
        $header.append($('<strong></strong>').text(e.title));
        $header.append($('<span class="strk-entry-date"></span>').text(` — ${new Date(e.createdAt).toLocaleDateString()}`));

        const $editBtn = $('<button class="menu_button strk-entry-btn">Edit</button>');
        $editBtn.on('click', async () => {
          const $form = $('<div style="padding:8px;display:flex;flex-direction:column;gap:10px;min-width:400px"></div>');
          $form.append($(`<label style="display:flex;flex-direction:column;gap:4px;font-size:12px">Title<input type="text" class="text_pole" value="${$('<div>').text(e.title).html()}" /></label>`));
          $form.append($(`<label style="display:flex;flex-direction:column;gap:4px;font-size:12px">Body<textarea class="text_pole" rows="6" style="width:100%;box-sizing:border-box;resize:vertical">${$('<div>').text(e.body).html()}</textarea></label>`));
          const confirmed = await this.deps.callGenericPopup($form[0], this.deps.POPUP_TYPE?.CONFIRM ?? 0, 'Edit Act', {});
          if (!confirmed) return;
          const newTitle = $('input', $form).val().trim() || e.title;
          const newBody = $('textarea', $form).val().trim();
          chronicle.updateEntry(e.id, { title: newTitle, body: newBody });
          await this.deps.persistChronicle?.();
          this.deps.chronicleInjection?.run?.();
          renderEntries();
        });

        const $delBtn = $('<button class="menu_button strk-entry-btn strk-danger">×</button>');
        $delBtn.on('click', async () => {
          const ok = await (this.deps.dialogs?.confirm?.(`Delete act "${e.title}"?`) ?? Promise.resolve(confirm(`Delete act "${e.title}"?`)));
          if (!ok) return;
          chronicle.deleteEntry(e.id);
          await this.deps.persistChronicle?.();
          this.deps.chronicleInjection?.run?.();
          renderEntries();
        });

        $header.append($editBtn).append($delBtn);
        $row.append($header);
        $row.append($('<p></p>').text(e.body));
        $entries.append($row);
      }
    };
    renderEntries();

    // Save config
    $('#strk-chron-save-config', $f).on('click', async () => {
      const newConfig = {
        verbatimWindow: parseInt($('#strk-chron-window', $f).val(), 10) || 5,
        updateStrategy: $('#strk-chron-strategy', $f).val(),
        bigPictureTokenCap: parseInt($('#strk-chron-bp-cap', $f).val(), 10) || 300,
        entryTokenCap: parseInt($('#strk-chron-entry-cap', $f).val(), 10) || 200,
        maxActMessages: parseInt($('#strk-chron-max-msgs', $f).val(), 10) || 60,
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
