/* ============================================================================
 * Layer 3 SPIKE — in-browser proof for mid-array synthetic message insertion.
 *
 * WHY: node --test proves the array-level splice logic (tests/pipeline/
 * L3Insert.test.js). It CANNOT prove the one genuinely risky thing: that ST's
 * DOM re-render keeps every `.mes[mesid=N]` aligned with chat[N] after you
 * insert a message in the MIDDLE of the chat. This harness proves exactly that
 * against the live ST runtime.
 *
 * HOW TO RUN:
 *   1. Launch SillyTavern, open any chat that has >= 3 messages.
 *   2. Open devtools console (F12).
 *   3. Paste this whole file and press Enter.
 *   4. Read the PASS/FAIL report it prints.
 *   5. To remove the test message:  await window.__l3UndoInsert()
 *
 * It is self-cleaning: any leftover spike messages from a previous run are
 * removed before it inserts a fresh one, so re-running is always safe.
 * ==========================================================================*/
(async () => {
  const TARGET_FROM_END = 2; // insert after chat[length - 2]
  const MARK = '⟦L3 SPIKE⟧'; // ⟦L3 SPIKE⟧ — easy to spot / undo

  const ctx = window.SillyTavern.getContext();
  const { chat, eventSource } = ctx;
  // getContext() exposes these under specific names — resolve defensively:
  const event_types = ctx.event_types ?? ctx.eventTypes;
  const saveChat = ctx.saveChat ?? ctx.saveChatConditional; // exposed as saveChat
  const reloadCurrentChat = ctx.reloadCurrentChat;

  if (typeof saveChat !== 'function' || typeof reloadCurrentChat !== 'function') {
    console.error('[L3 SPIKE] missing ctx.saveChat / ctx.reloadCurrentChat; aborting.', { saveChat, reloadCurrentChat });
    return;
  }

  const pass = [], fail = [];
  const check = (cond, label) => (cond ? pass : fail).push(label);

  // --- self-clean: drop any spike messages left by a previous/failed run ------
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.extra?.l3Spike) chat.splice(i, 1);

  if (!Array.isArray(chat) || chat.length < 3) {
    console.error('[L3 SPIKE] need a chat with >= 3 messages; aborting.');
    return;
  }

  // --- read tracker id the same way src/util/id.js does (top-level, swipe-stable)
  const TOP_KEY = 'state_referential_msgId';
  const readId = (m) => m?.[TOP_KEY] ?? m?.extra?.state_referential_msgId ?? m?.extra?.trackerMsgId ?? null;

  const targetIdx = chat.length - TARGET_FROM_END;
  const target = chat[targetIdx];
  // Ensure the target HAS a tracker id (mirrors ensureTrackerMsgId).
  if (!readId(target)) target[TOP_KEY] = (crypto.randomUUID?.() ?? String(Math.random()));
  const afterId = readId(target);
  const lengthBefore = chat.length;

  // --- the primitive (inlined copy of spliceSyntheticMessage for console use) ---
  const msg = {
    name: 'State', is_user: false, is_system: false,
    mes: `${MARK} synthetic fold-back summary inserted after msg #${targetIdx}.`,
    [TOP_KEY]: crypto.randomUUID?.() ?? String(Math.random()),
    extra: { isSmallSys: true, from: 'state-referential', l3Kind: 'fold-back', l3Spike: true },
  };
  const insertAt = chat.findIndex(m => readId(m) === afterId) + 1;

  // --- ST core's exact mid-array idiom (script.js ~5849) -----------------------
  chat.splice(insertAt, 0, msg);
  await saveChat();
  await eventSource.emit(event_types.MESSAGE_RECEIVED, insertAt); // gated out by extra.from
  await reloadCurrentChat(); // full re-render; emits CHAT_CHANGED

  // --- VERIFY ------------------------------------------------------------------
  const after = window.SillyTavern.getContext().chat; // re-fetch: reload may swap the ref
  check(after.length === lengthBefore + 1, `chat grew by exactly 1 (${lengthBefore} -> ${after.length})`);
  check(readId(after[insertAt]) === readId(msg), `synthetic message sits at array index ${insertAt}`);
  check(readId(after[insertAt - 1]) === afterId, 'message before it is still the target');

  // DOM consistency — the whole point of the spike:
  const domMes = [...document.querySelectorAll('#chat .mes')];
  const domIds = domMes.map(el => Number(el.getAttribute('mesid')));
  const contiguous = domIds.every((v, i) => v === i);
  check(domMes.length === after.length, `DOM .mes count (${domMes.length}) == chat length (${after.length})`);
  check(contiguous, 'DOM mesid attributes are contiguous 0..n-1 (no index drift after mid-insert)');
  const domSynthetic = document.querySelector(`#chat .mes[mesid="${insertAt}"]`);
  check(!!domSynthetic && domSynthetic.textContent.includes('L3 SPIKE'),
        `rendered synthetic .mes[mesid="${insertAt}"] shows our marker text`);

  // --- undo handle -------------------------------------------------------------
  window.__l3UndoInsert = async () => {
    const c = window.SillyTavern.getContext();
    let n = 0;
    for (let i = c.chat.length - 1; i >= 0; i--) if (c.chat[i]?.extra?.l3Spike) { c.chat.splice(i, 1); n++; }
    if (!n) { console.log('[L3 SPIKE] nothing to undo'); return; }
    await (c.saveChat ?? c.saveChatConditional)();
    await c.reloadCurrentChat();
    console.log(`[L3 SPIKE] removed ${n} test message(s)`);
  };

  console.log(`%c[L3 SPIKE] ${fail.length ? 'FAIL' : 'PASS'} — ${pass.length} ok, ${fail.length} failed`,
    `font-weight:bold;color:${fail.length ? 'crimson' : 'green'}`);
  pass.forEach(l => console.log('  ✓ ' + l));
  fail.forEach(l => console.error('  ✗ ' + l));
  console.log('[L3 SPIKE] undo with:  await window.__l3UndoInsert()');
})();
