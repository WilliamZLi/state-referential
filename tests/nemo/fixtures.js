import { resolveNemoSettings } from '../../src/nemo/settings.js';
import { getNemoState } from '../../src/nemo/state.js';
import { buildSyntheticMessage } from '../../src/pipeline/L3Insert.js';
import { saveNemoArchive } from '../../src/pipeline/ArchiveStore.js';

let seq = 0;
export const msg = (who, mes) => ({ name: who, is_user: who === 'u', is_system: false, mes, extra: {}, state_referential_msgId: `id-${++seq}` });
export const chat20 = () => Array.from({ length: 20 }, (_, i) => msg(i % 2 === 0 ? 'u' : 'a', `m${i}`));

export function deps(chat, over = {}) {
  let n = 0;
  const d = {
    meta: {}, saved: false, reloaded: false,
    getChat: () => chat,
    getMeta: () => d.meta,
    saveChat: async () => { d.saved = true; },
    reloadChat: async () => { d.reloaded = true; },
    summarize: async () => 'R'.repeat(500),
    consent: () => [],
    settings: () => resolveNemoSettings(),
    genId: () => `gen-${++n}`,
    now: () => 1234,
    waitForIdle: async () => 'idle',
    getChatId: () => 'chat-1',
    isEnabled: () => true,
    ...over,
  };
  return d;
}


export function seedChapters(d, n) {
  const chat = d.getChat(); const st = getNemoState(d.meta); const seeded = []; const markers = [];
  for (let k = 0; k < n; k++) {
    const id = `seed-${k}`;
    const archiveId = saveNemoArchive(d.meta, { messages: [msg('u', `s${k}a`), msg('a', `s${k}b`)], sequence: [{ kind: 'msg', i: 0 }, { kind: 'msg', i: 1 }] }, { genId: d.genId, now: 1 });
    const marker = buildSyntheticMessage({
      kind: 'nemo-chapter', name: 'Compacted', mes: 'Compacted 2 messages',
      extra: { l3ArchiveId: archiveId, nemoChapterId: id }, smallSys: false,
    });
    marker.is_system = true; markers.push(marker);
    const c = { id, archiveId, recap: `SEED${k}-`.padEnd(450, 'x'), count: 2, createdAt: 1, status: 'live' };
    st.chapters.push(c); seeded.push(c);
  }
  chat.unshift(...markers);
  return seeded;
}
export const seqSummaries = list => { const calls = []; const fn = async req => { calls.push(req); return list[Math.min(calls.length - 1, list.length - 1)]; }; fn.calls = calls; return fn; };
