// Normalize curly/smart double quotes (U+201C/U+201D) to straight " so the
// quote-stripping below works on values the AI emits with smart quotes. Only
// doubles — leaving single curly quotes alone avoids mangling apostrophes.
const SMART = /[“”]/g;

// Reverse the AI's JSON-style escaping of a quote char inside a value:
// \" -> ", \' -> ', \\ -> \. Other backslashes (e.g. \n in prose) are left
// untouched. Without this, a value like "3\" stiletto heels" stores the literal
// backslash and renders as 3\" in the prompt.
function unescapeQuoted(s) {
  return s.replace(/\\(["'\\])/g, '$1');
}

function stripQuotes(s) {
  s = s.replace(SMART, '"').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return unescapeQuoted(s.slice(1, -1));
  }
  return s;
}

function tokenizeQuoted(rest) {
  rest = rest.replace(SMART, '"').trim();
  if (rest.startsWith('"')) {
    // Find the first UNescaped closing quote so the value may itself contain \"
    // (e.g. an inch mark: "3\" stiletto heels").
    let end = -1;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === '"' && rest[i - 1] !== '\\') { end = i; break; }
    }
    if (end < 0) return [unescapeQuoted(rest.slice(1)), ''];
    return [unescapeQuoted(rest.slice(1, end)), rest.slice(end + 1).trim()];
  }
  const sp = rest.indexOf(' ');
  if (sp < 0) return [rest, ''];
  return [rest.slice(0, sp), rest.slice(sp + 1).trim()];
}

export function parseCommands(text, opts = {}) {
  const cap = opts.cap ?? 20;
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    if (out.length >= cap) break;
    const line = raw.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'NONE') continue;

    // NEW_SUBJECT
    let m = line.match(/^NEW_SUBJECT\s+(.+)$/i);
    if (m) {
      const [name, rest] = tokenizeQuoted(m[1]);
      const role = (rest.split(/\s+/)[0] || 'npc').toLowerCase();
      out.push({ op: 'NEW_SUBJECT', name, role });
      continue;
    }

    // SET <subject> <tracker>.<field> = <value>
    m = line.match(/^SET\s+(\S+)\s+([\w-]+)\.([\w-]+)\s*=\s*(.+)$/i);
    if (m) {
      out.push({ op: 'SET', subject: m[1], tracker: m[2], field: m[3], value: stripQuotes(m[4]) });
      continue;
    }

    // DELTA <subject> <tracker>.<field> <±N>
    m = line.match(/^DELTA\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+([+-]?\d+(?:\.\d+)?)\s*$/i);
    if (m) {
      out.push({ op: 'DELTA', subject: m[1], tracker: m[2], field: m[3], delta: Number(m[4]) });
      continue;
    }

    // ADD <subject> <tracker>.<field> <entry> [= <descriptor>]
    // The optional `= <descriptor>` tail is for pair-list fields: the entry is
    // the pair's name, the descriptor is the relationship/state text.
    m = line.match(/^ADD\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+(.+)$/i);
    if (m) {
      const tail = m[4];
      // Look for an unquoted ` = ` separator outside of any quoted entry.
      const [entryToken, afterEntry] = tokenizeQuoted(tail);
      const restAfterEq = afterEntry.match(/^=\s*(.+)$/);
      if (restAfterEq) {
        out.push({ op: 'ADD', subject: m[1], tracker: m[2], field: m[3], entry: entryToken, descriptor: stripQuotes(restAfterEq[1]) });
      } else {
        out.push({ op: 'ADD', subject: m[1], tracker: m[2], field: m[3], entry: stripQuotes(tail) });
      }
      continue;
    }

    // REMOVE <subject> <tracker>.<field> <entry>
    m = line.match(/^REMOVE\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+(.+)$/i);
    if (m) {
      out.push({ op: 'REMOVE', subject: m[1], tracker: m[2], field: m[3], entry: stripQuotes(m[4]) });
      continue;
    }

    // REPLACE <subject> <tracker>.<field> "<old>" WITH "<new>"
    // Same item changing state; <new> inherits <old>'s description as probe context.
    m = line.match(/^REPLACE\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+(.+)$/i);
    if (m) {
      const [oldToken, afterOld] = tokenizeQuoted(m[4]);
      const wm = afterOld.match(/^WITH\s+(.+)$/i);
      if (wm) {
        out.push({ op: 'REPLACE', subject: m[1], tracker: m[2], field: m[3], oldEntry: oldToken, newEntry: stripQuotes(wm[1]) });
      }
      // Missing/!WITH → malformed; drop the line (consistent with other unknown lines).
      continue;
    }

    // Unknown — ignored
  }
  return out;
}