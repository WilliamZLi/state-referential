export function debounce(fn, ms = 200) {
  let timer = null;
  let lastArgs = null;
  function call() { timer = null; const a = lastArgs; lastArgs = null; fn(...(a ?? [])); }
  function debounced(...args) {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(call, ms);
  }
  debounced.flush = () => { if (timer) { clearTimeout(timer); call(); } };
  debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; lastArgs = null; } };
  return debounced;
}