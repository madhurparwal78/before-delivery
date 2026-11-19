/* window.Hub: session, API access, server clock and return-path rules shared by every page. */
(function () {
  'use strict';
  var KEY = { token: 'hub.token', user: 'hub.user', ended: 'hub.ended', last: 'hub.last' };
  var DRAFT = /^hub\.draft\.(\d+)\./;
  var skew = 0;

  function read(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
    } catch (e) { /* storage unavailable: the session simply does not persist */ }
  }

  var Hub = {
    token: function () { return read(KEY.token); },
    user: function () {
      var raw = read(KEY.user);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    setSession: function (token, user) {
      write(KEY.token, token);
      write(KEY.user, JSON.stringify(user));
      Hub.onSignedIn(user);
    },
    clearSession: function () {
      write(KEY.token, null);
      write(KEY.user, null);
    },
    onSignedIn: function (user) {
      write(KEY.ended, null);
      var keys = [];
      for (var i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
      keys.forEach(function (key) {
        var found = DRAFT.exec(key);
        if (found && Number(found[1]) !== user.id) write(key, null);
      });
    },
    clearDrafts: function () {
      var keys = [];
      for (var i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
      keys.forEach(function (key) { if (DRAFT.test(key)) write(key, null); });
    },
    ended: function () { return read(KEY.ended) === '1'; },
    acknowledgeEnded: function () { write(KEY.ended, null); },
    lastChannel: function () { return read(KEY.last); },
    rememberChannel: function (path) { write(KEY.last, path); },
    nextParam: function (path) { return encodeURIComponent(path); },
    loginUrl: function (path) { return '/login?next=' + Hub.nextParam(path); },
    /* The decoded `next` is followed only as a same-origin path; anything else lands on /servers. */
    followNext: function (raw) {
      if (typeof raw !== 'string' || raw.length < 2) return '/servers';
      if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\' || raw.indexOf('\\') !== -1) return '/servers';
      if (/[\u0000-\u001f\u007f]/.test(raw)) return '/servers';
      return raw;
    },
    endSession: function () {
      Hub.clearSession();
      write(KEY.ended, '1');
      location.replace(Hub.loginUrl(location.pathname));
    },
    requireSession: function () {
      if (Hub.token()) return true;
      location.replace(Hub.loginUrl(location.pathname + location.search));
      return false;
    },
    serverNow: function () { return Date.now() + skew; },
    api: function (method, path, options) {
      options = options || {};
      var headers = Object.assign({}, options.headers || {});
      var token = Hub.token();
      if (token && !options.anonymous) headers.Authorization = 'Bearer ' + token;
      var url = path;
      if (options.query) {
        var params = new URLSearchParams();
        Object.keys(options.query).forEach(function (name) {
          var value = options.query[name];
          if (value !== undefined && value !== null && value !== '') params.append(name, String(value));
        });
        var text = params.toString();
        if (text) url += (url.indexOf('?') === -1 ? '?' : '&') + text;
      }
      var init = { method: method, headers: headers, signal: options.signal, credentials: 'same-origin' };
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      } else if (options.formData) {
        init.body = options.formData;
      }
      return fetch(url, init).then(function (response) {
        var stamp = Date.parse(response.headers.get('Date') || '');
        if (!isNaN(stamp)) skew = stamp - Date.now();
        var type = response.headers.get('Content-Type') || '';
        var parsing = type.indexOf('json') !== -1 ? response.json().catch(function () { return null; }) : Promise.resolve(null);
        return parsing.then(function (data) {
          var result = { status: response.status, ok: response.ok, data: data, headers: response.headers };
          if (response.status === 401 && token && !options.anonymous && !options.keepSession) Hub.endSession();
          return result;
        });
      });
    }
  };
  /* The account email rule, shared by sign-up and support: 254 characters at most, a local part, one at sign,
     a domain of two or more non-empty labels, no whitespace or control characters. */
  Hub.validEmail = function (value) {
    if (typeof value !== 'string' || value.length > 254 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
    var parts = value.split('@');
    if (parts.length !== 2 || parts[0] === '') return false;
    var labels = parts[1].split('.');
    return labels.length >= 2 && labels.every(function (label) { return label !== ''; });
  };
  window.Hub = Hub;
})();
