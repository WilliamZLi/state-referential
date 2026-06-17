import { computeCompactionRange } from './CompactionRange.js';
import { saveArchive } from './ArchiveStore.js';
import { buildSyntheticMessage, spliceAtIndex } from './L3Insert.js';
import { readTrackerMsgId } from '../util/id.js';

export class Compaction {
  constructor(deps) { this.deps = deps; }

  /** @param {{count?:number}} [override] manual message-count cap */
  async run(override = {}) {
    const d = this.deps;
    const chat = d.getChat();
    const s = d.settings();
    const range = computeCompactionRange(chat, {
      recentWindow: s.recentWindow,
      minSize: s.minSize,
      maxCount: override.count,
    });
    if (!range) return { compacted: false, reason: 'no-eligible-range' };

    // 1. Archive the verbatim slice.
    // NOTE: if generateSummary throws below, this archive entry is abandoned
    // (harmless unreferenced storage; the chat is left unchanged).
    // now() is injected (not inlined Date.now()) so tests get deterministic timestamps.
    const archiveId = saveArchive(chat, range, { genId: d.genId, now: d.now() });

    // 2. Summarize via the AI (range messages only).
    const rangeMessages = chat.slice(range.startIndex, range.endIndex + 1);
    const summary = await d.generateSummary(rangeMessages, s.tokenCap);

    // 3. Build the block and replace the range in one splice.
    const block = buildSyntheticMessage({
      kind: 'compaction',
      name: `Compacted (${range.msgIds.length} msgs)`,
      mes: summary,
      extra: { l3ArchiveId: archiveId },
    });
    const count = range.endIndex - range.startIndex + 1;
    chat.splice(range.startIndex, count); // remove originals (NO MESSAGE_DELETED emit)
    spliceAtIndex(chat, range.startIndex, block);

    // 4. Release the removed messages' non-pinned snapshots.
    d.dropSnapshots(range.msgIds);

    // 5. Persist + re-render (reloadChat reindexes the DOM; emits CHAT_CHANGED).
    await d.saveChat();
    await d.reloadChat();

    return { compacted: true, archiveId, count, blockMsgId: readTrackerMsgId(block) };
  }
}
