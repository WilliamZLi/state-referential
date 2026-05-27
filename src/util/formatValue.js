/**
 * Format a field value for display in injection or macro output.
 *
 * Respects field-level options:
 *   - type: 'list' → comma-joined
 *   - maxFromField: paired with another number field → "value/maxVal"
 *   - displayAs: 'percent' → "value%"
 *   - else → String(value)
 *
 * @param {*} value - the raw stored value
 * @param {object|null} field - field definition object (with type, maxFromField, displayAs)
 * @param {object} [fieldValues] - map of field-id → current value, for paired-max lookup
 * @returns {string}
 */
export function formatValue(value, field, fieldValues) {
  if (!field) {
    return value == null ? '' : String(value);
  }
  if (field.type === 'list') {
    return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  if (field.type === 'pair-list') {
    if (!Array.isArray(value)) return '';
    return value
      .filter(p => p && p.name)
      .map(p => p.descriptor ? `${p.name} — ${p.descriptor}` : p.name)
      .join(', ');
  }
  if (field.type === 'number') {
    if (field.maxFromField && fieldValues) {
      const maxVal = fieldValues[field.maxFromField];
      if (maxVal !== undefined && maxVal !== null && maxVal !== '') {
        return `${value ?? 0}/${maxVal}`;
      }
    }
    if (field.displayAs === 'percent') {
      return `${value ?? 0}%`;
    }
  }
  return value == null ? '' : String(value);
}
