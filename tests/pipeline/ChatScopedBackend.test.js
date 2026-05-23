import { test } from 'node:test';
import assert from 'node:assert';
import { ChatScopedBackend } from '../../src/pipeline/ChatScopedBackend.js';

function mkCtx() {
  const ctx = {
    chat: [{ extra: {} }, { extra: {} }],
    chatMetadata: {},
    saveChatConditionalCalls: 0,
    saveSettingsDebouncedCalls: 0,
  };
  const extension_settings = {};
  ctx.getChat = () => ctx.chat;
  ctx.getExtensionSettings = () => extension_settings;
  ctx.saveChatConditional = () => { ctx.saveChatConditionalCalls++; };
  ctx.saveSettingsDebounced = () => { ctx.saveSettingsDebouncedCalls++; };
  return ctx;
}

test('reads+writes chat.extra.trackers.*', () => {
  const ctx = mkCtx();
  const b = new ChatScopedBackend(ctx, { debounceMs: 1 });
  b.saveSubjects({ subjects: [{ id: 'p', name: 'L' }], protagonistId: 'p' });
  b.saveValues({ p: { outfit: { topwear: { v: 'red', lastTouchedMsg: null } } } });
  b.saveDescriptions({ global: {}, perSubject: {} });
  b.saveSceneTags(['intimate']);
  b.saveSnapshots({});
  // Container lives on the last chat message's extra (or a sticky chat-level container)
  const stored = ctx.chatMetadata.trackers ?? ctx.chat[0].extra.trackers ?? b._readContainer();
  assert.deepStrictEqual(b.loadSubjects().protagonistId, 'p');
  assert.deepStrictEqual(b.loadValues().p.outfit.topwear.v, 'red');
  assert.deepStrictEqual(b.loadSceneTags(), ['intimate']);
});

test('definitions go to extension_settings', () => {
  const ctx = mkCtx();
  const b = new ChatScopedBackend(ctx);
  b.saveDefinitions([{ id: 'x', label: 'X', fields: [] }]);
  assert.strictEqual(b.loadDefinitions()[0].id, 'x');
  assert.strictEqual(ctx.getExtensionSettings()['state-referential'].definitions[0].id, 'x');
});

test('saves are debounced; flush forces immediate', async () => {
  const ctx = mkCtx();
  const b = new ChatScopedBackend(ctx, { debounceMs: 50 });
  b.saveValues({ p: {} });
  b.saveValues({ p: {} });
  assert.strictEqual(ctx.saveChatConditionalCalls, 0);
  await b.flush();
  assert.ok(ctx.saveChatConditionalCalls >= 1);
});

test('handles missing chat gracefully', () => {
  const ctx = mkCtx();
  ctx.chat = [];
  const b = new ChatScopedBackend(ctx);
  assert.deepStrictEqual(b.loadSubjects(), { subjects: [], protagonistId: null });
  // saveValues with no chat is a no-op write (queued; would land when chat appears)
  b.saveValues({ p: {} });
});
