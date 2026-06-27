// Keep struct-list entries whose sub-field values satisfy a `where` predicate:
// { subFieldId: [allowed, values] }. An entry passes if, for every clause, its
// value for that sub-field is in the allowed list. Falsy `where` → unchanged.
export function matchEntries(entries, where) {
  if (!where || typeof where !== 'object') return entries;
  const clauses = Object.entries(where);
  if (!clauses.length) return entries;
  return (entries ?? []).filter(e =>
    clauses.every(([k, allowed]) => Array.isArray(allowed) && allowed.includes(e?.[k])));
}
