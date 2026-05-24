import { loadTemplate } from './shared.js';

export class SchemaEditor {
  constructor(engine, deps) {
    this.engine = engine;
    this.deps = deps; // { callGenericPopup, POPUP_TYPE }
  }

  async open(trackerId) {
    const html = await loadTemplate('schema-editor');
    const $form = $(html);
    const def = trackerId ? this.engine.getTracker(trackerId) : { id: '', label: '', fields: [], appliesToRoles: ['protagonist','npc'], autoUpdate: true };
    $('#strk-schema-id', $form).val(def.id).prop('disabled', !!trackerId);
    $('#strk-schema-label', $form).val(def.label);
    $('#strk-schema-autoupdate', $form).prop('checked', def.autoUpdate !== false);
    $('.strk-role-cb', $form).each((_, cb) => $(cb).prop('checked', def.appliesToRoles.includes(cb.value)));

    const $body = $('#strk-fields-body', $form);
    const renderFieldRow = (f) => {
      const $tr = $('<tr></tr>');
      $tr.data('original', f);
      $tr.append($('<td><input class="text_pole f-id" /></td>').find('input').val(f.id ?? '').end());
      $tr.append($('<td><input class="text_pole f-label" /></td>').find('input').val(f.label ?? '').end());
      const $sel = $('<select class="text_pole f-type"></select>');
      for (const t of ['text','number','enum','list','prose']) $sel.append($('<option></option>').val(t).text(t));
      $sel.val(f.type ?? 'text');
      $tr.append($('<td></td>').append($sel));
      $tr.append($('<td style="text-align:center"><input type="checkbox" class="f-describable" /></td>').find('input').prop('checked', f.describable !== false).end());
      const $scope = $('<select class="text_pole f-scope"></select>')
        .append($('<option value="per-subject">per-subject</option>'))
        .append($('<option value="global">global</option>'));
      $scope.val(f.descriptionScope ?? 'per-subject');
      $tr.append($('<td></td>').append($scope));
      const $incl = $('<select class="text_pole f-inclusion"></select>');
      for (const r of ['always','active','tag','manual']) $incl.append($('<option></option>').val(r).text(r));
      $incl.val(f.inclusion?.rule ?? 'always');
      $tr.append($('<td></td>').append($incl));
      $tr.append($('<td style="text-align:center"><input type="checkbox" class="f-inj" /></td>').find('input').prop('checked', f.injection?.enabled === true).end());
      const $del = $('<td><button class="menu_button">×</button></td>').find('button').on('click', () => $tr.remove()).end();
      $tr.append($del);
      $body.append($tr);
    };
    for (const f of def.fields) renderFieldRow(f);
    $('#strk-add-field', $form).on('click', () => renderFieldRow({ id: '', label: '', type: 'text' }));

    $('#strk-schema-save', $form).on('click', () => {
      const fields = [];
      $('tr', $body).each((_, tr) => {
        const $tr = $(tr);
        const original = $tr.data('original') ?? {};
        const inclusionRule = $('.f-inclusion', $tr).val() || 'always';
        fields.push({
          ...original, // preserve min/max/options/step/allowDelta/template/position/depth/trigger/tags
          id: $('.f-id', $tr).val(),
          label: $('.f-label', $tr).val(),
          type: $('.f-type', $tr).val(),
          describable: $('.f-describable', $tr).is(':checked'),
          descriptionScope: $('.f-scope', $tr).val(),
          inclusion: { ...(original.inclusion ?? {}), rule: inclusionRule },
          injection: { ...(original.injection ?? {}), enabled: $('.f-inj', $tr).is(':checked') },
        });
      });
      const next = {
        id: $('#strk-schema-id', $form).val(),
        label: $('#strk-schema-label', $form).val(),
        autoUpdate: $('#strk-schema-autoupdate', $form).is(':checked'),
        appliesToRoles: $('.strk-role-cb:checked', $form).map((_, cb) => cb.value).get(),
        fields,
      };
      if (trackerId) this.engine.updateTracker(trackerId, next);
      else this.engine.defineTracker(next);
      this.deps.close?.();
    });

    $('#strk-schema-export', $form).on('click', () => {
      const d = trackerId ? this.engine.getTracker(trackerId) : null;
      if (d) navigator.clipboard.writeText(JSON.stringify(d, null, 2));
    });
    $('#strk-schema-cancel', $form).on('click', () => this.deps.close?.());

    await this.deps.callGenericPopup($form[0], this.deps.POPUP_TYPE?.DISPLAY ?? 1, '', { wide: true, large: true });
  }
}