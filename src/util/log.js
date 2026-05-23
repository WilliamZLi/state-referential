export function makeLog(scope, consoleImpl = console) {
  const pfx = `[${scope}]`;
  const api = {
    DEBUG: false,
    info:  (...a) => consoleImpl.log(pfx, ...a),
    warn:  (...a) => consoleImpl.warn(pfx, ...a),
    error: (...a) => consoleImpl.error(pfx, ...a),
    debug: (...a) => { if (api.DEBUG) consoleImpl.log(pfx, ...a); },
  };
  return api;
}