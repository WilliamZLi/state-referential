import { getNemoState, peekNemoState, liveChapters } from './state.js';
import { buildFoldRequest, isValidRecap } from './request.js';
import { computeNemoRuns, isUserHidden } from './range.js';
import { writeChapterRecap } from './chapter.js';
import { buildSyntheticMessage } from '../pipeline/L3Insert.js';
import { saveNemoArchive } from '../pipeline/ArchiveStore.js';
import { ensureTrackerMsgId, readTrackerMsgId } from '../util/id.js';

const fail = reason => ({ compacted: false, chapters: 0, folded: false, messages: 0, reason });

export class NemoCompaction {
  // waitForIdle resolves to 'idle' (was idle), 'waited' (had to wait) or 'timeout' (gave up).
  constructor({ getChat, getMeta, saveChat, reloadChat, summarize, consent, settings, genId, now, waitForIdle, getChatId, isEnabled }) {
    this.d = { getChat, getMeta, saveChat, reloadChat, summarize, consent, settings, genId, now, waitForIdle, getChatId, isEnabled };
    this.busy = false;
  }

  isBusy() { return this.busy; }

  // opts.minMessages: skip (no-eligible-range) when fewer members than this are
  // eligible in total. Auto mode passes keepLast so it can't loop on tiny ranges.
  async compactNow({ minMessages = 2 } = {}) {
    const d = this.d;
    this.busy = true;
    try {
      const chatId = d.getChatId();
      const meta0 = d.getMeta();
      const chat = d.getChat();
      const cfg = d.settings();
      const { runs } = computeNemoRuns(chat, { keepLast: cfg.keepLast });
      const eligible = runs.reduce((n, run) => n + run.indices.length, 0);
      if (!runs.length || eligible < minMessages) return fail('no-eligible-range');

      // Snapshot IDs and hidden state over every run's full span, plus each
      // member's text and swipe so in-place edits and swipes are caught.
      const snap = runs.map(run => {
        const members = new Set(run.indices);
        const span = [];
        for (let i = run.startIndex; i <= run.endIndex; i++) {
          const m = chat[i];
          span.push({ i, id: ensureTrackerMsgId(m), hidden: isUserHidden(m), member: members.has(i), mes: m.mes, swipe_id: m.swipe_id });
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
      const earlyState = peekNemoState(meta0);
      const existing = earlyState ? liveChapters(earlyState) : [];
      const foldCount = Math.max(0, existing.length + recaps.length - cfg.keepRecaps);
      let foldText = null;
      if (foldCount > 0) {
        const targetRecaps = [...existing.map(c => c.recap), ...recaps].slice(0, foldCount);
        const text = await d.summarize(buildFoldRequest({
          earlier: earlyState?.earlier?.text ?? null, recaps: targetRecaps, consent, targetTokens: cfg.earlierTokens,
        }));
        if (isValidRecap(text)) foldText = text;
      }

      if ((await d.waitForIdle()) === 'timeout') return fail('changed');

      // Verify before writing anything: same chat, same metadata, still enabled,
      // every span unchanged, and every run still older than the kept window.
      if (!d.isEnabled() || d.getChatId() !== chatId || d.getMeta() !== meta0) return fail('changed');
      for (const span of snap) {
        for (const s of span) {
          const m = chat[s.i];
          if (!m || readTrackerMsgId(m) !== s.id || isUserHidden(m) !== s.hidden) return fail('changed');
          if (s.member && (m.mes !== s.mes || m.swipe_id !== s.swipe_id)) return fail('changed');
        }
      }
      const { keptStart } = computeNemoRuns(chat, { keepLast: d.settings().keepLast });
      if (runs.some(run => run.endIndex >= keptStart)) return fail('changed');

      const meta = meta0;
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

      // A send during the save pushes a message the reload would drop: wait it
      // out and save again so the reload keeps it.
      await d.saveChat();
      const after = await d.waitForIdle();
      if (after === 'waited' || after === 'timeout') await d.saveChat();
      await d.reloadChat();
      return { compacted: true, chapters: chapters.length, folded, messages: total };
    } finally {
      this.busy = false;
    }
  }
}
