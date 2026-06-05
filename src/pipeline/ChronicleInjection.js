// src/pipeline/ChronicleInjection.js
import { resolvePosition } from './Injection.js';

const KEY = 'world:chronicle';
const DEFAULT_DEPTH = 0;
const IN_CHAT = 1;

export class ChronicleInjection {
  constructor(chronicle, deps) {
    this.chronicle = chronicle;
    this.deps = deps; // { setExtensionPrompt }
  }

  run() {
    const cfg = this.chronicle.getConfig();
    const bigPicture = this.chronicle.getBigPicture() ?? '';
    const acts = this.chronicle.getEntries().filter(e => e.inject === true);

    const lines = [];
    if (cfg.injectBigPicture !== false && bigPicture) {
      lines.push(`**Story so far (overall):** ${bigPicture}`);
    }
    if (acts.length) {
      lines.push('\n**Recent acts:**');
      for (const e of acts) lines.push(`- ${e.title}: ${e.body}`);
    }

    const pos = resolvePosition(cfg.injectPosition ?? 'in-prompt');
    const depth = pos === IN_CHAT ? (cfg.injectDepth ?? 4) : DEFAULT_DEPTH;
    this.deps.setExtensionPrompt(KEY, lines.join('\n'), pos, depth);
  }
}
