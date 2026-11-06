/* The owner console. Every decision about access is made by the server. */
(function () {
  'use strict';

  var TOKEN_KEY = 'ivo-studio-token';
  var token = window.sessionStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.replace('/studio/login');
    return;
  }

  var feedback = window.ivoFeedback;
  var statusRegion = document.querySelector('[data-studio-status]');
  var errorsRegion = document.querySelector('[data-studio-errors]');
  var caseRows = document.querySelector('[data-case-rows]');
  var inquiryRows = document.querySelector('[data-inquiry-rows]');
  var editor = document.querySelector('[data-case-editor]');
  var slugInput = editor.querySelector('[data-slug-input]');
  var slugReadonly = editor.querySelector('[data-slug-readonly]');
  var saveButton = editor.querySelector('[data-save-case]');

  /* The editable fields are the editor's own fields: the server owns the list
     and the form is its rendering, so nothing is restated here. */
  var EDITABLE = Array.prototype.map
    .call(editor.querySelectorAll('[name]'), function (node) {
      return node.name;
    })
    .filter(function (name) {
      return name !== 'slug';
    });

  var DISCIPLINE_LABELS = {
    'ui-ux': 'UI/UX',
    '3d-web': '3D WEB',
    frontend: 'FRONTEND'
  };
  var PROJECT_LABELS = {
    'ui-ux': 'UI/UX',
    '3d-web': '3D WEB',
    frontend: 'FRONTEND',
    other: 'OTHER'
  };
  var OUTAGE = 'That change could not be saved. Try again in a minute.';
  var SIGNED_OUT = {};

  var editing = null;
  var receivedFormat = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  function leave() {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.location.replace('/studio/login');
  }

  function request(method, path, payload) {
    var options = {
      method: method,
      headers: { Authorization: 'Bearer ' + token }
    };
    if (payload !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    return window.fetch(path, options).then(function (response) {
      if (response.status === 401) {
        leave();
        throw SIGNED_OUT;
      }
      if (response.status === 204) {
        return { status: 204, body: null };
      }
      return response.json().then(function (body) {
        return { status: response.status, body: body };
      });
    });
  }

  function announce(message) {
    feedback.reason(errorsRegion, '');
    statusRegion.textContent = message;
  }

  function refuse(answer) {
    statusRegion.textContent = '';
    if (answer.status === 422 && answer.body.errors) {
      feedback.fieldMessages(editor, answer.body.errors);
      feedback.reason(errorsRegion, feedback.FIELD_ERRORS);
      return;
    }
    feedback.reason(errorsRegion, answer.body.error);
  }

  function stumble(error) {
    if (error === SIGNED_OUT) {
      return;
    }
    statusRegion.textContent = '';
    feedback.reason(errorsRegion, OUTAGE);
  }

  /* ------------------------------------------------------------- rendering */

  function cell(row, label, text) {
    var node = document.createElement('td');
    node.dataset.label = label;
    node.textContent = text;
    row.appendChild(node);
    return node;
  }

  function actionButton(verb, subject, run) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'button-quiet';
    button.appendChild(document.createTextNode(verb));
    var completion = document.createElement('span');
    completion.className = 'sr-only';
    completion.textContent = ' ' + subject;
    button.appendChild(completion);
    button.addEventListener('click', function () {
      button.disabled = true;
      run();
    });
    return button;
  }

  function renderCases(rows) {
    caseRows.textContent = '';
    rows.forEach(function (row) {
      var line = document.createElement('tr');
      cell(line, 'Title', row.title);
      cell(line, 'Slug', row.slug);
      cell(line, 'Discipline', DISCIPLINE_LABELS[row.discipline]);
      cell(line, 'State', row.published ? 'Published' : 'Draft');
      cell(line, 'Featured', row.featured ? 'Yes' : 'No');
      cell(line, 'Position', String(row.position));
      var actions = cell(line, 'Actions', '');
      actions.appendChild(
        actionButton('Edit', row.title, function () {
          loadEditor(row);
          refreshCases();
        })
      );
      actions.appendChild(
        row.published
          ? actionButton('Unpublish', row.title, function () {
              setPublished(row, false);
            })
          : actionButton('Publish', row.title, function () {
              setPublished(row, true);
            })
      );
      actions.appendChild(
        actionButton('Delete', row.title, function () {
          removeCase(row);
        })
      );
      caseRows.appendChild(line);
    });
  }

  function renderInquiries(rows) {
    inquiryRows.textContent = '';
    rows.forEach(function (row) {
      var line = document.createElement('tr');
      cell(line, 'Name', row.name);
      cell(line, 'Email', row.email);
      cell(line, 'Phone', row.phone);
      cell(line, 'Project type', row.project_type ? PROJECT_LABELS[row.project_type] : '—');
      cell(line, 'Message', row.message);
      cell(line, 'Received', receivedFormat.format(new Date(row.received_at)));
      cell(line, 'Status', row.status === 'resolved' ? 'Resolved' : 'New');
      var actions = cell(line, 'Actions', '');
      if (row.status === 'new') {
        actions.appendChild(
          actionButton('Mark resolved', row.name, function () {
            resolveInquiry(row);
          })
        );
      }
      inquiryRows.appendChild(line);
    });
  }

  function refreshCases() {
    return request('GET', '/api/studio/cases').then(function (answer) {
      renderCases(answer.body);
    });
  }

  function refreshInquiries() {
    return request('GET', '/api/studio/inquiries').then(function (answer) {
      renderInquiries(answer.body);
    });
  }

  /* ---------------------------------------------------------------- editor */

  function control(name) {
    return editor.querySelector('[name="' + name + '"]');
  }

  function typedValue(name) {
    var node = control(name);
    if (node.type === 'checkbox') {
      return node.checked;
    }
    if (node.type === 'number') {
      return node.value.trim() === '' ? undefined : Number(node.value);
    }
    return node.value;
  }

  function createMode() {
    editing = null;
    editor.reset();
    feedback.clear(editor);
    feedback.reason(errorsRegion, '');
    slugInput.hidden = false;
    slugReadonly.hidden = true;
    slugReadonly.textContent = '';
    saveButton.textContent = 'Save draft';
  }

  function loadEditor(row) {
    editing = row;
    feedback.clear(editor);
    EDITABLE.forEach(function (name) {
      var node = control(name);
      if (node.type === 'checkbox') {
        node.checked = row[name];
      } else {
        node.value = row[name];
      }
    });
    slugInput.hidden = true;
    slugInput.value = row.slug;
    slugReadonly.hidden = false;
    slugReadonly.textContent = row.slug;
    saveButton.textContent = 'Save';
  }

  function changedFields() {
    var payload = {};
    EDITABLE.forEach(function (name) {
      var value = typedValue(name);
      if (value !== undefined && value !== editing[name]) {
        payload[name] = value;
      }
    });
    return payload;
  }

  function newFields() {
    var payload = { slug: slugInput.value };
    EDITABLE.forEach(function (name) {
      var value = typedValue(name);
      if (value !== undefined) {
        payload[name] = value;
      }
    });
    return payload;
  }

  editor.addEventListener('submit', function (event) {
    event.preventDefault();
    feedback.clear(editor);
    saveButton.disabled = true;
    var creating = editing === null;
    var path = creating ? '/api/studio/cases' : '/api/studio/cases/' + editing.id;
    request(creating ? 'POST' : 'PATCH', path, creating ? newFields() : changedFields())
      .then(function (answer) {
        saveButton.disabled = false;
        if (answer.status === 200 || answer.status === 201) {
          announce(creating ? 'Draft created.' : 'Saved.');
          createMode();
          return refreshCases();
        }
        refuse(answer);
      })
      .catch(function (error) {
        saveButton.disabled = false;
        stumble(error);
      });
  });

  document.querySelector('[data-create-draft]').addEventListener('click', function () {
    createMode();
    control('title').focus();
  });

  /* --------------------------------------------------------------- actions */

  function setPublished(row, published) {
    request('POST', '/api/studio/cases/' + row.id + '/publish', {
      published: published
    })
      .then(function (answer) {
        if (answer.status === 200) {
          announce(published ? 'Published.' : 'Unpublished.');
        } else {
          refuse(answer);
        }
        return refreshCases();
      })
      .catch(stumble);
  }

  function removeCase(row) {
    request('DELETE', '/api/studio/cases/' + row.id)
      .then(function (answer) {
        if (answer.status === 204) {
          announce('Deleted.');
          if (editing && editing.id === row.id) {
            createMode();
          }
        } else {
          refuse(answer);
        }
        return refreshCases();
      })
      .catch(stumble);
  }

  function resolveInquiry(row) {
    request('POST', '/api/studio/inquiries/' + row.id + '/resolve')
      .then(function (answer) {
        if (answer.status === 200) {
          announce('Marked resolved.');
        } else {
          refuse(answer);
        }
        return refreshInquiries();
      })
      .catch(stumble);
  }

  document.querySelector('[data-sign-out]').addEventListener('click', function () {
    request('POST', '/api/auth/logout')
      .then(leave)
      .catch(stumble);
  });

  /* ----------------------------------------------------------------- start */

  createMode();
  Promise.all([refreshCases(), refreshInquiries()]).catch(stumble);
})();
