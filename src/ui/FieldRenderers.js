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
    const touchIdx = snapshots.findIndex(s => s.id === stored.lastTouchedMsg);
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
        onRefresh: () => deps.requestProbe(subj.id, field._trackerId, field.id, liveValue),
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
      // If paired with a max field, show "current / max" inline so user sees both at a glance
      const extras = [];
      if (field.allowDelta) {
        const $val = $('<span class="strk-field-val"></span>').text(cur);
        extras.push($minus, $val, $plus);
      }
      if (field.maxFromField) {
        const maxValue = engine.getField(subj.id, field._trackerId, field.maxFromField);
        const $ratio = $('<span class="strk-field-ratio"></span>').text(`/ ${maxValue ?? '?'}`);
        extras.push($ratio);
      } else if (field.displayAs === 'percent') {
        const $pct = $('<span class="strk-field-ratio"></span>').text('%');
        extras.push($pct);
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
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? [];
      const $cluster = $('<div class="strk-chip-cluster"></div>');
      for (const entry of cur) {
        const $chip = $('<span class="strk-chip"></span>').text(entry);
        $chip.on('contextmenu', (e) => { e.preventDefault(); engine.removeListEntry(subj.id, field._trackerId, field.id, entry, { source: 'manual' }); });
        $chip.on('click', () => {
          if (field.describable) {
            const prose = engine.getDescription(subj.id, field._trackerId, field.id, entry) ?? '';
            deps.openProseModal({
              title: `${field.label}: ${entry}`,
              text: prose,
              onSave: (p) => engine.setDescription(subj.id, field._trackerId, field.id, entry, p),
              onRefresh: () => deps.requestProbe(subj.id, field._trackerId, field.id, entry),
            });
          }
        });
        $cluster.append($chip);
      }
      const $add = $('<button class="strk-field-icon">+</button>').on('click', async () => {
        const v = deps.dialogs
          ? await deps.dialogs.prompt(`Add entry to ${field.label}:`)
          : prompt(`Add entry to ${field.label}:`);
        if (v) engine.addListEntry(subj.id, field._trackerId, field.id, v, { source: 'manual' });
      });
      $cluster.append($add);
      return row(field, subj, $cluster, []);
    },
    'pair-list': (field, subj) => {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? [];
      const $cluster = $('<div class="strk-pair-list"></div>');

      const renderPairRow = (pair, idx) => {
        const $r = $('<div class="strk-pair-row"></div>');
        const $name = $('<input class="text_pole strk-pair-name" type="text" />').val(pair.name);
        const $desc = $('<input class="text_pole strk-pair-desc" type="text" />').val(pair.descriptor ?? '');
        $name.attr('placeholder', 'Name');
        $desc.attr('placeholder', 'Descriptor (e.g. childhood friend)');
        // Commit on blur or Enter; rename does an upsert under the new name + remove of old.
        let lastName = pair.name;
        const commitName = () => {
          const next = String($name.val() ?? '').trim();
          if (next === lastName) return;
          if (lastName) engine.removePair(subj.id, field._trackerId, field.id, lastName, { source: 'manual' });
          if (next) engine.setPair(subj.id, field._trackerId, field.id, next, String($desc.val() ?? ''), { source: 'manual' });
          lastName = next;
        };
        const commitDesc = () => {
          const name = String($name.val() ?? '').trim();
          if (!name) return;
          engine.setPair(subj.id, field._trackerId, field.id, name, String($desc.val() ?? ''), { source: 'manual' });
        };
        $name.on('change', commitName).on('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } });
        $desc.on('change', commitDesc).on('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitDesc(); } });
        const $rm = $('<button class="strk-field-icon" title="Remove">×</button>').on('click', () => {
          if (pair.name) engine.removePair(subj.id, field._trackerId, field.id, pair.name, { source: 'manual' });
        });
        $r.append($name).append($desc).append($rm);
        return $r;
      };

      for (let i = 0; i < cur.length; i++) {
        $cluster.append(renderPairRow(cur[i], i));
      }
      const $add = $('<button class="strk-field-icon strk-pair-add">+ Add</button>').on('click', async () => {
        const name = deps.dialogs
          ? await deps.dialogs.prompt(`Name for new ${field.label} entry:`)
          : prompt(`Name for new ${field.label} entry:`);
        if (!name || !String(name).trim()) return;
        engine.setPair(subj.id, field._trackerId, field.id, String(name).trim(), '', { source: 'manual' });
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