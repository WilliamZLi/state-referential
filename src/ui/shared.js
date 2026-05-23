const TEMPLATE_BASE = 'scripts/extensions/third-party/state-referential/templates/';

const cache = new Map();

export async function loadTemplate(name) {
  if (cache.has(name)) return cache.get(name);
  const url = `${TEMPLATE_BASE}${name}.html`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load template ${name}: ${res.status}`);
  const html = await res.text();
  cache.set(name, html);
  return html;
}

export async function loadPreset(name) {
  const res = await fetch(`scripts/extensions/third-party/state-referential/presets/${name}.json`);
  if (!res.ok) throw new Error(`failed to load preset ${name}: ${res.status}`);
  return res.json();
}

/** Make $el draggable by $handle. Persists position to localStorage under key. */
export function makeDraggable($el, $handle, key) {
  const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (stored) { $el.css({ top: stored.top, left: stored.left, right: 'auto' }); }
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  $handle.on('mousedown', (e) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const rect = $el[0].getBoundingClientRect();
    ox = rect.left; oy = rect.top;
    $el.css({ right: 'auto' });
    e.preventDefault();
  });
  $(document).on('mousemove.strk', (e) => {
    if (!dragging) return;
    const nx = ox + (e.clientX - sx);
    const ny = oy + (e.clientY - sy);
    $el.css({ left: nx + 'px', top: ny + 'px' });
  });
  $(document).on('mouseup.strk', () => {
    if (!dragging) return;
    dragging = false;
    const rect = $el[0].getBoundingClientRect();
    localStorage.setItem(key, JSON.stringify({ left: rect.left + 'px', top: rect.top + 'px' }));
  });
}

export function $$ (sel, root) { return $(root ?? document).find(sel); }