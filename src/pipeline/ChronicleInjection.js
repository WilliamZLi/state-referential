// src/pipeline/ChronicleInjection.js
const KEY = 'world:chronicle';

// BEFORE_PROMPT = 2 (same POSITION_MAP as Injection.js)
const DEFAULT_POSITION = 2;
const DEFAULT_DEPTH = 0;

export class ChronicleInjection {
  constructor(chronicle, deps) {
    this.chronicle = chronicle;
    this.deps = deps; // { setExtensionPrompt }
  }

  run() {
    const bigPicture = this.chronicle.getBigPicture() ?? '';
    const verbatim = this.chronicle.listVerbatimEntries();

    if (!bigPicture && verbatim.length === 0) {
      this.deps.setExtensionPrompt(KEY, '', DEFAULT_POSITION, DEFAULT_DEPTH);
      return;
    }

    const lines = [];
    if (bigPicture) lines.push(`**Story so far (overall):** ${bigPicture}`);
    if (verbatim.length) {
      lines.push('\n**Recent acts:**');
      for (const e of verbatim) lines.push(`- ${e.title}: ${e.body}`);
    }

    this.deps.setExtensionPrompt(KEY, lines.join('\n'), DEFAULT_POSITION, DEFAULT_DEPTH);
  }
}
