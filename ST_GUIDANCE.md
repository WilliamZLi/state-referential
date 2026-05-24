# SillyTavern Integration Notes

Lessons learned while building this extension. Save future selves an hour each.

## Imports

`getContext` is no longer exported from `script.js` in recent ST (≥ 1.12.x).
Use the global instead:

```js
import { eventSource, event_types, saveSettingsDebounced, saveChatConditional, setExtensionPrompt } from '../../../../script.js';
const getContext = () => window.SillyTavern.getContext();
```

Other reliable imports:

```js
import { extension_settings } from '../../../extensions.js';
import { MacrosParser } from '../../../macros.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
```

These paths assume the extension is at `public/scripts/extensions/third-party/<name>/`.

## Extension menu button

To register an entry in ST's extensions submenu, append to `#extensionsMenu` with this markup
(matches built-in entries so it inherits theming):

```js
const $btn = $(`
  <div id="<your-id>" class="list-group-item flex-container flexGap5 interactable" title="..." tabindex="0">
    <i class="fa-solid fa-<your-icon> extensionsMenuExtensionButton"></i>
    <span>Your Label</span>
  </div>
`);
$btn.on('click', () => /* toggle your UI */);
$('#extensionsMenu').append($btn);
```

A bare `<div class="fa-solid fa-list-check">` won't render with a label or proper hover state.

## Settings drawer (foldable section under Extensions)

Wrap your drawer content in ST's standard `inline-drawer` markup so it folds open/closed:

```html
<div class="<your-namespace> inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>Your Extension</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <!-- your settings -->
  </div>
</div>
```

Mount with `$('#extensions_settings').append(html)`.

## Themed form controls

Plain `<input>` / `<select>` / `<textarea>` render with browser-default styling (pure
white in light mode, ugly in dark themes). Use ST's classes:

- `class="text_pole"` on `<input type="text|number">`, `<select>`, `<textarea>`
- `class="menu_button"` on `<button>` for the standard themed button look
- `class="menu_button strk-danger"` (or your own danger class) for destructive actions
- `class="list-group-item flex-container flexGap5"` for menu-like rows

## Popups (`callGenericPopup`)

```js
await callGenericPopup($contentEl, POPUP_TYPE.DISPLAY, '', { wide: false });
```

`POPUP_TYPE.DISPLAY` renders without any built-in OK/Cancel; you provide your own
buttons inside the content. `wide: true` widens the popup chrome.

**Closing a popup programmatically.** ST's popup markup has changed across versions.
Use a robust dismissal helper:

```js
function closePopup($contentJq) {
  // 1. Native <dialog>.close()
  const $dialog = $contentJq.closest('dialog');
  if ($dialog.length && typeof $dialog[0].close === 'function') {
    $dialog[0].close();
    return;
  }
  // 2. Known close-button selectors
  const $popup = $contentJq.closest('.popup, .popup_container, .dialogue_popup');
  for (const sel of ['.popup_cross', '.popup_close', '.popup-button-close',
                     '.menu_button.popup_button_cancel', '.popup_button_cancel',
                     '.fa-times', '.fa-xmark']) {
    const $btn = $popup.find(sel).first();
    if ($btn.length) { $btn.trigger('click'); return; }
  }
  // 3. Escape key fallback
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
```

Just relying on a single selector like `.popup_cross` will silently break in
versions where the cross button uses a different class.

## Auto-update / quiet generation

```js
const generateQuietPrompt = (text) => getContext().generateQuietPrompt(text, false, false);
```

The two booleans are `quiet_prompt_only` and `force_chat_completion`. Defaults are
fine for most state-tracker prompts.

Throttle ~500ms after `MESSAGE_RECEIVED` before triggering your own quiet generation
to avoid colliding with ST's own post-message work. Guard with an `IS_BUSY` flag to
prevent re-entry.

## Events (`eventSource` / `event_types`)

Reliably useful events:

| Event | Fires when |
|---|---|
| `MESSAGE_RECEIVED` | AI replied (also fires for some system messages — check `is_user` / `extra.from`) |
| `MESSAGE_SWIPED` | User clicked swipe arrow |
| `MESSAGE_EDITED` | User edited a message in place |
| `MESSAGE_DELETED` | Message deleted |
| `CHAT_CHANGED` | User switched chats (or opened ST landing → first chat) |
| `GENERATE_BEFORE_COMBINE_PROMPTS` | Just before ST builds the generation prompt — ideal time to refresh `setExtensionPrompt` injections |

`eventSource.on(event_types.X, handler)` does NOT return an unsubscribe function. Use
`eventSource.removeListener(event_types.X, handler)` if you need to detach (rare).

## Persistence

Two stores:

| Store | Lifetime | API |
|---|---|---|
| `extension_settings` (global per install) | Across all chats, persists in user's `settings.json` | Mutate object directly, call `saveSettingsDebounced()` |
| `chat.extra.*` (per-chat) | Tied to current chat | Mutate `getContext().chat[i].extra`, call `saveChatConditional()` |

For data spanning chat lifetime but tied to that chat (like your tracker subjects/values),
the cleanest pattern is `chatMetadata` (`getContext().chatMetadata` — persists with chat,
survives reload/swipe). Sticky "chat-level container" rather than nailing data to a
specific message's extra.

`saveChatConditional()` debounces by default; you don't need to wrap it.

## Macros

```js
MacrosParser.registerMacro('your-macro', (env, ...args) => {
  // env contains the rendering context (subject/character/etc.)
  // args is the parts after `::` in the macro
  return /* string substitution */;
});
```

Macros are referenced like `{{your-macro::arg1::arg2}}`.

Missing or null returns should be empty string, not `'undefined'` or `'null'`.

## Slash commands

```js
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
  name: 'your-cmd',
  callback: (namedArgs, unnamedValue) => '',
  helpString: '/your-cmd <args>',
  returns: 'string',
}));
```

The callback's `unnamedValue` is the rest of the line as a single string. **Tokenize
it yourself** — `.split(/\s+/)` breaks on quoted multi-word args. Use a regex tokenizer:

```js
function tokenize(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str ?? '')) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}
```

Return a string (even `''`) so the result can be piped through `{{pipe}}`.

## Prompt injection (`setExtensionPrompt`)

```js
setExtensionPrompt(key, text, position, depth);
```

- `key` — unique per injection slot. Calling with same key replaces; calling with empty `text` clears.
- `position` — **NUMERIC** value from ST's `extension_prompt_types` (defined in `public.js`). Passing strings silently fails (ST drops the injection entirely, no error logged). Values:
  - `-1` — NONE (disabled)
  - `0` — IN_PROMPT (main prompt body, after system, before chat history)
  - `1` — IN_CHAT (at a depth within chat history; uses the `depth` arg)
  - `2` — BEFORE_PROMPT (before the entire main prompt)
- `depth` — only meaningful for IN_CHAT (position=1). `0` = right at the bottom (closest to the AI's reply slot); higher = further up in the history.

If you store positions as readable strings in user-facing config, map them to numbers before calling:

```js
const POSITION_MAP = {
  'system':           0, // IN_PROMPT
  'in-prompt':        1, // IN_CHAT
  'author-note':      1, // IN_CHAT
  'before-char-defs': 2, // BEFORE_PROMPT
};
const resolvePosition = (p) => typeof p === 'number' ? p : (POSITION_MAP[p] ?? 1);
setExtensionPrompt(key, text, resolvePosition(positionString), depth);
```

This was a major bug for us — we passed string positions for weeks and wondered why the AI never saw our injections. The prompt inspector shows ST's `Extensions: N tokens` line still incrementing (counting our string-positioned injections in some token budget but not actually inserting the text). Always pass numbers.

Run your injection logic on `GENERATE_BEFORE_COMBINE_PROMPTS` so the injection always
reflects current state when ST is about to generate.

## Message identity

Messages do NOT carry stable UUIDs in ST natively. Lay your own on first observation:

```js
function ensureMyMsgId(message) {
  if (!message.extra) message.extra = {};
  if (!message.extra.<your_ns>_msgId) {
    message.extra.<your_ns>_msgId = crypto.randomUUID();
  }
  return message.extra.<your_ns>_msgId;
}
```

**Use a namespaced key** (`<your_ext>_msgId`), not a generic `msgId` or `trackerMsgId`,
to avoid collisions with other extensions. `message.extra` persists with the message
through save/load/swipe.

## Chat lifecycle

When `CHAT_CHANGED` fires, any cached references to the previous chat's data are stale.
If you have a per-chat backend, invalidate its cache on this event. The next `getChat()`
or `chatMetadata` read will see the new chat's data.

## Templates / fetching local files

To load your extension's HTML/JSON templates at runtime:

```js
const res = await fetch('scripts/extensions/third-party/<your-ext>/templates/foo.html');
```

This path is relative to ST's web root. Cache the responses; re-fetch on every modal
open wastes ~10ms.

## "First-run" UX

Don't auto-pop modals at extension init — ST's landing screen has no active chat and
your modal will appear over an empty page. Gate first-run prompts on:
1. A persistence flag (e.g. `firstRunComplete` in `extension_settings`)
2. `getContext().chat?.length > 0` (an actual chat is loaded)

Either save OR cancel of the modal should set the flag so dismissing once doesn't
result in it re-popping forever.

## CSS theme variables

For elements that should pick up the user's theme:

- `var(--SmartThemeBlurTintColor)` — panel/modal background
- `var(--SmartThemeBodyColor)` — body text
- `var(--SmartThemeBorderColor)` — borders/dividers
- `var(--SmartThemeQuoteColor)` — accent color (active tab, scene tag chip)

Always include sensible fallback values:
```css
background: var(--SmartThemeBlurTintColor, rgba(20,20,20,0.95));
```

## Drag-and-drop in jQuery / table rows

If you make a `<tr draggable="true">` containing `<input>` elements, the inputs lose
text-selection (the drag intercepts mousedown). Fix:

- Make ONLY a dedicated handle cell `draggable="true"`, not the whole `<tr>`.
- On the handle's `dragstart`, capture the `<tr>` as the actual move target.
- On inputs in the row, add `mousedown` with `stopPropagation` so drag never starts from them.

## Saved positions in localStorage

If you make a panel draggable and save its position, **clamp on load** to prevent it
rendering off-screen after a window resize:

```js
top = Math.min(top, window.innerHeight - 100);
left = Math.min(left, window.innerWidth - 100);
```

Also re-clamp on `window.resize`.

## Test runner

`node --test tests/` doesn't work on Node 22 + Windows (bare directory path is rejected).
Use `node --test` with no arg — Node's default test discovery globs `**/*.test.{js,mjs,cjs}`.

```json
"scripts": {
  "test": "node --test",
  "test:watch": "node --test --watch"
}
```

Pure-engine modules (no DOM, no ST imports) are unit-testable with `node:test`. UI and
integration modules need manual smoke testing in a running ST instance — there's no
practical headless harness.
