/* Account pages: log in, create an account, confirm an email, settings. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var nextRaw = new URLSearchParams(location.search).get('next');
  var tail = nextRaw === null ? '' : '?next=' + Hub.nextParam(nextRaw);
  var TIER_NAMES = { free: 'Free', basic: 'Basic', max: 'Max' };

  /* ---------- log in ---------- */
  if ($('login-form')) {
    $('login-switch').setAttribute('href', '/register' + tail);
    if (Hub.token()) { location.replace(Hub.followNext(nextRaw)); return; }
    var loginAlert = $('login-alert');
    var loginButton = $('login-submit');
    if (Hub.ended()) loginAlert.textContent = 'Your session has ended. Log in again.';
    $('login-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (loginButton.disabled) return;
      loginButton.disabled = true;
      loginButton.textContent = 'Logging in…';
      var finish = function (text) {
        loginButton.disabled = false;
        loginButton.textContent = 'Log in';
        loginAlert.textContent = text;
        $('login-password').value = '';
      };
      Hub.api('POST', '/api/auth/login', { body: { email: $('login-email').value.trim(), password: $('login-password').value }, anonymous: true })
        .then(function (result) {
          if (result.ok) {
            Hub.setSession(result.data.access_token, result.data.user);
            location.replace(Hub.followNext(nextRaw));
          } else if (result.status === 401) finish('That email and password do not match.');
          else if (result.status === 429) finish('Too many sign-in attempts. Try again later.');
          else finish('Something went wrong. Try again.');
        }).catch(function () { finish('Something went wrong. Try again.'); });
    });
  }

  /* ---------- create an account ---------- */
  if ($('register-form')) {
    $('register-switch').setAttribute('href', '/login' + tail);
    if (Hub.token()) { location.replace(Hub.followNext(nextRaw)); return; }
    var CONTROL = /[\u0000-\u001f\u007f]/;
    var MESSAGES = {
      email: 'Enter a valid email address.',
      emailTaken: 'That email is already registered.',
      display_name: 'Display name must be 1 to 32 characters, with no line breaks or control characters.',
      username: 'Username must be 2 to 32 lowercase letters, digits, underscores or periods.',
      usernameTaken: 'That username is taken.',
      password: 'Password must be 8 to 128 characters.',
      date_of_birth: 'You must be at least 13 years old.'
    };
    var fields = [
      { name: 'email', id: 'reg-email', ok: function (v) { return Hub.validEmail(v); } },
      { name: 'display_name', id: 'reg-display', ok: function (v) {
        var name = v.trim().normalize('NFC');
        var n = Array.from(name).length;
        return n >= 1 && n <= 32 && !CONTROL.test(name);
      } },
      { name: 'username', id: 'reg-username', ok: function (v) { return /^[a-z0-9_.]{2,32}$/.test(v); } },
      { name: 'password', id: 'reg-password', ok: function (v) { var n = Array.from(v).length; return n >= 8 && n <= 128; } },
      { name: 'date_of_birth', id: 'reg-dob', ok: function (v) { return adult(v); } }
    ];
    var byName = {};
    fields.forEach(function (f) { f.input = $(f.id); f.error = $(f.id + '-error'); byName[f.name] = f; });
    var summary = $('register-alert');
    var registerButton = $('register-submit');

    /* The person turned 13 on or before today's UTC date; 29 February counts as 1 March in other years. */
    var adult = function (value) {
      var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!parts) return false;
      var y = Number(parts[1]), m = Number(parts[2]), d = Number(parts[3]);
      var born = new Date(Date.UTC(y, m - 1, d));
      if (born.getUTCFullYear() !== y || born.getUTCMonth() !== m - 1 || born.getUTCDate() !== d) return false;
      var now = new Date(Date.now());
      var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (born.getTime() >= today) return false;
      var leap = function (yr) { return (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0; };
      var turned = (m === 2 && d === 29 && !leap(y + 13)) ? Date.UTC(y + 13, 2, 1) : Date.UTC(y + 13, m - 1, d);
      return turned <= today;
    };

    var show = function (problems) {
      fields.forEach(function (f) {
        var text = problems[f.name];
        f.input.setAttribute('aria-invalid', text ? 'true' : 'false');
        f.error.textContent = text || '';
        f.error.hidden = !text;
      });
      summary.textContent = '';
      var failing = fields.filter(function (f) { return problems[f.name]; });
      if (!failing.length) return;
      var head = document.createElement('p');
      head.textContent = failing.length === 1 ? 'Fix 1 field to continue.' : 'Fix ' + failing.length + ' fields to continue.';
      var list = document.createElement('ul');
      failing.forEach(function (f) {
        var item = document.createElement('li');
        var link = document.createElement('a');
        link.href = '#' + f.id;
        link.textContent = problems[f.name];
        link.addEventListener('click', function (event) { event.preventDefault(); f.input.focus(); });
        item.appendChild(link);
        list.appendChild(item);
      });
      summary.appendChild(head);
      summary.appendChild(list);
      failing[0].input.focus();
    };

    $('register-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (registerButton.disabled) return;
      var problems = {};
      fields.forEach(function (f) { if (!f.ok(f.input.value)) problems[f.name] = MESSAGES[f.name]; });
      show(problems);
      if (Object.keys(problems).length) return;
      registerButton.disabled = true;
      registerButton.textContent = 'Creating account…';
      var restore = function () { registerButton.disabled = false; registerButton.textContent = 'Create an account'; };
      var general = function () {
        restore();
        show({});
        summary.textContent = 'Something went wrong. Try again.';
      };
      Hub.api('POST', '/api/auth/signup', { anonymous: true, body: {
        email: $('reg-email').value, display_name: $('reg-display').value, username: $('reg-username').value,
        password: $('reg-password').value, date_of_birth: $('reg-dob').value } })
        .then(function (result) {
          if (result.status === 201) {
            Hub.setSession(result.data.access_token, result.data.user);
            location.replace(Hub.followNext(nextRaw));
            return;
          }
          var failure = result.data && result.data.error;
          var refused = {};
          if (result.status === 409 && failure && failure.field === 'email') refused.email = MESSAGES.emailTaken;
          else if (result.status === 409 && failure && failure.field === 'username') refused.username = MESSAGES.usernameTaken;
          else if (result.status === 422 && failure && byName[failure.field]) refused[failure.field] = MESSAGES[failure.field];
          if (!Object.keys(refused).length) { general(); return; }
          restore();
          $('reg-password').value = '';
          show(refused);
        }).catch(general);
    });
  }

  /* ---------- confirm an email ---------- */
  if ($('verify-status')) {
    var line = $('verify-status');
    var token = new URLSearchParams(location.search).get('token');
    if (!token) {
      line.textContent = 'This confirmation link is no longer valid.';
    } else {
      history.replaceState(null, '', '/verify-email');
      line.textContent = 'Confirming your email…';
      Hub.api('POST', '/api/auth/verify-email', { body: { token: token }, anonymous: true }).then(function (result) {
        if (result.ok) {
          line.textContent = 'Your email is confirmed.';
          var user = Hub.user();
          if (user) { user.email_verified = true; Hub.setSession(Hub.token(), user); }
        } else if (result.status === 422) line.textContent = 'This confirmation link is no longer valid.';
        else line.textContent = 'Something went wrong. Try again.';
      }).catch(function () { line.textContent = 'Something went wrong. Try again.'; });
    }
  }

  /* ---------- settings ---------- */
  if ($('settings-logout')) {
    if (!Hub.requireSession()) return;
    var select = $('settings-status');
    var note = $('settings-note');
    var show_ = function (user) {
      $('settings-email').textContent = 'Signed in as ' + user.email;
      $('settings-tier').textContent = 'Current tier: ' + TIER_NAMES[user.tier];
      select.value = user.status;
    };
    var cached = Hub.user();
    if (cached) show_(cached);
    Hub.api('GET', '/api/users/@me').then(function (result) {
      if (result.ok) { Hub.setSession(Hub.token(), result.data); show_(result.data); }
    });
    select.addEventListener('change', function () {
      Hub.api('PATCH', '/api/users/@me', { body: { status: select.value } }).then(function (result) {
        if (result.ok) { Hub.setSession(Hub.token(), result.data); note.textContent = 'Status saved.'; }
        else note.textContent = 'Your status could not be saved.';
      }).catch(function () { note.textContent = 'Your status could not be saved.'; });
    });
    $('settings-logout').addEventListener('click', function () {
      var done = function () {
        Hub.clearSession();
        Hub.clearDrafts();
        location.replace('/login');
      };
      Hub.api('POST', '/api/auth/logout', { keepSession: true }).then(done, done);
    });
  }
})();
