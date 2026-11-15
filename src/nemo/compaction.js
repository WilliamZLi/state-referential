import { getNemoState } from './state.js';
import { computeNemoRuns, isUserHidden } from './range.js';
import { writeChapterRecap } from './chapter.js';
import { buildSyntheticMessage } from '../pipeline/L3Insert.js';
import { saveNemoArchive } from '../pipeline/ArchiveStore.js';
import { ensureTrackerMsgId, readTrackerMsgId } from '../util/id.js';

const fail = reason => ({ compacted: false, chapters: 0, folded: false, messages: 0, reason });

export class NemoCompaction {
  constructor({ getChat, getMeta, saveChat, reloadChat, summarize, consent, settings, genId, now, waitForIdle }) {
    this.d = { getChat, getMeta, saveChat, reloadChat, summarize, consent, settings, genId, now, waitForIdle };
    this.busy = false;
  }

  isBusy() { return this.busy; }

  async compactNow() {
    const d = this.d;
    this.busy = true;
    try {
      const chat = d.getChat();
      const cfg = d.settings();
      const { runs } = computeNemoRuns(chat, { keepLast: cfg.keepLast });
      if (!runs.length) return fail('no-eligible-range');

      // Snapshot IDs and hidden state over every run's full span.
      const snap = runs.map(run => {
        const span = [];
        for (let i = run.startIndex; i <= run.endIndex; i++) {
          span.push({ i, id: ensureTrackerMsgId(chat[i]), hidden: isUserHidden(chat[i]) });
        }
        return span;
      });

      const consent = d.consent();
      const recaps = [];
      for (const run of runs) {
        const recap = await writeChapterRecap({ chat, run, consent, summarize: d.summarize, targetTokens: cfg.chapterTokens });
        if (recap === null) return fail('summary-failed');
        recaps.push(recap);
      }

      await d.waitForIdle();

      for (const span of snap) {
        for (const s of span) {
          const m = chat[s.i];
          if (!m || readTrackerMsgId(m) !== s.id || isUserHidden(m) !== s.hidden) return fail('changed');
        }
      }

      const meta = d.getMeta();
      const state = getNemoState(meta);
      const chapters = [];
      let total = 0;
      for (let r = runs.length - 1; r >= 0; r--) {
        const run = runs[r];
        const members = new Set(run.indices);
        const sequence = [];
        const messages = [];
        for (let i = run.startIndex; i <= run.endIndex; i++) {
          if (members.has(i)) { sequence.push({ kind: 'msg', i: messages.length }); messages.push(chat[i]); }
          else sequence.push({ kind: 'hidden', id: readTrackerMsgId(chat[i]) });
        }
        const archiveId = saveNemoArchive(meta, { messages, sequence }, { genId: d.genId, now: d.now() });
        for (let k = run.indices.length - 1; k >= 0; k--) chat.splice(run.indices[k], 1);
        const id = d.genId();
        const count = run.indices.length;
        const marker = buildSyntheticMessage({
          kind: 'nemo-chapter', name: 'Compacted', mes: `Compacted ${count} messages`,
          extra: { l3ArchiveId: archiveId, nemoChapterId: id }, smallSys: false,
        });
        marker.is_system = true;
        chat.splice(run.startIndex, 0, marker);
        chapters.unshift({ id, archiveId, recap: recaps[r], count, createdAt: d.now(), status: 'live' });
        total += count;
      }
      state.chapters.push(...chapters);

      await d.saveChat();
      await d.reloadChat();
      return { compacted: true, chapters: chapters.length, folded: false, messages: total };
    } finally {
      this.busy = false;
    }
  }
}
