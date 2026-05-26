/**
 * Per-subject outfit sets — save the current outfit fields as a named set,
 * apply a set back, and (on apply) swap displaced/incoming items through the
 * wardrobe tracker so the simulation is consistent.
 *
 * Storage:
 *   Each subject object carries an optional `outfitSets` map.
 *     subj.outfitSets = { [setName]: { [fieldId]: value, ... } }
 *   Because subjects persist through ChatScopedBackend / chatMetadata, sets
 *   travel with the chat automatically — nothing else to wire.
 *
 * Wardrobe-swap rules on apply:
 *   - For each outfit field, the current value (if non-empty AND not equal to
 *     the set's value) is APPENDED to the wardrobe.items list.
 *   - For each outfit field with a non-empty set value, that value is REMOVED
 *     from the wardrobe.items list (if present) — it's "taken out of the
 *     closet" to be worn.
 *   - All outfit fields are then set to the set's values.
 *
 *   Requires both `outfit` and `wardrobe` tracker definitions to exist; if
 *   wardrobe is absent the swap step is skipped but the outfit update still
 *   applies.
 */

const OUTFIT_TRACKER_ID = 'outfit';
const WARDROBE_TRACKER_ID = 'wardrobe';
const WARDROBE_FIELD_ID = 'items';

function getSubject(engine, subjectId) {
  return engine.subjects.get(subjectId);
}

/** Ensure subj.outfitSets exists; returns it. */
function ensureSetsMap(subj) {
  if (!subj.outfitSets) subj.outfitSets = {};
  return subj.outfitSets;
}

/** List the saved set names for a subject. */
export function listSets(engine, subjectId) {
  const subj = getSubject(engine, subjectId);
  if (!subj?.outfitSets) return [];
  return Object.keys(subj.outfitSets).sort();
}

/** Return the saved values for a named set, or null. */
export function getSet(engine, subjectId, name) {
  const subj = getSubject(engine, subjectId);
  return subj?.outfitSets?.[name] ?? null;
}

/**
 * Capture the current outfit field values as a named set.
 * Overwrites any existing set with the same name.
 */
export function saveSet(engine, subjectId, name) {
  const subj = getSubject(engine, subjectId);
  if (!subj) throw new Error(`subject not found: ${subjectId}`);
  const trackerDef = engine.getTracker(OUTFIT_TRACKER_ID);
  if (!trackerDef) throw new Error(`outfit tracker not installed`);
  const snapshot = {};
  for (const f of trackerDef.fields) {
    const v = engine.getField(subjectId, OUTFIT_TRACKER_ID, f.id);
    if (v !== undefined && v !== null) snapshot[f.id] = v;
  }
  const sets = ensureSetsMap(subj);
  sets[name] = snapshot;
  // Persist via SubjectStore's existing mechanism: writing to the subject
  // object then re-saving the whole list.
  engine.subjects._persist();
  engine.bus.emit('tracker:outfit-set-saved', { subject: subjectId, name });
}

/**
 * Delete a saved set by name. No-op if not present.
 */
export function deleteSet(engine, subjectId, name) {
  const subj = getSubject(engine, subjectId);
  if (!subj?.outfitSets) return;
  delete subj.outfitSets[name];
  engine.subjects._persist();
  engine.bus.emit('tracker:outfit-set-deleted', { subject: subjectId, name });
}

/**
 * Apply a saved set. Performs the wardrobe swap (displaced items into wardrobe,
 * set items removed from wardrobe), then updates outfit fields.
 */
export function applySet(engine, subjectId, name) {
  const setValues = getSet(engine, subjectId, name);
  if (!setValues) throw new Error(`outfit set not found: ${name}`);
  const trackerDef = engine.getTracker(OUTFIT_TRACKER_ID);
  if (!trackerDef) throw new Error(`outfit tracker not installed`);

  const hasWardrobe = !!engine.getTracker(WARDROBE_TRACKER_ID);

  for (const f of trackerDef.fields) {
    const current = engine.getField(subjectId, OUTFIT_TRACKER_ID, f.id);
    const incoming = setValues[f.id];

    // 1. If we have a wardrobe AND the field changed AND the current value is
    //    a non-empty string, move it into wardrobe.items.
    if (hasWardrobe && current && current !== incoming && typeof current === 'string') {
      try { engine.addListEntry(subjectId, WARDROBE_TRACKER_ID, WARDROBE_FIELD_ID, current, { source: 'manual' }); }
      catch (_) { /* schema may differ; skip */ }
    }

    // 2. If wardrobe currently contains the incoming value, remove it (we're
    //    taking it out of the closet to wear).
    if (hasWardrobe && incoming && typeof incoming === 'string') {
      try { engine.removeListEntry(subjectId, WARDROBE_TRACKER_ID, WARDROBE_FIELD_ID, incoming, { source: 'manual' }); }
      catch (_) { /* skip if not present */ }
    }

    // 3. Apply the new value (empty string clears the slot).
    try {
      engine.setField(subjectId, OUTFIT_TRACKER_ID, f.id, incoming ?? '', { source: 'manual' });
    } catch (_) {
      // Field may not exist in user-modified outfit schema; skip
    }
  }

  engine.bus.emit('tracker:outfit-set-applied', { subject: subjectId, name });
}
