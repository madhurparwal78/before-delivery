/* Gigfreight desk behaviour. htmx makes the requests and swaps the server's
   fragments; this file adds what only the page can do: busy controls, the
   Reduce motion switch, the menu, the discard dialog, the timeline's failure state,
   focus after Show more requests and the outage notice. */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var lastPressed = null;

  function notices() { return document.getElementById('notices'); }

  // An outage answer carries no fragment, only the server's sentence.
  function say(text) {
    var region = notices();
    if (!region) return;
    var line = document.createElement('p');
    line.className = 'notice notice-problem';
    line.textContent = text;
    region.replaceChildren(line);
  }

  // The control a write was started from: the pressed submit button of a form,
  // or the button that carries the request itself.
  document.addEventListener('click', function (evt) {
    lastPressed = evt.target.closest ? evt.target.closest('button') : null;
  }, true);

  function pressedButton(elt) {
    if (elt.tagName === 'BUTTON') return elt;
    if (elt.tagName === 'FORM' && lastPressed && lastPressed.form === elt) return lastPressed;
    return elt.tagName === 'FORM' ? elt.querySelector('button[type="submit"]') : null;
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    var text = button.getAttribute('data-busy');
    if (!text) return;
    if (busy) {
      button.setAttribute('data-idle', button.innerHTML);
      button.textContent = text;
    } else if (button.hasAttribute('data-idle')) {
      button.innerHTML = button.getAttribute('data-idle');
      button.removeAttribute('data-idle');
    }
  }

  body.addEventListener('htmx:configRequest', function (evt) {
    // An empty search or status leaves the address bare.
    var form = evt.detail.elt.closest && evt.detail.elt.closest('form[data-drop-empty]');
    if (form && evt.detail.verb === 'get') {
      ['q', 'status'].forEach(function (key) {
        if (evt.detail.parameters.get(key) === '') evt.detail.parameters.delete(key);
      });
    }
  });

  body.addEventListener('htmx:beforeRequest', function (evt) {
    var elt = evt.detail.elt;
    var target = evt.detail.target;
    if (target) target.setAttribute('aria-busy', 'true');
    if (elt.id === 'activity') {
      elt.replaceChildren(spinner());
      return;
    }
    var button = pressedButton(elt);
    if (button && (evt.detail.requestConfig.verb !== 'get' || elt === button)) {
      setBusy(button, true);
      evt.detail.xhr.pressed = button;
    }
  });

  body.addEventListener('htmx:afterRequest', function (evt) {
    var target = evt.detail.target;
    if (target && target.isConnected) target.setAttribute('aria-busy', 'false');
    var button = evt.detail.xhr.pressed;
    if (button && button.isConnected && !evt.detail.xhr.getResponseHeader('HX-Redirect')) setBusy(button, false);
    var elt = evt.detail.elt;
    var failed = !evt.detail.xhr.status || evt.detail.xhr.status >= 400;
    if (elt.id === 'activity' && failed) timelineFailed(elt);
    if (evt.detail.xhr.status >= 500) say(evt.detail.xhr.responseText);
  });

  body.addEventListener('htmx:sendError', function (evt) {
    if (evt.detail.elt.id === 'activity') timelineFailed(evt.detail.elt);
  });

  body.addEventListener('htmx:afterSettle', function () {
    // After Show more requests, focus moves to the first appended row.
    var first = document.querySelector('[data-focus-first]');
    if (first) {
      first.removeAttribute('data-focus-first');
      first.focus();
    }
    // After a refused step, focus moves to the first field that needs attention.
    var invalid = document.querySelector('#step-form [aria-invalid="true"]');
    if (invalid && document.activeElement === body) invalid.focus();
  });

  function spinner() {
    var line = document.createElement('p');
    line.className = 'loading';
    line.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Loading activity</span>';
    return line;
  }

  function timelineFailed(box) {
    box.setAttribute('aria-busy', 'false');
    var wrap = document.createElement('div');
    wrap.className = 'timeline-failure';
    wrap.innerHTML = '<p>Could not load activity. Try again.</p>' +
      '<button type="button" class="btn btn-secondary btn-small" data-retry-activity>Try again</button>';
    box.replaceChildren(wrap);
  }

  // Plain sign-in form: the button is disabled and busy while the post is pending.
  document.addEventListener('submit', function (evt) {
    var form = evt.target;
    if (!form.matches('form[method="post"]:not([hx-post])')) return;
    var button = form.querySelector('button[type="submit"]');
    if (button) setTimeout(function () { setBusy(button, true); }, 0);
  });

  function toggleMenu(button, open) {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.classList.toggle('menu-open', open);
    if (open) {
      var link = document.querySelector('#site-nav a');
      if (link) link.focus();
    } else {
      button.focus();
    }
  }

  document.addEventListener('click', function (evt) {
    var el = evt.target.closest ? evt.target.closest('button') : null;
    if (!el) return;

    if (el.hasAttribute('data-retry-activity')) {
      window.htmx.trigger(document.getElementById('activity'), 'retry');
    } else if (el.hasAttribute('data-reduce-motion')) {
      var on = el.getAttribute('aria-pressed') !== 'true';
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      root.classList.toggle('reduce-motion', on);
      document.cookie = 'gf_motion=' + (on ? 'reduce' : 'full') + '; Path=/; Max-Age=31536000; SameSite=Strict';
    } else if (el.hasAttribute('data-menu')) {
      toggleMenu(el, el.getAttribute('aria-expanded') !== 'true');
    } else if (el.hasAttribute('data-clear-search')) {
      var q = document.getElementById('q');
      q.value = '';
      q.dispatchEvent(new Event('search', { bubbles: true }));
      q.focus();
    } else if (el.hasAttribute('data-step')) {
      var input = document.getElementById(el.getAttribute('aria-controls'));
      var value = Number.parseInt(input.value, 10) || 0;
      input.value = String(Math.min(8, Math.max(1, value + Number(el.getAttribute('data-step')))));
    } else if (el.hasAttribute('data-cancel')) {
      cancelStep(el);
    } else if (el.hasAttribute('data-close-dialog')) {
      el.closest('dialog').close();
    }
  });

  // Cancel on a typed step asks first; an untouched step simply leaves.
  function cancelStep(button) {
    var form = button.closest('form');
    var typed = form.getAttribute('data-typed') === 'true' ||
      Array.prototype.some.call(form.querySelectorAll('input:not([type="hidden"]), textarea'), function (f) {
        return f.type === 'radio' ? f.checked : f.value.trim() !== '';
      });
    if (!typed) {
      window.location.assign('/requests');
      return;
    }
    var dialog = document.getElementById('discard-dialog');
    dialog.returnFocusTo = button;
    dialog.showModal();
  }

  var discard = document.getElementById('discard-dialog');
  if (discard) {
    discard.addEventListener('close', function () {
      if (discard.returnFocusTo && discard.returnFocusTo.isConnected) discard.returnFocusTo.focus();
    });
  }

  // Escape folds the narrow-width menu and returns focus to Menu.
  document.addEventListener('keydown', function (evt) {
    if (evt.key !== 'Escape' || !body.classList.contains('menu-open')) return;
    toggleMenu(document.querySelector('[data-menu]'), false);
  });
}());
