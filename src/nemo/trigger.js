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
    this.generation = 0;
  }

  // Called on chat change: forget pending state and any in-flight measurement.
  reset() {
    this.pending = false;
    this.measuring = null;
    this.generation++;
  }

  onPromptReady({ chat, dryRun } = {}) {
    if (dryRun) return Promise.resolve(); // dry runs can land mid-stream; leave pending alone
    if (!this.isEnabled() || this.isBusy()) { this.pending = false; return Promise.resolve(); }
    const text = flattenPromptText(chat); // synchronous: ST may reuse the array
    const gen = ++this.generation;
    const p = this._measure(text, gen);
    this.measuring = p;
    return p;
  }

  async _measure(text, gen) {
    try {
      const count = await this.countTokens(text);
      if (gen !== this.generation) return; // reset or newer send superseded this measurement
      const s = this.settings();
      this.lastEstimate = estimateRealTokens(count, s.multiplier);
      this.pending = this.lastEstimate > s.thresholdTokens;
    } catch (e) {
      console.warn('[nemo] token count failed; skipping compaction check', e);
      if (gen === this.generation) this.pending = false;
    }
  }

  async onMessageReceived(messageId, type) {
    if (this.measuring) await this.measuring;
    if (!this.pending) return;
    this.pending = false;
    if (type === 'quiet' || type === 'impersonate' || type === 'first_message') return;
    if (!this.isEnabled()) return;
    const s = this.settings();
    const est = this.lastEstimate;
    if (s.mode === 'nudge') { this.nudge(est); return; }
    if (s.mode !== 'auto') return;
    if (this.isBusy()) return;
    const r = await this.compact();
    if (r && r.compacted === false && r.reason === 'no-eligible-range') this.warnStillOver(est);
  }
}
