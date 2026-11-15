import { flattenPromptText, estimateRealTokens } from './estimate.js';

// Measure at send, act after the reply. Never delays the send: the prompt text is
// flattened synchronously and the token count runs as an in-flight promise.
export class NemoTrigger {
  constructor({ isEnabled, settings, countTokens, compact, nudge, warnStillOver, isBusy }) {
    this.isEnabled = isEnabled; this.settings = settings; this.countTokens = countTokens;
    this.compact = compact; this.nudge = nudge; this.warnStillOver = warnStillOver; this.isBusy = isBusy;
    this.lastEstimate = null;
    this.pending = false;
    this.measuring = null;
  }

  onPromptReady({ chat, dryRun } = {}) {
    if (dryRun || !this.isEnabled() || this.isBusy()) return Promise.resolve();
    const text = flattenPromptText(chat); // synchronous: ST may reuse the array
    const p = this._measure(text);
    this.measuring = p;
    return p;
  }

  async _measure(text) {
    try {
      const count = await this.countTokens(text);
      const s = this.settings();
      this.lastEstimate = estimateRealTokens(count, s.multiplier);
      this.pending = this.lastEstimate > s.thresholdTokens;
    } catch (e) {
      console.warn('[nemo] token count failed; skipping compaction check', e);
      this.pending = false;
    }
  }

  async onMessageReceived(messageId, type) {
    if (this.measuring) await this.measuring;
    if (!this.pending) return;
    this.pending = false;
    if (type === 'quiet' || type === 'impersonate') return;
    const s = this.settings();
    const est = this.lastEstimate;
    if (s.mode === 'nudge') { this.nudge(est); return; }
    if (s.mode !== 'auto') return;
    if (this.isBusy()) return;
    const r = await this.compact();
    if (r && r.compacted === false && r.reason === 'no-eligible-range') this.warnStillOver(est);
  }
}
