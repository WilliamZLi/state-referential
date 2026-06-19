/* Layer 3 — branch-create spike. Paste into ST devtools on a World-bound chat
 * with >3 messages. Confirms: doNewChat creates+switches, getCurrentChatId gives
 * the new id, we can seed messages + metadata, and openCharacterChat switches back.
 * Cleanup: the new chat is a normal ST chat — delete it from the chat manager after. */
(async () => {
  const ctx = window.SillyTavern.getContext();
  const mainId = ctx.getCurrentChatId();
  const lastN = ctx.chat.slice(-3).map(m => ({ ...m })); // copies to seed
  console.log('[branch-spike] mainline id:', mainId, '| captured', lastN.length, 'msgs');

  const { doNewChat } = await import('/script.js');
  await doNewChat();
  const branchId = window.SillyTavern.getContext().getCurrentChatId();
  console.log('[branch-spike] new chat id:', branchId, '| switched:', branchId !== mainId);

  const c = window.SillyTavern.getContext().chat;
  for (const m of lastN) c.push(m);
  c.push({ name: 'State', is_user: false, is_system: false, mes: '⟦seed prompt placeholder⟧', extra: { from: 'state-referential' } });
  window.SillyTavern.getContext().chatMetadata.l3SpikeFlag = true; // confirm metadata writable + persists
  await window.SillyTavern.getContext().saveChat();
  await window.SillyTavern.getContext().reloadCurrentChat();
  console.log('[branch-spike] seeded chat length:', window.SillyTavern.getContext().chat.length, '| meta flag persisted:', window.SillyTavern.getContext().chatMetadata.l3SpikeFlag);

  await window.SillyTavern.getContext().openCharacterChat(mainId);
  console.log('[branch-spike] back on mainline:', window.SillyTavern.getContext().getCurrentChatId() === mainId);
  console.log('[branch-spike] DONE — confirm the above, then delete the spike chat from the chat manager.');
})();
