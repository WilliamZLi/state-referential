/**
 * Register Layer 3 mainline slash commands.
 * @param {object} deps - {
 *   SlashCommandParser, SlashCommand,
 *   compaction: { run(opts) },
 *   restore(archiveId), actComplete(title),
 *   toggleAnchorAtSlash(reason), gotoMainline(),
 * }
 */
export function register(deps) {
  const reg = (name, fn, help) => deps.SlashCommandParser.addCommandObject(deps.SlashCommand.fromProps({
    name, callback: fn, helpString: help ?? '', returns: 'string',
  }));

  reg('anchor', (args, value) => {
    deps.toggleAnchorAtSlash(String(value ?? '').trim());
    return '';
  }, '/anchor [reason] — toggle anchor on the message containing this command');

  reg('compact-now', async (args, value) => {
    const v = String(value ?? '').trim();
    const n = Number(v);
    const opts = (v && Number.isFinite(n)) ? { count: n } : {};
    const r = await deps.compaction.run(opts);
    return r.compacted ? `Compacted ${r.count} messages.` : 'Nothing to compact.';
  }, '/compact-now [count] — compact oldest messages');

  reg('compact-restore', async (args, value) => {
    const r = await deps.restore(String(value ?? '').trim());
    return r.restored ? `Restored ${r.count} messages.` : 'Archive not found.';
  }, '/compact-restore <archiveId>');

  reg('act-complete', async (args, value) => {
    await deps.actComplete(String(value ?? '').trim());
    return '';
  }, '/act-complete <title> — append a chronicle entry and mark the mainline');

  reg('mainline-go', async () => { await deps.gotoMainline(); return ''; },
    '/mainline-go — switch to this World\'s mainline chat');

  reg('scene-here', async (args, value) => {
    await deps.branchCreate?.({ title: String(value ?? '').trim() || 'Scene', lastN: deps.branchLastN?.() ?? 10, inheritTags: true });
    return '';
  }, '/scene-here [title] — start a side-scene from the current message');

  reg('scene-discard', async () => { await deps.branchDiscard?.(); return ''; },
    '/scene-discard — discard the current side-scene (rolls the World back)');

  reg('scene-return', async () => { await deps.branchReturn?.(); return ''; },
    '/scene-return — return to the mainline (side-scene recap spliced in as narration, scene kept read-only)');
}
