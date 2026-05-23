const SMART = /[""]/g;

function stripQuotes(s) {
  s = s.replace(SMART, '"').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function tokenizeQuoted(rest) {
  rest = rest.replace(SMART, '"').trim();
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return [rest.slice(1), ''];
    return [rest.slice(1, end), rest.slice(end + 1).trim()];
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

    // ADD <subject> <tracker>.<field> <entry>
    m = line.match(/^ADD\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+(.+)$/i);
    if (m) {
      out.push({ op: 'ADD', subject: m[1], tracker: m[2], field: m[3], entry: stripQuotes(m[4]) });
      continue;
    }

    // REMOVE <subject> <tracker>.<field> <entry>
    m = line.match(/^REMOVE\s+(\S+)\s+([\w-]+)\.([\w-]+)\s+(.+)$/i);
    if (m) {
      out.push({ op: 'REMOVE', subject: m[1], tracker: m[2], field: m[3], entry: stripQuotes(m[4]) });
      continue;
    }

    // Unknown — ignored
  }
  return out;
}