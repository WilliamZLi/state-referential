import { loadTemplate, loadPreset } from './shared.js';

export class SchemaEditor {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps; // { callGenericPopup, POPUP_TYPE }
  }

  async open(trackerId) {
    const html = await loadTemplate('schema-editor');
    const $form = $(html);
    const def = trackerId
      ? this.engine.getTracker(trackerId)
      : { id: '', label: '', fields: [], appliesToRoles: ['protagonist', 'npc'], autoUpdate: true };

    $('#strk-schema-id', $form).val(def.id).prop('disabled', !!trackerId);
    $('#strk-schema-label', $form).val(def.label);
    $('#strk-schema-autoupdate', $form).prop('checked', def.autoUpdate !== false);
    $('.strk-role-cb', $form).each((_, cb) => $(cb).prop('checked', def.appliesToRoles.includes(cb.value)));

    // ── Tracker-level injection ───────────────────────────────────────────────
    const defInj = def.injection ?? {};
    $('#strk-inj-enabled', $form).prop('checked', defInj.enabled === true);
    $('#strk-inj-trigger', $form).val(defInj.trigger ?? 'always');
    $('#strk-inj-tags', $form).val(Array.isArray(defInj.tags) ? defInj.tags.join(', ') : (defInj.tags ?? ''));
    $('#strk-inj-position', $form).val(defInj.position ?? 'in-prompt');
    $('#strk-inj-depth', $form).val(defInj.depth ?? 4);
    $('#strk-inj-template', $form).val(defInj.template ?? '');

    // Show/hide tags row based on trigger
    const updateTagRowVisibility = () => {
      const trigger = $('#strk-inj-trigger', $form).val();
      if (trigger === 'tag') {
        $('.strk-inj-tag-row', $form).removeClass('strk-hidden');
      } else {
        $('.strk-inj-tag-row', $form).addClass('strk-hidden');
      }
    };
    updateTagRowVisibility();
    $('#strk-inj-trigger', $form).on('change', updateTagRowVisibility);

    const $body = $('#strk-fields-body', $form);

    // ── drag-reorder state ────────────────────────────────────────────────────
    let _dragSrc = null;

    const renderFieldRow = (f) => {
      const $tr = $('<tr></tr>');
      $tr.data('original', jQuery.extend(true, {}, f));

      // Drag handle cell — only this cell is draggable so text-selection in inputs works
      const $handle = $('<td class="strk-drag-col strk-drag-handle" draggable="true" title="Drag to reorder">≡</td>');
      $tr.append($handle);

      // ID
      $tr.append($('<td><input class="text_pole f-id" /></td>').find('input').val(f.id ?? '').end());

      // Label
      $tr.append($('<td><input class="text_pole f-label" /></td>').find('input').val(f.label ?? '').end());

      // Type — with confirm on change
      const $sel = $('<select class="text_pole f-type"></select>');
      for (const t of ['text', 'number', 'enum', 'list', 'prose']) {
        $sel.append($('<option></option>').val(t).text(t));
      }
      $sel.val(f.type ?? 'text');
      $sel.on('change', function () {
        const orig = $tr.data('original');
        const origType = orig.type ?? 'text';
        const newType = $(this).val();
        if (origType !== newType) {
          const ok = confirm(
            `Changing type from "${origType}" to "${newType}" will reset default/options/min/max. Continue?`
          );
          if (!ok) {
            $(this).val(origType);
          } else {
            // Reset type-specific fields in original so details modal starts fresh
            const updated = $tr.data('original');
            delete updated.default;
            delete updated.options;
            delete updated.min;
            delete updated.max;
            delete updated.step;
            delete updated.allowDelta;
            updated.type = newType;
            $tr.data('original', updated);
          }
        }
      });
      $tr.append($('<td></td>').append($sel));

      // Describable
      $tr.append(
        $('<td style="text-align:center"><input type="checkbox" class="f-describable" /></td>')
          .find('input').prop('checked', f.describable !== false).end()
      );

      // Scope
      const $scope = $('<select class="text_pole f-scope"></select>')
        .append($('<option value="per-subject">per-subject</option>'))
        .append($('<option value="global">global</option>'));
      $scope.val(f.descriptionScope ?? 'per-subject');
      $tr.append($('<td></td>').append($scope));

      // Inclusion rule
      const $incl = $('<select class="text_pole f-inclusion"></select>');
      for (const r of ['always', 'active', 'tag', 'manual']) {
        $incl.append($('<option></option>').val(r).text(r));
      }
      $incl.val(f.inclusion?.rule ?? 'always');
      $tr.append($('<td></td>').append($incl));

      // Inject enabled (include this field in the tracker's injection block)
      $tr.append(
        $('<td style="text-align:center"><input type="checkbox" class="f-inj" /></td>')
          .find('input').prop('checked', f.injection?.enabled !== false).end()
      );

      // ⚙ edit button cell
      const $editBtn = $('<button class="menu_button strk-field-edit-btn" title="Edit full field config (default, options, number bounds, inclusion details)">⚙</button>');
      $editBtn.on('click', async () => {
        await this._openFieldDetails($tr, $form);
      });
      $tr.append($('<td></td>').append($editBtn));

      // Delete button cell
      const $del = $('<td><button class="menu_button" title="Remove this field">×</button></td>')
        .find('button').on('click', () => $tr.remove()).end();
      $tr.append($del);

      // Prevent drag initiation when user clicks inside inputs/selects so text selection works
      $tr.find('input, select').on('mousedown', (e) => e.stopPropagation());

      // ── HTML5 drag-drop handlers ──────────────────────────────────────────
      // dragstart fires on the handle cell; we set _dragSrc to the full row
      $handle[0].addEventListener('dragstart', (e) => {
        _dragSrc = $tr[0];
        $tr.addClass('strk-drag-active');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to be set
        e.dataTransfer.setData('text/plain', '');
        e.stopPropagation();
      });
      $handle[0].addEventListener('dragend', () => {
        _dragSrc = null;
        $tr.removeClass('strk-drag-active');
        $body.find('tr').removeClass('strk-drag-over');
      });
      $tr[0].addEventListener('dragover', (e) => {
        if (!_dragSrc || _dragSrc === $tr[0]) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        $body.find('tr').removeClass('strk-drag-over');
        $tr.addClass('strk-drag-over');
      });
      $tr[0].addEventListener('dragleave', () => {
        $tr.removeClass('strk-drag-over');
      });
      $tr[0].addEventListener('drop', (e) => {
        e.preventDefault();
        $tr.removeClass('strk-drag-over');
        if (!_dragSrc || _dragSrc === $tr[0]) return;
        // Determine relative position — insert before or after based on pointer Y
        const rect = $tr[0].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          $tr[0].parentNode.insertBefore(_dragSrc, $tr[0]);
        } else {
          $tr[0].parentNode.insertBefore(_dragSrc, $tr[0].nextSibling);
        }
      });

      $body.append($tr);
    };

    for (const f of def.fields) renderFieldRow(f);
    $('#strk-add-field', $form).on('click', () => renderFieldRow({ id: '', label: '', type: 'text' }));

    // ── Save handler ─────────────────────────────────────────────────────────
    $('#strk-schema-save', $form).on('click', () => {
      const fields = [];
      $('tr', $body).each((_, tr) => {
        const $tr = $(tr);
        const original = $tr.data('original') ?? {};
        const inclusionRule = $('.f-inclusion', $tr).val() || 'always';
        fields.push({
          ...original,
          id: $('.f-id', $tr).val(),
          label: $('.f-label', $tr).val(),
          type: $('.f-type', $tr).val(),
          describable: $('.f-describable', $tr).is(':checked'),
          descriptionScope: $('.f-scope', $tr).val(),
          inclusion: { ...(original.inclusion ?? {}), rule: inclusionRule },
          // Per-field injection: only { enabled } — no other keys
          injection: { enabled: $('.f-inj', $tr).is(':checked') },
        });
      });

      // Tracker-level injection block
      const injTagsRaw = $('#strk-inj-tags', $form).val().trim();
      const injTags = injTagsRaw ? injTagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      const injDepth = parseInt($('#strk-inj-depth', $form).val(), 10);
      const injection = {
        enabled: $('#strk-inj-enabled', $form).is(':checked'),
        trigger: $('#strk-inj-trigger', $form).val() || 'always',
        tags: injTags,
        position: $('#strk-inj-position', $form).val() || 'in-prompt',
        depth: isNaN(injDepth) ? 4 : injDepth,
        template: $('#strk-inj-template', $form).val(),
      };

      const next = {
        id: $('#strk-schema-id', $form).val(),
        label: $('#strk-schema-label', $form).val(),
        autoUpdate: $('#strk-schema-autoupdate', $form).is(':checked'),
        appliesToRoles: $('.strk-role-cb:checked', $form).map((_, cb) => cb.value).get(),
        injection,
        fields,
      };
      if (def.source) next.source = def.source;
      if (trackerId) this.engine.updateTracker(trackerId, next);
      else this.engine.defineTracker(next);
      this.deps.close?.();
    });

    // ── Export ───────────────────────────────────────────────────────────────
    $('#strk-schema-export', $form).on('click', () => {
      const d = trackerId ? this.engine.getTracker(trackerId) : null;
      if (d) navigator.clipboard.writeText(JSON.stringify(d, null, 2));
    });

    // ── Cancel ───────────────────────────────────────────────────────────────
    $('#strk-schema-cancel', $form).on('click', () => this.deps.close?.());

    // ── Reset to preset ──────────────────────────────────────────────────────
    $('#strk-schema-reset', $form).on('click', async () => {
      const source = def.source ?? '';
      if (!source.startsWith('preset:')) {
        alert('Not a preset tracker — nothing to reset to.');
        return;
      }
      const presetName = source.split(':')[1];
      const ok = confirm(
        'Reset this tracker to its preset default? All your customizations will be lost.'
      );
      if (!ok) return;
      let preset;
      try {
        preset = await loadPreset(presetName);
      } catch (err) {
        alert(`Could not load preset "${presetName}": ${err.message}`);
        return;
      }
      // Re-render the form with preset data
      $body.empty();
      $('#strk-schema-id', $form).val(preset.id ?? def.id);
      $('#strk-schema-label', $form).val(preset.label ?? '');
      $('#strk-schema-autoupdate', $form).prop('checked', preset.autoUpdate !== false);
      $('.strk-role-cb', $form).each((_, cb) =>
        $(cb).prop('checked', (preset.appliesToRoles ?? ['protagonist', 'npc']).includes(cb.value))
      );
      // Re-populate tracker-level injection from preset
      const presetInj = preset.injection ?? {};
      $('#strk-inj-enabled', $form).prop('checked', presetInj.enabled === true);
      $('#strk-inj-trigger', $form).val(presetInj.trigger ?? 'always');
      $('#strk-inj-tags', $form).val(Array.isArray(presetInj.tags) ? presetInj.tags.join(', ') : (presetInj.tags ?? ''));
      $('#strk-inj-position', $form).val(presetInj.position ?? 'in-prompt');
      $('#strk-inj-depth', $form).val(presetInj.depth ?? 4);
      $('#strk-inj-template', $form).val(presetInj.template ?? '');
      updateTagRowVisibility();
      for (const f of (preset.fields ?? [])) renderFieldRow(f);
      // Update local def reference so subsequent reset attempts work
      Object.assign(def, preset);
    });

    await this.deps.callGenericPopup($form[0], this.deps.POPUP_TYPE?.DISPLAY ?? 1, '', {
      wide: true,
      large: true,
    });
  }

  // ── Field details sub-modal ─────────────────────────────────────────────────
  async _openFieldDetails($tr, $parentForm) {
    const detailsHtml = await loadTemplate('field-details-modal');
    const $d = $(detailsHtml);
    const orig = $tr.data('original') ?? {};
    const fieldType = $('.f-type', $tr).val() || orig.type || 'text';

    // Populate — Type-specific
    const defaultVal = orig.default ?? '';
    if (fieldType === 'number') {
      $('.strk-fdet-default-number', $d).val(defaultVal);
      $('.strk-fdet-default-text', $d).addClass('strk-hidden');
      $('.strk-fdet-default-number', $d).removeClass('strk-hidden');
    } else {
      // text/enum/list: for list, default is array; show comma-separated
      const displayDefault = Array.isArray(defaultVal) ? defaultVal.join(', ') : defaultVal;
      $('.strk-fdet-default-text', $d).val(displayDefault);
    }

    // enum options
    const optionsText = Array.isArray(orig.options) ? orig.options.join('\n') : (orig.options ?? '');
    $('.strk-fdet-options', $d).val(optionsText);

    // number bounds
    if (orig.min !== undefined && orig.min !== null) $('.strk-fdet-min', $d).val(orig.min);
    if (orig.max !== undefined && orig.max !== null) $('.strk-fdet-max', $d).val(orig.max);
    if (orig.step !== undefined && orig.step !== null) $('.strk-fdet-step', $d).val(orig.step);
    $('.strk-fdet-allow-delta', $d).prop('checked', orig.allowDelta === true);

    // Inclusion
    const inclRule = $('.f-inclusion', $tr).val() || orig.inclusion?.rule || 'always';
    $('.strk-fdet-incl-rule', $d).val(inclRule);
    $('.strk-fdet-incl-tags', $d).val(Array.isArray(orig.inclusion?.tags) ? orig.inclusion.tags.join(', ') : (orig.inclusion?.tags ?? ''));
    $('.strk-fdet-incl-active-window', $d).val(orig.inclusion?.activeWindow ?? 5);

    // Apply visibility for current type
    this._applyFieldDetailsVisibility($d, fieldType, inclRule);

    // Live visibility updates
    $('.strk-fdet-incl-rule', $d).on('change', () => {
      this._applyFieldDetailsVisibility(
        $d, fieldType,
        $('.strk-fdet-incl-rule', $d).val()
      );
    });

    // Save: merge back into row data and sync mirrored main-table widgets
    $('.strk-fdet-save', $d).on('click', () => {
      const updatedOrig = jQuery.extend(true, {}, $tr.data('original') ?? {});

      // default
      const curType = $('.f-type', $tr).val() || 'text';
      if (curType === 'number') {
        const n = parseFloat($('.strk-fdet-default-number', $d).val());
        updatedOrig.default = isNaN(n) ? 0 : n;
      } else if (curType === 'list') {
        const raw = $('.strk-fdet-default-text', $d).val().trim();
        updatedOrig.default = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
      } else {
        updatedOrig.default = $('.strk-fdet-default-text', $d).val();
      }

      // enum options
      if (curType === 'enum') {
        updatedOrig.options = $('.strk-fdet-options', $d).val()
          .split('\n').map(s => s.trim()).filter(Boolean);
      }

      // number bounds
      if (curType === 'number') {
        const minV = $('.strk-fdet-min', $d).val();
        const maxV = $('.strk-fdet-max', $d).val();
        const stepV = $('.strk-fdet-step', $d).val();
        if (minV !== '') updatedOrig.min = parseFloat(minV);
        if (maxV !== '') updatedOrig.max = parseFloat(maxV);
        if (stepV !== '') updatedOrig.step = parseFloat(stepV);
        updatedOrig.allowDelta = $('.strk-fdet-allow-delta', $d).is(':checked');
      }

      // inclusion
      const newInclRule = $('.strk-fdet-incl-rule', $d).val();
      const inclTagsRaw = $('.strk-fdet-incl-tags', $d).val().trim();
      const inclTags = inclTagsRaw ? inclTagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      const activeWin = parseInt($('.strk-fdet-incl-active-window', $d).val(), 10);
      updatedOrig.inclusion = {
        ...(updatedOrig.inclusion ?? {}),
        rule: newInclRule,
        tags: inclTags,
        activeWindow: isNaN(activeWin) ? 5 : activeWin,
      };
      // Sync main-table inclusion select
      $('.f-inclusion', $tr).val(newInclRule);

      $tr.data('original', updatedOrig);
      detailsPopupClose?.();
    });

    $('.strk-fdet-cancel', $d).on('click', () => {
      detailsPopupClose?.();
    });

    const detailsPopupClose = () => {
      const popup = document.querySelector('.popup:last-of-type');
      if (popup) {
        const closeBtn = popup.querySelector('.popup-button-ok, .popup-button-close, [data-i18n="Close"]');
        if (closeBtn) { closeBtn.click(); return; }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    await this.deps.callGenericPopup($d[0], this.deps.POPUP_TYPE?.DISPLAY ?? 1, '', {
      wide: false,
      large: false,
    });
  }

  _applyFieldDetailsVisibility($d, fieldType, inclRule) {
    // Show/hide enum-only rows
    if (fieldType === 'enum') {
      $('.strk-fdet-enum-only', $d).removeClass('strk-hidden');
    } else {
      $('.strk-fdet-enum-only', $d).addClass('strk-hidden');
    }

    // Show/hide number-only rows
    if (fieldType === 'number') {
      $('.strk-fdet-number-only', $d).removeClass('strk-hidden');
      $('.strk-fdet-default-text', $d).addClass('strk-hidden');
      $('.strk-fdet-default-number', $d).removeClass('strk-hidden');
    } else {
      $('.strk-fdet-number-only', $d).addClass('strk-hidden');
      $('.strk-fdet-default-text', $d).removeClass('strk-hidden');
      $('.strk-fdet-default-number', $d).addClass('strk-hidden');
    }

    // Inclusion conditional rows
    if (inclRule === 'tag') {
      $('.strk-fdet-incl-tag-only', $d).removeClass('strk-hidden');
    } else {
      $('.strk-fdet-incl-tag-only', $d).addClass('strk-hidden');
    }
    if (inclRule === 'active') {
      $('.strk-fdet-incl-active-only', $d).removeClass('strk-hidden');
    } else {
      $('.strk-fdet-incl-active-only', $d).addClass('strk-hidden');
    }
  }
}
