// src/ui/WorldManager.js
import { loadTemplate } from './shared.js';

export class WorldManager {
  constructor(worldRegistry, deps) {
    this.registry = worldRegistry;
    this.deps = deps;
    // deps: { worldBinding, worldBinder, callGenericPopup, POPUP_TYPE, dialogs,
    //         serverApi, getWorldView, refreshChronicle }
    this.$el = null;
  }

  async mount($container) {
    const html = await loadTemplate('world-manager');
    this.$el = $(html);
    $container.append(this.$el);
    this._wire();
    this.render();
    return this;
  }

  render() {
    if (!this.$el) return;
    this._renderCurrentBinding();
    this._renderWorldList();
  }

  _renderCurrentBinding() {
    const $el = $('#strk-world-current-binding', this.$el).empty();
    const worldId = this.deps.worldBinding?.currentWorldId;
    if (!worldId) {
      $el.text('Current chat: unbound (chat-scoped trackers)');
      return;
    }
    const world = this.registry.get(worldId);
    const name = world?.name ?? worldId;
    $el.html(`Current chat: bound to <strong>${name}</strong> &nbsp;`);
    const $unbind = $('<button class="menu_button strk-world-unbind">Unbind</button>');
    $unbind.on('click', async () => {
      if (!await this.deps.dialogs?.confirm?.(`Unbind this chat from "${name}"? Tracker state will be copied to the chat.`)) return;
      await this.deps.worldBinder?.unbindCurrentChat?.();
      this.render();
    });
    $el.append($unbind);
  }

  _renderWorldList() {
    const $list = $('#strk-world-list', this.$el).empty();
    const worlds = this.registry.list();
    if (!worlds.length) { $list.text('(no worlds yet)'); return; }
    for (const w of worlds) {
      const $row = $('<div class="strk-world-row"></div>');
      $row.append($('<span class="strk-world-name"></span>').text(w.name));
      if (w.mainlineChatId) $row.append($('<span class="strk-world-badge">linked</span>'));

      const $open = $('<button class="menu_button">Open</button>');
      if (this.deps.worldBinding?.currentWorldId === w.id) {
        $open.on('click', () => this.deps.getWorldView?.(w.id));
      } else {
        $open.prop('disabled', true).attr('title', 'Open the chat bound to this world to view or edit it');
      }
      $row.append($open);

      const $export = $('<button class="menu_button">Export</button>');
      $export.on('click', async () => {
        try {
          const blob = await this.deps.serverApi?.exportWorld(w.id);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `world-${w.id}.json`; a.click();
          URL.revokeObjectURL(url);
        } catch (e) { this.deps.dialogs?.alert?.(`Export failed: ${e.message}`); }
      });
      $row.append($export);

      const $del = $('<button class="menu_button">Delete</button>');
      $del.on('click', async () => {
        if (!await this.deps.dialogs?.confirm?.(`Delete World "${w.name}"? It will be moved to _deleted/ and recoverable for 30 days.`)) return;
        await this.registry.delete(w.id);
        this.render();
      });
      $row.append($del);

      $list.append($row);
    }
  }

  _wire() {
    $('#strk-world-new', this.$el).on('click', async () => {
      const name = await this.deps.dialogs?.prompt?.('World name:') ?? prompt('World name:');
      if (!name) return;
      await this.registry.create({ name });
      this.render();
    });

    $('#strk-world-import', this.$el).on('click', async () => {
      const j = await this.deps.dialogs?.prompt?.('Paste world export JSON:') ?? prompt('Paste:');
      if (!j) return;
      try {
        const bundle = JSON.parse(j);
        await this.deps.serverApi?.importWorld(bundle);
        await this.registry.init();
        this.render();
      } catch (e) { this.deps.dialogs?.alert?.(`Import failed: ${e.message}`); }
    });
  }
}
