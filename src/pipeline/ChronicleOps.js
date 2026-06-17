// src/pipeline/ChronicleOps.js
export class ChronicleOps {
  constructor(chronicle, deps) {
    this.chronicle = chronicle;
    this.deps = deps; // { generateQuietPrompt }
  }

  async actComplete(title, opts = {}) {
    const config = this.chronicle.getConfig();
    const since = this._messagesSinceLastAct(opts.messages ?? [], config.maxActMessages ?? 60);
    const body = await this._generateSummary(since, config.entryTokenCap);
    const entry = this.chronicle.appendEntry(title, body, opts.msgId ?? null);

    const strategy = config.updateStrategy ?? 'lazy';

    if (strategy === 'eager') {
      await this._regenerateAllBigPicture(config.bigPictureTokenCap);
    } else if (strategy === 'lazy' && this.chronicle.needsBigPictureUpdate()) {
      await this._foldOldest(config.bigPictureTokenCap);
    }

    return entry;
  }

  /**
   * Return only the messages that belong to the current (not-yet-summarized) act:
   * everything AFTER the message the previous act was marked at. Falls back to the
   * whole list when there is no prior act or its boundary message isn't found.
   * A hard cap keeps the summary prompt bounded if a single act runs very long.
   */
  _messagesSinceLastAct(messages, cap = 60) {
    return this._sliceSinceLastAct(messages).slice(-cap);
  }

  /** The uncapped slice of messages after the previous act's boundary. */
  _sliceSinceLastAct(messages) {
    const entries = this.chronicle.getEntries();
    const lastAct = entries[entries.length - 1];
    const boundaryId = lastAct?.createdByMessageId;
    if (boundaryId) {
      const idx = messages.findIndex(m =>
        m?.state_referential_msgId === boundaryId ||
        m?.extra?.state_referential_msgId === boundaryId ||
        m?.extra?.trackerMsgId === boundaryId
      );
      if (idx >= 0) return messages.slice(idx + 1);
    }
    return messages;
  }

  /**
   * How many messages have accumulated since the last act was marked.
   * Used by the status command and the "act getting long" nudge.
   */
  countSinceLastAct(messages) {
    return this._sliceSinceLastAct(messages ?? []).length;
  }

  async _generateSummary(messages, tokenCap) {
    const chatText = messages
      .map(m => `${m.name ?? 'Narrator'}: ${m.mes ?? ''}`)
      .join('\n\n');

    // Briefer: give the summarizer the story-so-far (big picture + recent acts) so it
    // continues the chronicle instead of restating established context.
    const bigPicture = this.chronicle.getBigPicture?.() ?? '';
    const recentActs = (this.chronicle.getEntries?.() ?? []).slice(-3);
    const briefParts = [];
    if (bigPicture) briefParts.push(`Story so far (overall):\n${bigPicture}`);
    if (recentActs.length) {
      briefParts.push('Most recent acts (already chronicled — do NOT repeat these):\n' +
        recentActs.map(e => `- ${e.title}: ${e.body}`).join('\n'));
    }
    const brief = briefParts.length ? briefParts.join('\n\n') + '\n\n' : '';

    // Transcript FIRST, instruction LAST. With a long act, an instruction placed
    // before the transcript gets drowned out and the model CONTINUES the story
    // instead of summarizing it (same trap fixed in compaction). The recap
    // instruction must be the model's last/strongest signal.
    const prompt =
      brief +
      'NEW EVENTS TRANSCRIPT (these already happened):\n\n' +
      chatText +
      '\n\n=== END OF TRANSCRIPT ===\n\n' +
      'The transcript above is finished. Write ONE paragraph recapping ONLY the NEW events in it — ' +
      'the events already covered by the story-so-far / recent acts above are context only; do not restate them. ' +
      'State what actually happened: factual, past-tense, third person. ' +
      `Do NOT continue the story, do NOT add anything beyond the transcript, no dialogue. Aim for ~${tokenCap} tokens.`;
    return await this.deps.generateQuietPrompt(prompt);
  }

  async _regenerateAllBigPicture(tokenCap) {
    const allEntries = this.chronicle.getEntries();
    const prior = this.chronicle.getBigPicture() ?? '';
    const entryText = allEntries.map(e => `${e.title}: ${e.body}`).join('\n\n');
    const prompt =
      `Write a single paragraph (~${tokenCap} tokens) recounting the campaign so far. ` +
      `Write as flowing narrative prose, not a status report or a list of states. ` +
      `Third person, present tense, no dialogue.\n\n` +
      `Prior big picture (if any):\n${prior}\n\nActs covered (oldest first):\n${entryText}`;
    const bigPicture = await this.deps.generateQuietPrompt(prompt);
    const lastId = allEntries[allEntries.length - 1]?.id ?? null;
    this.chronicle.setBigPicture(bigPicture, lastId);
  }

  async _foldOldest(tokenCap) {
    const toFold = this.chronicle.getEntriesForFolding();
    if (!toFold.length) return;
    const prior = this.chronicle.getBigPicture() ?? '';
    const entryText = toFold.map(e => `${e.title}: ${e.body}`).join('\n\n');
    const prompt =
      `Write a single paragraph (~${tokenCap} tokens) recounting the campaign so far. ` +
      `Write as flowing narrative prose, not a status report or a list of states. ` +
      `Third person, present tense, no dialogue.\n\n` +
      `Prior big picture:\n${prior}\n\nActs being folded in:\n${entryText}`;
    const bigPicture = await this.deps.generateQuietPrompt(prompt);
    const lastFoldId = toFold[toFold.length - 1].id;
    this.chronicle.setBigPicture(bigPicture, lastFoldId);
    this.chronicle.foldEntries(lastFoldId);
  }
}
