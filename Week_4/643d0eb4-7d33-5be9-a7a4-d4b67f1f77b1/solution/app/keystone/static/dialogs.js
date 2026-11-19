/* Console dialogs, built on demand so a closed dialog leaves nothing in the page. Each opens from its own control,
   moves focus inside, keeps Tab inside, closes on Escape and gives focus back to the control that opened it. */
(function () {
  'use strict';
  var K = (window.Keystone = window.Keystone || {});
  var counter = 0;

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href], button, input, select, textarea'), function (el) {
      return !el.disabled && el.type !== 'hidden' && el.getClientRects().length > 0;
    });
  }

  /* options: title, opener, submitLabel, build(form), onSubmit(form, api) -> Promise (api.close(), api.fail(text)) */
  K.openDialog = function (options) {
    counter += 1;
    var dialog = document.createElement('dialog');
    var titleId = 'dialog-title-' + counter;
    dialog.setAttribute('aria-labelledby', titleId);
    var form = document.createElement('form');
    form.noValidate = true;
    form.innerHTML = '<h2 id="' + titleId + '">' + K.escape(options.title) + '</h2><div class="dialog-error" role="alert"></div>';
    var errorBox = form.querySelector('.dialog-error');
    var fields = document.createElement('div');
    fields.style.display = 'grid';
    fields.style.gap = '16px';
    form.appendChild(fields);
    var actions = document.createElement('div');
    actions.className = 'btn-row';
    actions.innerHTML = '<button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + K.escape(options.submitLabel) + '</button>';
    form.appendChild(actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    if (options.build) { options.build(fields, form); }

    var opener = options.opener || document.activeElement;
    var closed = false;
    var submitting = false;
    var primary = actions.querySelector('.btn-primary');

    var api = {
      form: form,
      fields: fields,
      close: function () {
        if (closed) { return; }
        closed = true;
        dialog.close();
        dialog.remove();
        if (opener && document.contains(opener)) { opener.focus(); }
      },
      fail: function (text) { errorBox.textContent = text; }
    };

    actions.querySelector('[data-cancel]').addEventListener('click', api.close);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); api.close(); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); api.close(); return; }
      if (event.key !== 'Tab') { return; }
      var list = focusables(dialog);
      if (!list.length) { event.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1], active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submitting) { return; }
      submitting = true;
      errorBox.textContent = '';
      K.busy(primary, true);
      Promise.resolve(options.onSubmit(form, api)).catch(function () {
        api.fail('That did not work. Try again.');
      }).then(function () {
        submitting = false;
        K.busy(primary, false);
      });
    });

    dialog.showModal();
    var first = focusables(dialog)[0];
    if (first) { first.focus(); }
    return api;
  };

  /* labelled field builders shared by the row and view dialogs */
  K.field = function (label, control, hint) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    counter += 1;
    var id = 'field-' + counter;
    control.id = id;
    var lab = document.createElement('label');
    lab.setAttribute('for', id);
    lab.textContent = label;
    wrap.appendChild(lab);
    wrap.appendChild(control);
    if (hint) { var p = document.createElement('p'); p.className = 'hint'; p.textContent = hint; wrap.appendChild(p); }
    return wrap;
  };
  K.input = function (type, extra) {
    var el = document.createElement('input');
    el.type = type;
    el.className = 'input';
    el.autocomplete = 'off';
    Object.keys(extra || {}).forEach(function (key) { el.setAttribute(key, extra[key]); });
    return el;
  };
  K.select = function (values, selected, blank) {
    var el = document.createElement('select');
    el.className = 'select';
    if (blank !== undefined) { el.appendChild(new Option(blank, '')); }
    values.forEach(function (v) { el.appendChild(new Option(v, v, false, v === selected)); });
    return el;
  };
})();
