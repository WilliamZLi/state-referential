/**
 * @param {TrackerEngine} engine
 * @param {{popup, openProseModal, requestProbe}} deps
 */
export function makeRenderers(engine, deps) {
  function row(field, subj, $input, extras = []) {
    const $row = $('<div class="strk-field-row"></div>');
    $row.append($('<span class="strk-field-label"></span>').text(field.label));
    $row.append($('<span class="strk-field-input"></span>').append($input));
    for (const ex of extras) $row.append(ex);
    return $row;
  }

  function descBtn(field, subj, currentValue) {
    if (!field.describable) return null;
    return $('<button class="strk-field-icon" title="Edit description">🖉</button>').on('click', () => {
      const prose = engine.getDescription(subj.id, field._trackerId, field.id, currentValue) ?? '';
      deps.openProseModal({
        title: `${field.label} = ${currentValue}`,
        text: prose,
        onSave: (newProse) => engine.setDescription(subj.id, field._trackerId, field.id, currentValue, newProse),
        onRefresh: () => deps.requestProbe(subj.id, field._trackerId, field.id, currentValue),
      });
    });
  }

  function reprobeBtn(field, subj, currentValue) {
    if (!field.describable) return null;
    return $('<button class="strk-field-icon" title="Re-probe">⟳</button>').on('click', () => {
      engine.invalidateDescription(subj.id, field._trackerId, field.id, currentValue);
      deps.requestProbe(subj.id, field._trackerId, field.id, currentValue);
    });
  }

  return {
    text(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? '';
      const $input = $('<input type="text" class="text_pole" />').val(cur).on('change', e => {
        engine.setField(subj.id, field._trackerId, field.id, e.target.value, { source: 'manual' });
      });
      return row(field, subj, $input, [descBtn(field, subj, cur), reprobeBtn(field, subj, cur)].filter(Boolean));
    },
    number(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? field.default ?? 0;
      const useSlider = field.min != null && field.max != null;
      const $input = useSlider
        ? $(`<input type="range" min="${field.min}" max="${field.max}" />`).val(cur)
        : $('<input type="number" class="text_pole" />').val(cur);
      $input.on('change', e => engine.setField(subj.id, field._trackerId, field.id, Number(e.target.value), { source: 'manual' }));
      const $minus = $('<button class="strk-field-icon">−</button>').on('click', () =>
        engine.applyDelta(subj.id, field._trackerId, field.id, -(field.step ?? 1), { source: 'manual' }));
      const $plus  = $('<button class="strk-field-icon">+</button>').on('click', () =>
        engine.applyDelta(subj.id, field._trackerId, field.id,  (field.step ?? 1), { source: 'manual' }));
      const $val = $('<span class="strk-field-val"></span>').text(cur);
      return row(field, subj, $input, field.allowDelta ? [$minus, $val, $plus] : []);
    },
    enum(field, subj) {
      const cur = engine.getField(subj.id, field._trackerId, field.id) ?? field.default ?? field.options[0];
      const $sel = $('<select class="text_pole"></select>');
      for (const opt of field.options) $sel.append($('<option></option>').val(opt).text(opt));
      $sel.val(cur).on('change', e => engine.setField(subj.id, field._trackerId, field.id, e.target.value, { source: 'manual' }));
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
      const $add = $('<button class="strk-field-icon">+</button>').on('click', () => {
        const v = prompt(`Add entry to ${field.label}:`);
        if (v) engine.addListEntry(subj.id, field._trackerId, field.id, v, { source: 'manual' });
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