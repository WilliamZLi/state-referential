/**
 * Compute whether a field's inclusion rule currently passes.
 *
 * Heuristic for 'active' rule when panel doesn't have message-index access:
 * We use listSnapshots().length as a rough proxy for "turns elapsed". The
 * snapshot is taken once per turn, so snapshot-count difference approximates
 * the message-index difference well enough for a dim/undim UI signal.
 * For more accurate behaviour, callers can pass getCurrentMsgId / getMsgIndex
 * via deps.autoUpdate's deps — but we intentionally avoid coupling the panel
 * to autoUpdate internals; the heuristic is documented here and in the report.
 *
 * @param {object} field - field definition (with .inclusion)
 * @param {string} subjectId
 * @param {string} trackerId
 * @param {TrackerEngine} engine
 * @returns {{ passes: boolean, reason: string }}
 */
function computeInclusion(field, subjectId, trackerId, engine) {
  const rule = field.inclusion?.rule ?? 'always';
  if (rule === 'always') return { passes: true, reason: '' };
  if (rule === 'manual') return { passes: false, reason: 'Inactive: manual-only field' };
  if (rule === 'tag') {
    const required = field.inclusion?.tags ?? [];
    const anyActive = engine.tags.anyActive(required);
    if (anyActive) return { passes: true, reason: '' };
    return { passes: false, reason: `Inactive: tag rule requires one of [${required.join(', ')}]` };
  }
  if (rule === 'active') {
    const stored = engine.values.getStored(subjectId, trackerId, field.id);
    // Never touched = neutral/ready state, not stale. Only dim when the window has expired after a prior activation.
    if (!stored?.lastTouchedMsg) return { passes: true, reason: '' };
    // Snapshot-count heuristic: each snapshot ≈ one turn.
    const snapshots = engine.listSnapshots();
    const snapshotCount = snapshots.length;
    // Find the snapshot index closest in time to lastTouchedMsg.
    // snapshots are ordered oldest→newest; find last one at or before the touch.
    const touchIdx = snapshots.findIndex(s => s.msgId === stored.lastTouchedMsg);
    const activeWindow = field.inclusion?.activeWindow ?? 5;
    let turnsSince;
    if (touchIdx >= 0) {
      turnsSince = snapshotCount - touchIdx - 1;
    } else {
      // lastTouchedMsg not found in snapshot ids — assume it was pre-snapshot history
      turnsSince = snapshotCount;
    }
    if (turnsSince <= activeWindow) return { passes: true, reason: '' };
    return { passes: false, reason: `Inactive: active-window expired (last touched ~${turnsSince} turns ago, window=${activeWindow})` };
  }
  return { passes: true, reason: '' };
}

/**
 * @param {TrackerEngine} engine
 * @param {{popup, openProseModal, requestProbe, autoUpdate?, injection?}} deps
 */
export function makeRenderers(engine, deps) {
  function row(field, subj, $input, extras = []) {
    const $row = $('<div class="strk-field-row"></div>');

    // Compute inclusion state for visual dimming
    const { passes, reason } = computeInclusion(field, subj.id, field._trackerId, engine);
    if (!passes) {
      $row.addClass('stale');
      if (reason) $row.attr('title', reason);
      // "[Include once]" button for stale rows
      if (deps.autoUpdate || deps.injection) {
        const $once = $('<button class="strk-field-icon strk-include-once" title="Include once in next update">↺</button>')
          .on('click', function () {
            deps.autoUpdate?.includeOnce(subj.id, field._trackerId, field.id);
            deps.injection?.includeOnce(subj.id, field._trackerId, field.id);
            const $btn = $(this);
            const orig = $btn.text();
            $btn.text('✓').css('color', '#4af');
            setTimeout(() => { $btn.text(orig).css('color', ''); }, 1200);
          });
        extras = [...extras, $once];
      }
    }

    $row.append($('<span class="strk-field-label"></span>').text(field.label));
    $row.append($('<span class="strk-field-input"></span>').append($input));
    for (const ex of extras) $row.append(ex);
    return $row;
  }

  function isProbing(subjId, trackerId, fieldId, value) {
    return deps.descProbe?.isProbing?.(subjId, trackerId, fieldId, value) === true;
  }

  function descBtn(field, subj, _capturedAtRender) {
    if (!field.describable) return null;
    // Initial busy-state is captured at render time for display, but the click handler
    // ALWAYS reads the LIVE value from the engine — so changing the dropdown then
    // clicking the pencil opens the modal for the current value, not the captured one.
    const busy = isProbing(subj.id, field._trackerId, field.id, _capturedAtRender);
    const $b = $('<button class="strk-field-icon" title="Edit description">🖉</button>');
    if (busy) {
      $b.prop('disabled', true).attr('title', 'Probe in progress — please wait').css({ opacity: 0.5, cursor: 'wait' });
      return $b;
    }
    return $b.on('click', () => {
      const liveValue = engine.getField(subj.id, field._trackerId, field.id);
      if (liveValue === undefined || liveValue === '' || liveValue === null) {
        deps.dialogs?.alert?.('Set a value first, then click the pencil to edit its description.');
        return;
      }
      const prose = engine.getDescription(subj.id, field._trackerId, field.id, liveValue) ?? '';
      deps.openProseModal({
        title: `${field.label} = ${liveValue}`,
        text: prose,
        onSave: (newProse) => engine.setDescription(subj.id, field._trackerId, field.id, liveValue, newProse),
        onRefresh: async () => {
          engine.invalidateDescription(subj.id, field._trackerId, field.id, liveValue);
          await deps.requestProbe(subj.id, field._trackerId, field.id, liveValue);
          return engine.getDescription(subj.id, field._trackerId, field.id, liveValue) ?? '';
        },
      });
    });
  }

  function reprobeBtn(field, subj, _capturedAtRender) {
    if (!field.describable) return null;
    const busy = isProbing(subj.id, field._trackerId, field.id, _capturedAtRender);
    if (busy) {
      return $('<button class="strk-field-icon" title="Probe in progress…">⏳</button>')
        .prop('disabled', true).css({ opacity: 0.6, cursor: 'wait' });
    }
    return $('<button class="strk-field-icon" title="Re-probe">⟳</button>').on('click', () => {
      const liveValue = engine.getField(subj.id, field._trackerId, field.id);
      if (liveValue === undefined || liveValue === '' || liveValue === null) return;
      engine.invalidateDescription(subj.id, field._trackerId, field.id, liveValue);
      deps.requestProbe(subj.id, field._trackerId, field.id, liveValue);
    });
  }

  // Debounced setField to commit text/number edits without waiting for blur.
  // 50ms is short enough that even rapid-click-Send committed mid-typing.
  // The persist to chat metadata is itself debounced inside the backend, so this
  // doesn't actually save to disk per keystroke.
  function debouncedSetter(subjectId, trackerId, fieldId, coerce = (x) => x) {
    let timer = null;
    return function (value) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        engine.setField(subjectId, trackerId, fieldId, coerce(value), { source: 'manual' });
      }, 50);
    };
  }

  return {
    text(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? '';
      const commit = debouncedSetter(subj.id, field._trackerId, field.id);
      const $input = $('<input type="text" class="text_pole" />').val(cur)
        .on('input', e => commit(e.target.value))
        .on('change', e => {
          // Final commit on blur — synchronous, in case a pending debounce hasn't fired.
          engine.setField(subj.id, field._trackerId, field.id, e.target.value, { source: 'manual' });
        });
      return row(field, subj, $input, [descBtn(field, subj, cur), reprobeBtn(field, subj, cur)].filter(Boolean));
    },
    number(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? field.default ?? 0;
      const $input = $('<input type="number" class="text_pole" />').val(cur);
      if (field.min != null) $input.attr('min', field.min);
      if (field.max != null) $input.attr('max', field.max);
      if (field.step != null) $input.attr('step', field.step);
      const commit = debouncedSetter(subj.id, field._trackerId, field.id, (v) => Number(v));
      $input.on('input', e => commit(e.target.value))
            .on('change', e => engine.setField(subj.id, field._trackerId, field.id, Number(e.target.value), { source: 'manual' }));
      const $minus = $('<button class="strk-field-icon">−</button>').on('click', () =>
        engine.applyDelta(subj.id, field._trackerId, field.id, -(field.step ?? 1), { source: 'manual' }));
      const $plus  = $('<button class="strk-field-icon">+</button>').on('click', () =>
        engine.applyDelta(subj.id, field._trackerId, field.id,  (field.step ?? 1), { source: 'manual' }));
      // Show "/ max" (or "%") right after the input, then the −/+ stepper:  [input] / max  − val +
      const extras = [];
      if (field.maxFromField) {
        const companion = engine.definitions.getField(field._trackerId, field.maxFromField);
        const maxValue = engine.getField(subj.id, field._trackerId, field.maxFromField) ?? companion?.default;
        extras.push($('<span class="strk-field-ratio"></span>').text(`/ ${maxValue ?? '?'}`));
      } else if (field.displayAs === 'percent') {
        extras.push($('<span class="strk-field-ratio"></span>').text('%'));
      } else if (field.max != null) {
        extras.push($('<span class="strk-field-ratio"></span>').text(`/ ${field.max}`));
      }
      if (field.allowDelta) {
        const $val = $('<span class="strk-field-val"></span>').text(cur);
        extras.push($minus, $val, $plus);
      }
      return row(field, subj, $input, extras);
    },
    enum(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? field.default ?? field.options[0];
      const $sel = $('<select class="text_pole"></select>');
      for (const opt of field.options) $sel.append($('<option></option>').val(opt).text(opt));
      $sel.val(cur);
      const commit = (e) => {
        const v = e.target.value;
        const stored = engine.getField(subj.id, field._trackerId, field.id);
        if (stored === v) return; // no-op if unchanged (debounces double-fire from change+input)
        engine.setField(subj.id, field._trackerId, field.id, v, { source: 'manual' });
      };
      // Bind both events — some ST themes enhance <select> in ways that suppress native 'change'.
      $sel.on('change', commit).on('input', commit);
      return row(field, subj, $sel, [descBtn(field, subj, cur), reprobeBtn(field, subj, cur)].filter(Boolean));
    },
    list(field, subj) {
      const t = field._trackerId, f = field.id;
      const cur = engine.getField(subj.id, t, f) ?? [];
      const activeWindow = field.inclusion?.activeWindow;
      const itemMeta = activeWindow != null ? engine.getListMeta(subj.id, t, f) : {};
      const snapshots = activeWindow != null ? engine.listSnapshots() : [];
      const $cluster = $('<div class="strk-chip-cluster"></div>');

      // Turns remaining for a countdown entry (null if not a countdown field / no meta).
      const remainingFor = (entry) => {
        if (activeWindow == null) return null;
        const meta = itemMeta[entry];
        if (!meta) return null;
        if (meta.expiresAtSnapCount != null) return meta.expiresAtSnapCount - snapshots.length;
        let turnsSince;
        if (meta.addedAtMsg) {
          const ti = snapshots.findIndex(s => s.msgId === meta.addedAtMsg);
          turnsSince = ti >= 0 ? snapshots.length - ti - 1 : snapshots.length;
        } else if (meta.addedAtSnapCount != null) {
          turnsSince = snapshots.length - meta.addedAtSnapCount;
        } else {
          turnsSince = 0;
        }
        return activeWindow - turnsSince;
      };

      // Chip click → unified detail popup: rename, edit description, set turns.
      const openDetail = (entry) => {
        const rem = remainingFor(entry);
        const currentRemaining = rem == null ? null : Math.max(0, rem);
        deps.openProseModal({
          title: `${field.label}: ${entry}`,
          name: entry,
          text: field.describable ? (engine.getDescription(subj.id, t, f, entry) ?? '') : undefined,
          turns: activeWindow != null ? { value: currentRemaining ?? 0, max: activeWindow } : undefined,
          onSave: (newText, extra) => {
            const newName = extra?.name;
            const newTurns = extra?.turns;
            let current = entry;
            if (newName && newName !== entry) {
              engine.renameListEntry(subj.id, t, f, entry, newName, { source: 'manual' });
              current = newName;
            }
            if (field.describable && newText !== undefined) {
              engine.setDescription(subj.id, t, f, current, newText);
            }
            if (activeWindow != null && Number.isFinite(newTurns) && newTurns !== currentRemaining) {
              const clamped = Math.min(activeWindow, Math.max(0, newTurns));
              const nowSnap = engine.listSnapshots().length;
              engine.removeListEntry(subj.id, t, f, current, { source: 'manual' });
              engine.addListEntry(subj.id, t, f, current, { source: 'manual', expiresAtSnapCount: nowSnap + clamped });
            }
          },
          onRefresh: field.describable ? (async () => {
            engine.invalidateDescription(subj.id, t, f, entry);
            await deps.requestProbe(subj.id, t, f, entry);
            return engine.getDescription(subj.id, t, f, entry) ?? '';
          }) : undefined,
        });
      };

      for (const entry of cur) {
        const rem = remainingFor(entry);
        const expired = rem != null && rem <= 0;
        const label = (rem != null && !expired) ? `${entry} (${rem})` : entry;
        const $chip = $('<span class="strk-chip"></span>').text(label);
        if (expired) $chip.addClass('strk-chip-expired');
        $chip.attr('title', 'Click to edit; right-click to remove');
        $chip.on('click', () => openDetail(entry));
        $chip.on('contextmenu', (e) => { e.preventDefault(); engine.removeListEntry(subj.id, t, f, entry, { source: 'manual' }); });
        $cluster.append($chip);
      }
      const $add = $('<button class="strk-field-icon">+</button>').on('click', async () => {
        const v = deps.dialogs
          ? await deps.dialogs.prompt(`Add entry to ${field.label}:`)
          : prompt(`Add entry to ${field.label}:`);
        if (v) {
          const addMsgId = activeWindow != null ? (snapshots[snapshots.length - 1]?.msgId ?? null) : null;
          engine.addListEntry(subj.id, t, f, v, {
            source: 'manual',
            msgId: addMsgId,
            addedAtSnapCount: activeWindow != null ? snapshots.length : undefined,
          });
        }
      });
      $cluster.append($add);
      return row(field, subj, $cluster, []);
    },
    'pair-list': (field, subj) => {
      const t = field._trackerId, f = field.id;
      const cur = engine.getField(subj.id, t, f) ?? [];
      const $cluster = $('<div class="strk-chip-cluster"></div>');

      // Chip click → detail popup: rename + edit the (often long) descriptor in a big box.
      const openDetail = (pair) => {
        deps.openProseModal({
          title: field.label,
          name: pair.name,
          text: pair.descriptor ?? '',
          textLabel: 'Descriptor',
          onSave: (newDesc, extra) => {
            const finalName = (extra?.name && extra.name.trim()) ? extra.name.trim() : pair.name;
            if (finalName !== pair.name) engine.removePair(subj.id, t, f, pair.name, { source: 'manual' });
            engine.setPair(subj.id, t, f, finalName, String(newDesc ?? ''), { source: 'manual' });
          },
          // No onRefresh — pair-list descriptors are inline, never AI-probed.
        });
      };

      for (const pair of cur) {
        if (!pair?.name) continue;
        const $chip = $('<span class="strk-chip"></span>').text(pair.name);
        $chip.attr('title', 'Click to edit; right-click to remove');
        $chip.on('click', () => openDetail(pair));
        $chip.on('contextmenu', (e) => { e.preventDefault(); engine.removePair(subj.id, t, f, pair.name, { source: 'manual' }); });
        $cluster.append($chip);
      }
      const $add = $('<button class="strk-field-icon">+</button>').on('click', async () => {
        const name = deps.dialogs
          ? await deps.dialogs.prompt(`Name for new ${field.label} entry:`)
          : prompt(`Name for new ${field.label} entry:`);
        if (!name || !String(name).trim()) return;
        engine.setPair(subj.id, t, f, String(name).trim(), '', { source: 'manual' });
      });
      $cluster.append($add);
      return row(field, subj, $cluster, []);
    },
    prose(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? '';
      const $preview = $('<div class="strk-prose-preview"></div>').text(cur.slice(0, 80) + (cur.length > 80 ? '…' : ''));
      const $edit = $('<button class="strk-field-icon">🖉</button>').on('click', () => {
        deps.openProseModal({
          title: field.label,
          text: cur,
          onSave: (p) => engine.setField(subj.id, field._trackerId, field.id, p, { source: 'manual' }),
        });
      });
      return row(field, subj, $preview, [$edit]);
    },
  };
}