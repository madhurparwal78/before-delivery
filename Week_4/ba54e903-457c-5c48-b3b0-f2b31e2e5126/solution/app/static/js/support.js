/* Support request form: browser checks, then the API. Status lines are replaced only by the next submit. */
(function () {
  'use strict';
  var form = document.getElementById('support-form');
  var status = document.getElementById('sp-status');
  var submit = document.getElementById('sp-submit');
  var fields = [
    { name: 'email', id: 'sp-email', message: 'Enter a valid email address.',
      ok: function (v) { return Hub.validEmail(v); } },
    { name: 'category', id: 'sp-category', message: 'Choose a category.', ok: function (v) { return v !== ''; } },
    { name: 'subject', id: 'sp-subject', message: 'Subject must be 3 to 120 characters.',
      ok: function (v) { var n = Array.from(v).length; return n >= 3 && n <= 120; } },
    { name: 'body', id: 'sp-body', message: 'Description must be 10 to 5000 characters.',
      ok: function (v) { var n = Array.from(v).length; return n >= 10 && n <= 5000; } }
  ];
  var byName = {};
  fields.forEach(function (f) { f.input = document.getElementById(f.id); f.error = document.getElementById(f.id + '-error'); byName[f.name] = f; });

  function mark(field, invalid) {
    field.input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    if (invalid) { field.error.textContent = field.message; field.error.hidden = false; }
    else { field.error.textContent = ''; field.error.hidden = true; }
  }
  function refuse(names) {
    fields.forEach(function (f) { mark(f, names.indexOf(f.name) !== -1); });
    var first = fields.filter(function (f) { return names.indexOf(f.name) !== -1; })[0];
    if (first) first.input.focus();
  }

  /* ArrowDown and ArrowUp step Category's option on every platform (macOS would open the list instead). */
  byName.category.input.addEventListener('keydown', function (event) {
    if (event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    var select = event.currentTarget;
    var next = select.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
    if (next < 0 || next >= select.options.length) return;
    select.selectedIndex = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (submit.disabled) return;
    var values = {};
    fields.forEach(function (f) { values[f.name] = f.name === 'email' ? f.input.value.trim() : f.input.value; });
    var bad = fields.filter(function (f) { return !f.ok(values[f.name]); }).map(function (f) { return f.name; });
    refuse(bad);
    if (bad.length) return;
    submit.disabled = true;
    status.textContent = 'Sending request…';
    Hub.api('POST', '/api/support/tickets', { body: values, anonymous: true }).then(function (result) {
      submit.disabled = false;
      if (result.status === 201) {
        status.textContent = 'Request received. Your reference is ' + result.data.reference + '.';
      } else if (result.status === 429) {
        status.textContent = 'Too many requests from this email. Try again later.';
      } else if (result.status === 422 && result.data && result.data.error && byName[result.data.error.field]) {
        status.textContent = '';
        refuse([result.data.error.field]);
      } else {
        status.textContent = 'Your request could not be sent. Try again.';
      }
    }).catch(function () {
      submit.disabled = false;
      status.textContent = 'Your request could not be sent. Try again.';
    });
  });
})();
