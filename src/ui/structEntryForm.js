// Coerce raw form values (strings from inputs) into a struct-list patch by
// sub-field type. Pure/DOM-free (testable). Only known sub-fields are emitted.
export function coerceStructInputs(subFields, rawValues = {}) {
  const patch = {};
  for (const sf of (subFields ?? [])) {
    if (!Object.prototype.hasOwnProperty.call(rawValues, sf.id)) continue;
    const raw = rawValues[sf.id];
    if (sf.type === 'number') {
      const n = Number(raw);
      patch[sf.id] = Number.isFinite(n) ? n : (sf.default ?? 0);
    } else if (sf.type === 'enum') {
      patch[sf.id] = (sf.options ?? []).includes(raw) ? raw : (sf.default ?? (sf.options ?? [])[0] ?? '');
    } else {
      patch[sf.id] = String(raw ?? '');
    }
  }
  return patch;
}
