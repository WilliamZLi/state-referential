// Pure mappers between a struct-list sub-field definition and the editor-row
// values shown in the schema editor's struct-list section. DOM-free (testable).
export function subFieldToRow(sf) {
  return {
    id: sf.id ?? '',
    label: sf.label ?? '',
    type: sf.type ?? 'text',
    optionsText: Array.isArray(sf.options) ? sf.options.join('\n') : '',
    minText: (sf.min != null) ? String(sf.min) : '',
  };
}

export function rowToSubField(row) {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  const type = row.type ?? 'text';
  const out = { id, label: String(row.label ?? '').trim() || id, type };
  if (type === 'enum') {
    out.options = String(row.optionsText ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  } else if (type === 'number') {
    const n = parseFloat(row.minText);
    out.min = Number.isFinite(n) ? n : 0;
  }
  return out;
}
