/**
 * Filter expired entries from a countdown list field.
 * Returns only entries whose remaining turns > 0.
 * Entries with no expiry metadata are always kept.
 */
export function activeEntries(engine, subjectId, trackerId, field, entries) {
  const activeWindow = field.inclusion?.activeWindow;
  if (activeWindow == null || !Array.isArray(entries) || entries.length === 0) return entries;
  const snapshots = engine.listSnapshots();
  const itemMeta = engine.getListMeta(subjectId, trackerId, field.id);
  return entries.filter(entry => {
    const meta = itemMeta[entry];
    if (!meta) return true;
    let remaining;
    if (meta.expiresAtSnapCount != null) {
      remaining = meta.expiresAtSnapCount - snapshots.length;
    } else {
      let turnsSince;
      if (meta.addedAtMsg) {
        const ti = snapshots.findIndex(s => s.msgId === meta.addedAtMsg);
        turnsSince = ti >= 0 ? snapshots.length - ti - 1 : snapshots.length;
      } else if (meta.addedAtSnapCount != null) {
        turnsSince = snapshots.length - meta.addedAtSnapCount;
      } else {
        turnsSince = 0;
      }
      remaining = activeWindow - turnsSince;
    }
    return remaining > 0;
  });
}
