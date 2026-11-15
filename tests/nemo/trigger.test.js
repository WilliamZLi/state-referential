import { test } from 'node:test';
import assert from 'node:assert';
import { NemoTrigger } from '../../src/nemo/trigger.js';
import { resolveNemoSettings } from '../../src/nemo/settings.js';

const mkT = (over = {}) => {
  const calls = { compact: 0, nudge: 0, warn: 0, nudgeArg: null, warnArg: null };
  const t = new NemoTrigger({
    isEnabled: () => true, settings: () => resolveNemoSettings(over.s), isBusy: () => false,
    countTokens: async () => 50000, compact: async () => (calls.compact++, { compacted: true }),
    nudge: (e) => { calls.nudge++; calls.nudgeArg = e; }, warnStillOver: (e) => { calls.warn++; calls.warnArg = e; },
    ...over,
  });
  return { t, calls };
};
const chat = [{ content: 'x' }];

test('over threshold → compacts once after the reply (once per generation)', async () => {
  const { t, calls } = mkT(); await t.onPromptReady({ chat, dryRun: false });
  assert.equal(t.lastEstimate, 125000); await t.onMessageReceived(1, 'normal'); await t.onMessageReceived(2, 'normal');
  assert.equal(calls.compact, 1);
});

test('under threshold: nothing happens', async () => {
  const { t, calls } = mkT({ countTokens: async () => 10000 });
  await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(t.lastEstimate, 25000); assert.equal(calls.compact, 0);
});
test('dry run: nothing happens', async () => {
  const { t, calls } = mkT(); await t.onPromptReady({ chat, dryRun: true }); await t.onMessageReceived(1, 'normal');
  assert.equal(t.lastEstimate, null); assert.equal(calls.compact, 0);
});
test('disabled: nothing happens', async () => {
  const { t, calls } = mkT({ isEnabled: () => false }); await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(t.lastEstimate, null); assert.equal(calls.compact, 0);
});
test('busy at send: nothing happens', async () => {
  const { t, calls } = mkT({ isBusy: () => true }); await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(t.lastEstimate, null); assert.equal(calls.compact, 0);
});
test('quiet reply: nothing happens', async () => {
  const { t, calls } = mkT(); await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'quiet');
  assert.equal(calls.compact, 0);
});
test('impersonate reply: nothing happens', async () => {
  const { t, calls } = mkT(); await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'impersonate');
  assert.equal(calls.compact, 0);
});

test('nudge mode nudges with the estimate', async () => {
  const { t, calls } = mkT({ s: { mode: 'nudge' } });
  await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(calls.nudge, 1); assert.equal(calls.nudgeArg, 125000); assert.equal(calls.compact, 0);
});
test('off mode does nothing', async () => {
  const { t, calls } = mkT({ s: { mode: 'off' } });
  await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(calls.nudge, 0); assert.equal(calls.compact, 0); assert.equal(calls.warn, 0);
});

test('nothing compactable while over → warnStillOver with the estimate', async () => {
  const { t, calls } = mkT({ compact: async () => ({ compacted: false, reason: 'no-eligible-range' }) });
  await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.equal(calls.warn, 1); assert.equal(calls.warnArg, 125000);
});
for (const reason of ['summary-failed', 'changed']) {
  test(`${reason} does not call warnStillOver`, async () => {
    const { t, calls } = mkT({ compact: async () => ({ compacted: false, reason }) });
    await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
    assert.equal(calls.warn, 0);
  });
}

test('un-awaited onPromptReady still compacts after the reply', async () => {
  const { t, calls } = mkT({ countTokens: () => new Promise((r) => setTimeout(() => r(50000), 10)) });
  t.onPromptReady({ chat, dryRun: false });
  await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 1);
});
test('mutating chat after un-awaited onPromptReady does not change what countTokens received', async () => {
  let got = null;
  const { t } = mkT({ countTokens: async (txt) => { got = txt; return 50000; } });
  const c = [{ content: 'hello' }];
  const p = t.onPromptReady({ chat: c, dryRun: false });
  c[0].content = 'changed'; c.push({ content: 'more' });
  await p;
  assert.equal(got, 'hello');
});

test('countTokens rejecting: warns, no throw, pending false, lastEstimate unchanged', async () => {
  const { t, calls } = mkT();
  await t.onPromptReady({ chat, dryRun: false });
  assert.equal(t.lastEstimate, 125000);
  t.countTokens = async () => { throw new Error('boom'); };
  const orig = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a);
  try { await t.onPromptReady({ chat, dryRun: false }); } finally { console.warn = orig; }
  assert.equal(warns.length, 1); assert.match(String(warns[0][0]), /^\[nemo\]/);
  assert.equal(t.pending, false); assert.equal(t.lastEstimate, 125000);
  await t.onMessageReceived(1, 'normal'); assert.equal(calls.compact, 0);
});
test('auto mode skips compact when busy at reply time, still clears pending', async () => {
  let busy = false;
  const { t, calls } = mkT({ isBusy: () => busy });
  await t.onPromptReady({ chat, dryRun: false });
  busy = true;
  await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0); assert.equal(t.pending, false);
  busy = false; await t.onMessageReceived(2, 'normal'); assert.equal(calls.compact, 0);
});

test('over-threshold send, then disabled non-dry send, then reply: no compact', async () => {
  let en = true; const { t, calls } = mkT({ isEnabled: () => en });
  await t.onPromptReady({ chat, dryRun: false });
  en = false; await t.onPromptReady({ chat, dryRun: false });
  en = true; await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0);
});
test('over-threshold send, then busy non-dry send, then reply: no compact', async () => {
  let busy = false; const { t, calls } = mkT({ isBusy: () => busy });
  await t.onPromptReady({ chat, dryRun: false });
  busy = true; await t.onPromptReady({ chat, dryRun: false });
  busy = false; await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0);
});
test('over-threshold send, then dry run, then reply: still compacts', async () => {
  const { t, calls } = mkT();
  await t.onPromptReady({ chat, dryRun: false });
  await t.onPromptReady({ chat, dryRun: true });
  await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 1);
});
test('isEnabled flipping to false before the reply: no compact', async () => {
  let en = true; const { t, calls } = mkT({ isEnabled: () => en });
  await t.onPromptReady({ chat, dryRun: false });
  en = false; await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0); assert.equal(t.pending, false);
});
test('first_message reply: no compact', async () => {
  const { t, calls } = mkT();
  await t.onPromptReady({ chat, dryRun: false });
  await t.onMessageReceived(1, 'first_message');
  assert.equal(calls.compact, 0);
});
test('reset() after an awaited send: no compact', async () => {
  const { t, calls } = mkT();
  await t.onPromptReady({ chat, dryRun: false });
  t.reset(); await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0);
});
test('un-awaited onPromptReady, reset(), then reply: no compact', async () => {
  const { t, calls } = mkT({ countTokens: () => new Promise((r) => setTimeout(() => r(50000), 10)) });
  t.onPromptReady({ chat, dryRun: false });
  t.reset();
  await t.onMessageReceived(1, 'normal');
  assert.equal(calls.compact, 0); assert.equal(t.pending, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.pending, false);
});

test('reset() clears the last estimate, so a new chat shows no stale measurement', async () => {
  const { t } = mkT();
  await t.onPromptReady({ chat, dryRun: false });
  assert.equal(t.lastEstimate, 125000);
  t.reset();
  assert.equal(t.lastEstimate, null);
});
test('auto compact passes minMessages = keepLast so it never loops on a tiny range', async () => {
  let got = 'unset';
  const { t } = mkT({ s: { keepLast: 20 }, compact: async (o) => { got = o; return { compacted: false, reason: 'no-eligible-range' }; } });
  await t.onPromptReady({ chat, dryRun: false }); await t.onMessageReceived(1, 'normal');
  assert.deepStrictEqual(got, { minMessages: 20 });
});
