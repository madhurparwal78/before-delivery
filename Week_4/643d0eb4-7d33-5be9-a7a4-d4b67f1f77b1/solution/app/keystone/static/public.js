/* Keystone Tables: the public pages. The plan toggle, the sales enquiry, the newsletter, sign in and sign up. */
(function () {
  'use strict';
  var K = window.Keystone;

  /* ---- plan toggle: changes the period word on every card and no number ------------------------------------ */
  var toggle = document.getElementById('period-toggle');
  if (toggle) {
    toggle.addEventListener('change', function (event) {
      var word = event.target.value === 'month' ? 'per month' : 'per year';
      document.querySelectorAll('.period').forEach(function (el) { el.textContent = word; });
    });
  }

  /* ---- shared inline field refusals -------------------------------------------------------------------------- */
  function clearErrors(form) {
    form.querySelectorAll('.error').forEach(function (el) { el.hidden = true; el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(function (el) {
      el.removeAttribute('aria-invalid');
      var keep = el.getAttribute('data-hint');
      if (keep) { el.setAttribute('aria-describedby', keep); } else { el.removeAttribute('aria-describedby'); }
    });
  }
  function showError(form, field, text) {
    var error = form.querySelector('#err-' + field);
    var control = form.querySelector('[name="' + field + '"]');
    if (!error || !control) { return false; }
    error.textContent = text;
    error.hidden = false;
    var hint = control.getAttribute('aria-describedby');
    if (hint && hint.indexOf(error.id) === -1) { control.setAttribute('data-hint', hint); }
    control.setAttribute('aria-describedby', ((control.getAttribute('data-hint') || '') + ' ' + error.id).trim());
    control.setAttribute('aria-invalid', 'true');
    control.focus();
    return true;
  }
  function post(url, body, asForm) {
    var init = { method: 'POST', credentials: 'same-origin', headers: {} };
    if (asForm) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(body).toString();
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data, headers: res.headers };
      });
    }, function () { return { ok: false, status: 0, data: { reason: 'The server could not be reached', field: null }, headers: new Headers() }; });
  }
  function submitWith(form, button, run) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (button.getAttribute('aria-busy') === 'true') { return; }
      clearErrors(form);
      K.busy(button, true);
      run().then(function () { K.busy(button, false); });
    });
  }

  /* ---- sales enquiry ----------------------------------------------------------------------------------------- */
  var enquiry = document.getElementById('enquiry-form');
  if (enquiry) {
    var status = document.getElementById('enquiry-status');
    submitWith(enquiry, document.getElementById('enquiry-send'), function () {
      status.hidden = true;
      return post('/api/enquiries', new FormData(enquiry), true).then(function (res) {
        if (res.ok) {
          status.textContent = res.data.confirmation;
          status.hidden = false;
          enquiry.reset();
        } else if (res.data && res.data.field && showError(enquiry, res.data.field, res.data.reason)) {
          return;
        } else {
          status.className = 'notice refuse';
          status.textContent = (res.data && res.data.reason) || 'The enquiry could not be sent.';
          status.hidden = false;
        }
      });
    });
  }

  /* ---- newsletter ---------------------------------------------------------------------------------------------- */
  var subscribe = document.getElementById('subscribe-form');
  if (subscribe) {
    var thanks = document.getElementById('subscribe-status');
    submitWith(subscribe, document.getElementById('subscribe-send'), function () {
      thanks.hidden = true;
      return post('/api/subscribers', new FormData(subscribe), true).then(function (res) {
        if (res.ok) {
          thanks.textContent = res.data.confirmation;
          thanks.hidden = false;
          subscribe.reset();
        } else if (!(res.data && res.data.field && showError(subscribe, res.data.field, res.data.reason))) {
          thanks.className = 'notice refuse';
          thanks.textContent = (res.data && res.data.reason) || 'The subscribe could not be recorded.';
          thanks.hidden = false;
        }
      });
    });
  }

  /* ---- sign in ------------------------------------------------------------------------------------------------- */
  var login = document.getElementById('login-form');
  if (login) {
    var failure = document.getElementById('login-error');
    submitWith(login, document.getElementById('login-send'), function () {
      failure.hidden = true;
      return post('/api/auth/login', { email: login.email.value, password: login.password.value }, false).then(function (res) {
        if (res.ok) { window.location.assign('/console/tables'); return; }
        var wait = res.headers.get('Retry-After');
        failure.textContent = res.status === 429
          ? 'Too many refused sign-in attempts. Try again in ' + wait + ' seconds.'
          : (res.data && res.data.reason) || 'Sign in failed.';
        failure.hidden = false;
      });
    });
  }

  /* ---- sign up ------------------------------------------------------------------------------------------------- */
  var signup = document.getElementById('signup-form');
  if (signup) {
    var made = document.getElementById('signup-status');
    submitWith(signup, document.getElementById('signup-send'), function () {
      made.hidden = true;
      var body = {};
      new FormData(signup).forEach(function (value, key) { body[key] = value; });
      return post('/api/auth/signup', body, false).then(function (res) {
        if (res.ok) {
          made.innerHTML = 'Account created for ' + K.escape(res.data.email) + '. <a href="/login">Sign in to continue</a>.';
          made.hidden = false;
          signup.reset();
        } else if (!(res.data && res.data.field && showError(signup, res.data.field, res.data.reason))) {
          made.className = 'notice refuse';
          made.textContent = (res.data && res.data.reason) || 'The account could not be created.';
          made.hidden = false;
        }
      });
    });
  }
})();
