export class SceneTagsUI {
  constructor(engine, $container, opts = {}) {
    this.engine = engine;
    this.$el = $container;
    this.defaults = opts.defaults ?? ['combat','exploration','social','fashion','sexual'];
    this._dialogs = opts.dialogs ?? null;
    // Re-render on tag toggles, and on events that reload active tags WITHOUT a
    // tag-changed emit: chat-switch / world-bind (backend-changed) and undo/redo
    // (state-restored). Without these, persisted tags render unhighlighted on
    // reload until the first manual click.
    this.engine.on('tracker:tag-changed', () => this.render());
    this.engine.on('tracker:backend-changed', () => this.render());
    this.engine.on('tracker:state-restored', () => this.render());
    this.render();
  }
  render() {
    this.$el.empty();
    const known = new Set([...this.defaults, ...this.engine.listActiveTags()]);
    for (const tag of [...known].sort()) {
      const $chip = $('<span class="strk-tag"></span>').text(tag);
      if (this.engine.isTagActive(tag)) $chip.addClass('active');
      $chip.on('click', () => this.engine.toggleSceneTag(tag));
      this.$el.append($chip);
    }
    const $add = $('<span class="strk-tag strk-add-tag" title="Add tag">+</span>').on('click', async () => {
      const t = this._dialogs
        ? await this._dialogs.prompt('New scene tag:')
        : prompt('New scene tag:');
      if (t) this.engine.setSceneTag(t.trim(), true);
    });
    this.$el.append($add);
  }
}