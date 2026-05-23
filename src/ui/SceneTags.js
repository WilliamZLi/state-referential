export class SceneTagsUI {
  constructor(engine, $container, opts = {}) {
    this.engine = engine;
    this.$el = $container;
    this.defaults = opts.defaults ?? ['intimate','combat','social','exploration'];
    this.engine.on('tracker:tag-changed', () => this.render());
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
    const $add = $('<span class="strk-tag strk-add-tag" title="Add tag">+</span>').on('click', () => {
      const t = prompt('New scene tag:');
      if (t) this.engine.setSceneTag(t.trim(), true);
    });
    this.$el.append($add);
  }
}