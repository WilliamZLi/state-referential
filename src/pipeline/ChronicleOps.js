// src/pipeline/ChronicleOps.js
export class ChronicleOps {
  constructor(chronicle, deps) {
    this.chronicle = chronicle;
    this.deps = deps; // { generateQuietPrompt }
  }

  async actComplete(title, opts = {}) {
    const config = this.chronicle.getConfig();
    const body = await this._generateSummary(opts.messages ?? [], config.entryTokenCap);
    const entry = this.chronicle.appendEntry(title, body, opts.msgId ?? null);

    const strategy = config.updateStrategy ?? 'lazy';

    if (strategy === 'eager') {
      await this._regenerateAllBigPicture(config.bigPictureTokenCap);
    } else if (strategy === 'lazy' && this.chronicle.needsBigPictureUpdate()) {
      await this._foldOldest(config.bigPictureTokenCap);
    }

    return entry;
  }

  async _generateSummary(messages, tokenCap) {
    const chatText = messages.slice(-30)
      .map(m => `${m.name ?? 'Narrator'}: ${m.mes ?? ''}`)
      .join('\n\n');
    const prompt =
      `Summarize the events of the current act into ONE paragraph. ` +
      `Focus on outcomes, decisions, relationships changed, items acquired or lost, world facts revealed. ` +
      `Aim for ${tokenCap} tokens. No dialogue. Third person.\n\nRecent chat:\n${chatText}`;
    return await this.deps.generateQuietPrompt(prompt);
  }

  async _regenerateAllBigPicture(tokenCap) {
    const allEntries = this.chronicle.getEntries();
    const prior = this.chronicle.getBigPicture() ?? '';
    const entryText = allEntries.map(e => `${e.title}: ${e.body}`).join('\n\n');
    const prompt =
      `Write a single paragraph (~${tokenCap} tokens) summarizing the campaign-to-date. ` +
      `Cover the major arcs, evolving relationships, key world events, and current state of the protagonist. ` +
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
      `Write a single paragraph (~${tokenCap} tokens) summarizing the campaign-to-date. ` +
      `Third person, present tense, no dialogue.\n\n` +
      `Prior big picture:\n${prior}\n\nActs being folded in:\n${entryText}`;
    const bigPicture = await this.deps.generateQuietPrompt(prompt);
    const lastFoldId = toFold[toFold.length - 1].id;
    this.chronicle.setBigPicture(bigPicture, lastFoldId);
    this.chronicle.foldEntries(lastFoldId);
  }
}
