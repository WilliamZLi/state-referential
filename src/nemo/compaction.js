import { getNemoState, liveChapters } from './state.js';
import { buildFoldRequest, isValidRecap } from './request.js';
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

      // Fold the oldest live recaps into Earlier history once more than keepRecaps would be live.
      // The result is only held here; nothing is written until the range is verified.
      const earlyState = getNemoState(d.getMeta());
      const existing = liveChapters(earlyState);
      const foldCount = Math.max(0, existing.length + recaps.length - cfg.keepRecaps);
      let foldText = null;
      if (foldCount > 0) {
        const targetRecaps = [...existing.map(c => c.recap), ...recaps].slice(0, foldCount);
        const text = await d.summarize(buildFoldRequest({
          earlier: earlyState.earlier?.text ?? null, recaps: targetRecaps, consent, targetTokens: cfg.earlierTokens,
        }));
        if (isValidRecap(text)) foldText = text;
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
      const markerMes = c => `Compacted ${c.count} messages (folded into Earlier history)`;
      state.chapters.push(...chapters);

      let folded = false;
      if (foldText !== null) {
        const targets = [...liveChapters(state)].slice(0, foldCount);
        for (const t of targets) {
          t.status = 'folded';
          const marker = chat.find(m => m?.extra?.nemoChapterId === t.id);
          if (marker) marker.mes = markerMes(t);
        }
        state.folds.push({ id: d.genId(), prevEarlier: state.earlier?.text ?? null, chapterIds: targets.map(t => t.id), createdAt: d.now() });
        state.earlier = { text: foldText };
        folded = true;
      }

      await d.saveChat();
      await d.reloadChat();
      return { compacted: true, chapters: chapters.length, folded, messages: total };
    } finally {
      this.busy = false;
    }
  }
}
