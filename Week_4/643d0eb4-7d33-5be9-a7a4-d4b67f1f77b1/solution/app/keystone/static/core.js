/* Keystone Tables: shared behaviour. The header rule, the navigation drawer, the one announcement region,
   a fetch helper and sign out. */
(function () {
  'use strict';
  var K = (window.Keystone = window.Keystone || {});

  var header = document.getElementById('site-header');
  function rule() { header.classList.toggle('is-scrolled', window.scrollY > 0); }
  window.addEventListener('scroll', rule, { passive: true });
  rule();

  /* ---- navigation drawer ---------------------------------------------------------------------------------- */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');
  var backdrop = document.getElementById('nav-backdrop');
  var closeButton = document.getElementById('nav-close');
  var wide = window.matchMedia('(min-width: 800px)');

  function navFocusables() {
    return Array.prototype.filter.call(nav.querySelectorAll('a[href], button'), function (el) {
      return !el.disabled && el.getClientRects().length > 0;
    });
  }
  function openNav() {
    nav.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    var first = navFocusables()[0];
    if (first) { first.focus(); }
  }
  function closeNav(restore) {
    nav.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (restore) { toggle.focus(); }
  }
  toggle.addEventListener('click', function () {
    if (toggle.getAttribute('aria-expanded') === 'true') { closeNav(true); } else { openNav(); }
  });
  closeButton.addEventListener('click', function () { closeNav(true); });
  backdrop.addEventListener('click', function () { closeNav(true); });
  document.addEventListener('keydown', function (event) {
    if (toggle.getAttribute('aria-expanded') !== 'true') { return; }
    if (event.key === 'Escape') { event.preventDefault(); closeNav(true); return; }
    if (event.key !== 'Tab') { return; }
    var list = navFocusables();
    if (!list.length) { return; }
    var first = list[0], last = list[list.length - 1], active = document.activeElement;
    if (!nav.contains(active)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });
  function onResize() { if (wide.matches) { closeNav(false); } }
  if (wide.addEventListener) { wide.addEventListener('change', onResize); }

  /* ---- the Workspace updates region: one sentence at a time, each timer belongs to its own notice --------------- */
  var region = document.getElementById('updates');
  var token = 0;
  var timer = null;
  K.announce = function (text, options) {
    if (!region) { return; }
    var kind = (options && options.kind) || 'info';
    var ms = (options && options.ms) || 0;
    window.clearTimeout(timer);
    var mine = ++token;
    region.setAttribute('data-kind', kind);
    region.style.animation = 'none';
    void region.offsetWidth;
    region.style.animation = '';
    region.textContent = text;
    if (K.onRefusal) { K.onRefusal(kind === 'refuse'); }
    if (ms) {
      timer = window.setTimeout(function () {
        if (mine !== token) { return; }
        region.textContent = '';
        region.removeAttribute('data-kind');
        if (K.onRefusal) { K.onRefusal(false); }
      }, ms);
    }
  };

  /* ---- fetch helper --------------------------------------------------------------------------------------- */
  K.api = function (path, options) {
    options = options || {};
    var init = { method: options.method || 'GET', credentials: 'same-origin', headers: Object.assign({}, options.headers) };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data, headers: res.headers };
      });
    }, function () {
      return { ok: false, status: 0, data: { reason: 'The server could not be reached', field: null }, headers: new Headers() };
    });
  };
  K.reason = function (res, fallback) {
    var text = (res.data && res.data.reason) || fallback || 'The request was refused';
    return String(text).replace(/\.+$/, '');
  };
  K.escape = function (value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  K.busy = function (button, on) {
    if (!button) { return; }
    if (on) { button.setAttribute('aria-busy', 'true'); button.setAttribute('aria-disabled', 'true'); }
    else { button.removeAttribute('aria-busy'); button.removeAttribute('aria-disabled'); }
  };

  /* ---- sign out ----------------------------------------------------------------------------------------------- */
  var out = document.getElementById('sign-out');
  if (out) {
    out.addEventListener('click', function () {
      K.busy(out, true);
      var landing = '/?signed_out=1';
      K.api('/api/auth/logout', { method: 'POST' }).then(function () {
        return fetch(landing, { credentials: 'same-origin' }).then(function (res) {
          if (!res.ok) { throw new Error('landing'); }
          return res.text();
        });
      }).then(function (html) {
        /* The landing page arrives in place: one document, its address set to the landing page, so the reader
           reaches it the moment the session has ended without a second page load. */
        var next = new DOMParser().parseFromString(html, 'text/html');
        document.title = next.title;
        var scripts = Array.prototype.slice.call(next.body.querySelectorAll('script'));
        scripts.forEach(function (s) { s.parentNode.removeChild(s); });
        document.body.replaceWith(document.adoptNode(next.body));
        window.history.replaceState(null, '', landing);
        window.scrollTo(0, 0);
        window.addEventListener('popstate', function () { window.location.reload(); });
        scripts.forEach(function (old) {
          var s = document.createElement('script');
          if (old.src) { s.src = old.src; } else { s.textContent = old.textContent; }
          document.body.appendChild(s);
        });
        var main = document.getElementById('main');
        if (main) { main.focus({ preventScroll: true }); }
      }).catch(function () { window.location.assign(landing); });
    });
  }
})();
