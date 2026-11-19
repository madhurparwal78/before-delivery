/* Console pages other than the table: access requests, snapshots and the steward administration console. */
(function () {
  'use strict';
  var K = window.Keystone;

  /* Replace the named regions of the page with their server-rendered versions, so lists show what the store holds. */
  function refresh(selectors) {
    return fetch(window.location.pathname + window.location.search, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var fresh = new DOMParser().parseFromString(html, 'text/html');
        selectors.forEach(function (selector) {
          var from = fresh.querySelector(selector), to = document.querySelector(selector);
          if (from && to) { to.innerHTML = from.innerHTML; }
        });
      });
  }

  /* ---- access requests ------------------------------------------------------------------------------------------- */
  var raise = document.getElementById('raise-form');
  if (raise) {
    var raiseError = document.getElementById('raise-error');
    raise.addEventListener('submit', function (event) {
      event.preventDefault();
      raiseError.hidden = true;
      var button = document.getElementById('raise-send');
      K.busy(button, true);
      K.api('/api/requests', { method: 'POST', body: { department: raise.department.value, role: raise.role.value } }).then(function (res) {
        K.busy(button, false);
        if (!res.ok) { raiseError.textContent = K.reason(res) + '.'; raiseError.hidden = false; return; }
        window.location.assign('/console/requests');
      });
    });
  }
  var requestTable = document.getElementById('request-table');
  if (requestTable) {
    requestTable.addEventListener('click', function (event) {
      var button = event.target.closest('[data-decide]');
      if (!button || button.getAttribute('aria-disabled') === 'true') { return; }
      var id = button.getAttribute('data-decide');
      var department = button.getAttribute('data-department');
      var row = button.closest('tr');
      var decision = K.select(['approved', 'declined'], 'approved');
      var reason = K.input('text', { maxlength: '500' });
      K.openDialog({
        title: 'Decide request', opener: button, submitLabel: 'Record decision',
        build: function (fields) {
          fields.appendChild(K.field('Decision', decision));
          fields.appendChild(K.field('Reason', reason));
        },
        onSubmit: function (form, dialog) {
          return K.api('/api/requests/' + id + '/decision', { method: 'POST', body: { decision: decision.value, reason: reason.value } }).then(function (res) {
            if (!res.ok) { dialog.fail(K.reason(res) + '.'); return; }
            row.querySelector('.state').innerHTML = '<span class="badge">' + K.escape(res.data.state) + '</span>';
            row.querySelector('.reason').textContent = res.data.reason || '';
            button.setAttribute('aria-disabled', 'true');
            dialog.close();
            K.announce('Request ' + res.data.state + ' for ' + department + '.', { kind: res.data.state === 'approved' ? 'affirm' : 'info' });
          });
        }
      });
    });
  }

  /* ---- snapshots ----------------------------------------------------------------------------------------------------- */
  var publish = document.getElementById('open-publish');
  if (publish) {
    var boot = JSON.parse(document.getElementById('boot').textContent);
    var unavailable = function () {
      var found = {};
      document.querySelectorAll('#snap-panels tbody tr').forEach(function (tr) {
        found[tr.getAttribute('data-period') + '|' + tr.children[2].textContent] = tr.getAttribute('aria-disabled') === 'true' ? tr : null;
      });
      return found;
    };
    publish.addEventListener('click', function () {
      var table = K.select(boot.tables, boot.tables[0]);
      var period = K.input('text', { maxlength: '64' });
      K.openDialog({
        title: 'Publish snapshot', opener: publish, submitLabel: 'Publish',
        build: function (fields) {
          fields.appendChild(K.field('Table', table));
          fields.appendChild(K.field('Period', period));
        },
        onSubmit: function (form, dialog) {
          var before = unavailable();
          return K.api('/api/snapshots', { method: 'POST', body: { table: table.value, period: period.value } }).then(function (res) {
            if (!res.ok) { dialog.fail(K.reason(res) + '.'); return; }
            dialog.close();
            K.announce('Snapshot published for ' + res.data.period + '.', { kind: 'info' });
            return refresh(['#snap-panels']).then(function () {
              var banner = document.getElementById('retention-banner');
              var now = unavailable();
              var pushed = Object.keys(now).filter(function (key) { return now[key] && !before[key]; });
              if (pushed.length) {
                var periods = pushed.map(function (key) { return now[key].getAttribute('data-period'); }).join(', ');
                banner.innerHTML = '<div class="row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/></svg><p>Retention applied: ' +
                  K.escape(periods) + ' is now unavailable on the ' + K.escape(res.data.tier) + ' tier.</p></div>';
                banner.hidden = false;
                banner.classList.remove('arriving');
                void banner.offsetWidth;
                banner.classList.add('arriving');
              }
            });
          });
        }
      });
    });
  }

  /* ---- administration --------------------------------------------------------------------------------------------------- */
  var grantForm = document.getElementById('grant-form');
  if (grantForm) {
    var grantError = document.getElementById('grant-error');
    grantForm.addEventListener('submit', function (event) {
      event.preventDefault();
      grantError.hidden = true;
      K.api('/api/admin/grants', { method: 'POST', body: { account: grantForm.account.value, role: grantForm.role.value } }).then(function (res) {
        if (!res.ok) { grantError.textContent = K.reason(res) + '.'; grantError.hidden = false; return; }
        K.announce('Grant created for ' + res.data.account + '.', { kind: 'affirm' });
        grantForm.reset();
        refresh(['#grant-table']);
      });
    });
    var revoke = document.getElementById('open-revoke');
    revoke.addEventListener('click', function () {
      var phrase = K.input('text');
      K.openDialog({
        title: 'Confirm bulk revoke', opener: revoke, submitLabel: 'Revoke',
        build: function (fields) {
          var note = document.createElement('p');
          note.textContent = 'This removes the selected role grants permanently. Type the confirmation phrase to continue.';
          fields.appendChild(note);
          fields.appendChild(K.field('Confirmation phrase', phrase));
        },
        onSubmit: function (form, dialog) {
          var ids = Array.prototype.map.call(document.querySelectorAll('.grant-pick:checked'), function (box) { return parseInt(box.value, 10); });
          return K.api('/api/admin/grants/revocations', { method: 'POST', body: { grants: ids, confirmation: phrase.value } }).then(function (res) {
            dialog.close();
            if (res.ok) {
              K.announce('Grants revoked: ' + res.data.revoked + '.', { kind: 'affirm' });
              return refresh(['#grant-table']);
            }
            var sentence = res.data && res.data.field === 'confirmation'
              ? 'Bulk revoke refused: the confirmation phrase does not match.'
              : 'Bulk revoke refused: ' + K.reason(res).replace(/^./, function (c) { return c.toLowerCase(); }) + '.';
            K.announce(sentence, { kind: 'refuse', ms: 8000 });
          });
        }
      });
    });
  }
})();
