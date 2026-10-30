/* Gigfreight Dispatch Desk - browser behaviour: draft, motion switch, menu, notices */
(function () {
  'use strict';

  var MOTION_KEY = 'gigfreight.reduce-motion';
  var DRAFT_KEY = 'gigfreight.draft';
  var TIMELINE_FAILED = 'Could not load activity. Try again.';
  var SAVING = 'Saving...';
  var LOADING_MORE = 'Loading more requests';
  var UNAVAILABLE = 'The desk cannot reach its records right now. Try again shortly.';

  function store() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function notices() {
    return document.getElementById('desk-notices');
  }

  function setNotice(text) {
    var region = notices();
    if (!region) return;
    region.innerHTML = '';
    if (!text) return;
    var line = document.createElement('p');
    line.className = 'notice';
    line.textContent = text;
    region.appendChild(line);
  }

  function setLabel(button, text) {
    var lines = button.querySelectorAll('.roll__line');
    if (lines.length === 0) {
      button.textContent = text;
      return;
    }
    for (var i = 0; i < lines.length; i += 1) lines[i].textContent = text;
  }

  /* ---------- reduce motion ---------- */

  function motionOn() {
    var storage = store();
    return storage ? storage.getItem(MOTION_KEY) === 'on' : false;
  }

  function paintMotion() {
    var on = motionOn();
    if (on) document.documentElement.setAttribute('data-reduce-motion', 'on');
    else document.documentElement.removeAttribute('data-reduce-motion');
    var buttons = document.querySelectorAll('[data-reduce-motion-toggle]');
    for (var i = 0; i < buttons.length; i += 1) buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ---------- the new request draft ---------- */

  function readDraft() {
    var storage = store();
    if (!storage) return {};
    try {
      return JSON.parse(storage.getItem(DRAFT_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeDraft(draft) {
    var storage = store();
    if (storage) storage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function clearDraft() {
    var storage = store();
    if (storage) storage.removeItem(DRAFT_KEY);
  }

  function readPath(source, path) {
    var parts = path.split('.');
    var value = source;
    for (var i = 0; i < parts.length; i += 1) {
      if (value === null || typeof value !== 'object') return '';
      value = value[parts[i]];
    }
    return value === undefined || value === null ? '' : String(value);
  }

  function writePath(target, path, value) {
    var parts = path.split('.');
    var node = target;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  function stepRoot() {
    return document.querySelector('[data-step]');
  }

  function hydrateDraft() {
    var root = stepRoot();
    if (!root) return;
    var draft = readDraft();
    var fields = root.querySelectorAll('[data-draft-field]');
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var value = readPath(draft, field.getAttribute('data-draft-field'));
      if (field.type === 'radio') field.checked = field.value === value;
      else if (field.value === '' && value !== '') field.value = value;
    }
    var views = root.querySelectorAll('[data-draft-view]');
    for (var j = 0; j < views.length; j += 1) {
      var view = views[j];
      var name = view.getAttribute('data-draft-view');
      var shown =
        name === 'transport_type_label'
          ? ({ tour: 'Tour', show: 'Show', show_freight: 'Show freight' }[readPath(draft, 'transport_type')] || '')
          : readPath(draft, name);
      if (view.textContent.trim() === '' || view.textContent.trim() === 'No date') {
        view.textContent = shown || (name.indexOf('.date') > -1 ? 'No date' : '');
      }
    }
  }

  function snapshotStep() {
    var root = stepRoot();
    if (!root) return null;
    var draft = readDraft();
    var fields = root.querySelectorAll('[data-draft-field]');
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var path = field.getAttribute('data-draft-field');
      if (field.type === 'radio') {
        if (field.checked) writePath(draft, path, field.value);
      } else {
        writePath(draft, path, field.value);
      }
    }
    writeDraft(draft);
    return draft;
  }

  function guardStep() {
    var root = stepRoot();
    if (!root) return;
    var step = root.getAttribute('data-step');
    var draft = readDraft();
    var valid = draft.valid || {};
    if ((step === 'stops' || step === 'review') && !valid.details) {
      window.location.replace('/requests/new');
      return;
    }
    if (step === 'review' && !valid.stops) window.location.replace('/requests/new/stops');
  }

  function invalidateStep(step) {
    var draft = readDraft();
    draft.valid = draft.valid || {};
    draft.valid[step === 'details' ? 'details' : 'stops'] = false;
    writeDraft(draft);
  }

  function markStepValid(step) {
    var draft = snapshotStep() || readDraft();
    draft.valid = draft.valid || {};
    if (step === 'details') {
      draft.valid.details = true;
      if (!draft.draft_id) {
        draft.draft_id =
          window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
                var random = (Math.random() * 16) | 0;
                var value = char === 'x' ? random : (random & 0x3) | 0x8;
                return value.toString(16);
              });
      }
    } else if (step === 'stops') {
      draft.valid.stops = true;
    }
    writeDraft(draft);
  }

  /* ---------- discard dialog ---------- */

  var cancelOpener = null;

  function typedAnything() {
    var root = stepRoot();
    if (!root) return false;
    var fields = root.querySelectorAll('[data-draft-field]');
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.type === 'radio' ? field.checked : String(field.value).trim() !== '') return true;
    }
    return false;
  }

  function openDiscardDialog(opener) {
    var dialog = document.getElementById('discard-dialog');
    if (!dialog) return;
    cancelOpener = opener;
    dialog.showModal();
    var keep = dialog.querySelector('[data-keep-editing="primary"]');
    if (keep) keep.focus();
  }

  function closeDiscardDialog() {
    var dialog = document.getElementById('discard-dialog');
    if (dialog && dialog.open) dialog.close();
  }

  /* ---------- requests list ---------- */

  function reflectFilters() {
    var search = document.getElementById('filter-q');
    var status = document.getElementById('filter-status');
    if (!search && !status) return;
    var params = new URLSearchParams();
    if (search && search.value.trim() !== '') params.set('q', search.value.trim());
    if (status && status.value !== '') params.set('status', status.value);
    var query = params.toString();
    window.history.replaceState(null, '', '/requests' + (query ? '?' + query : ''));
  }

  function focusFirstAppended() {
    var rows = document.querySelectorAll('#request-rows .row--appended');
    if (rows.length === 0) return;
    var first = rows[0];
    first.setAttribute('tabindex', '-1');
    first.focus();
    for (var i = 0; i < rows.length; i += 1) rows[i].classList.remove('row--appended');
  }

  /* ---------- timeline ---------- */

  function timelineFailure(slot) {
    slot.innerHTML = '';
    var line = document.createElement('p');
    line.className = 'refusal__line';
    line.textContent = TIMELINE_FAILED;
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--secondary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', function () {
      slot.innerHTML = '<p class="loading"><span class="ring" aria-hidden="true"></span>Loading activity</p>';
      if (window.htmx) window.htmx.trigger(slot, 'reload-activity');
    });
    slot.appendChild(line);
    slot.appendChild(retry);
    slot.setAttribute('hx-trigger', 'reload-activity');
    if (window.htmx) window.htmx.process(slot);
  }

  /* ---------- events ---------- */

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-reduce-motion-toggle]');
    if (toggle) {
      var storage = store();
      if (storage) storage.setItem(MOTION_KEY, motionOn() ? 'off' : 'on');
      paintMotion();
      return;
    }

    var menu = event.target.closest('[data-menu-button]');
    if (menu) {
      var shell = document.querySelector('.shell');
      var open = shell.getAttribute('data-menu') !== 'open';
      shell.setAttribute('data-menu', open ? 'open' : 'closed');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var link = document.querySelector('#desk-sidebar .nav__link');
        if (link) link.focus();
      }
      return;
    }

    var clear = event.target.closest('[data-clear-search]');
    if (clear) {
      var search = document.getElementById('filter-q');
      if (search) {
        search.value = '';
        search.focus();
        if (window.htmx) window.htmx.trigger(search, 'search');
      }
      return;
    }

    var back = event.target.closest('[data-step-back]');
    if (back) {
      snapshotStep();
      window.location.href = back.getAttribute('data-step-back');
      return;
    }

    var cancel = event.target.closest('[data-cancel-step]');
    if (cancel) {
      if (typedAnything()) openDiscardDialog(cancel);
      else window.location.href = '/requests';
      return;
    }

    if (event.target.closest('[data-keep-editing]')) {
      closeDiscardDialog();
      return;
    }

    if (event.target.closest('[data-discard]')) {
      clearDraft();
      closeDiscardDialog();
      window.location.href = '/requests';
      return;
    }

    var stepper = event.target.closest('[data-step-trucks]');
    if (stepper) {
      var trucks = document.getElementById('trucks-requested');
      var next = (Number.parseInt(trucks.value, 10) || 0) + Number(stepper.getAttribute('data-step-trucks'));
      trucks.value = String(Math.min(8, Math.max(1, next)));
      trucks.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (event.target.closest('[data-fleet-action]')) setNotice(SAVING);
  });

  function rememberTyping(event) {
    var fleetStatus = event.target.closest('[data-fleet-filter]');
    if (fleetStatus) {
      window.location.href = fleetStatus.value ? '/fleet?status=' + fleetStatus.value : '/fleet';
      return;
    }
    if (!event.target.closest('[data-draft-field]')) return;
    var root = stepRoot();
    snapshotStep();
    if (root) invalidateStep(root.getAttribute('data-step'));
  }

  document.addEventListener('change', rememberTyping);
  document.addEventListener('input', rememberTyping);

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var shell = document.querySelector('.shell');
    if (shell && shell.getAttribute('data-menu') === 'open') {
      shell.setAttribute('data-menu', 'closed');
      var button = document.querySelector('[data-menu-button]');
      if (button) {
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    }
  });

  document.addEventListener('htmx:configRequest', function (event) {
    var source = event.detail.elt;
    if (source.closest('[data-step-form]')) snapshotStep();
  });

  document.addEventListener('htmx:beforeRequest', function (event) {
    var source = event.detail.elt;
    if (source.hasAttribute('data-panel-action')) {
      source.setAttribute('aria-busy', 'true');
      setNotice(SAVING);
    }
    if (source.hasAttribute('data-role-save')) setNotice(SAVING);
    if (source.hasAttribute('data-show-more')) setLabel(source, LOADING_MORE);
    var signIn = source.querySelector('#signin-submit');
    if (signIn) signIn.setAttribute('aria-busy', 'true');
    if (event.detail.target.id === 'request-list') event.detail.target.setAttribute('aria-busy', 'true');
  });

  document.addEventListener('htmx:beforeOnLoad', function (event) {
    var xhr = event.detail.xhr;
    var form = event.detail.elt.closest('[data-step-form]');
    if (form && xhr.status >= 200 && xhr.status < 300 && xhr.getResponseHeader('HX-Redirect')) {
      var step = form.getAttribute('data-step-form');
      if (step === 'review') clearDraft();
      else markStepValid(step);
    }
  });

  document.addEventListener('htmx:beforeSwap', function (event) {
    var xhr = event.detail.xhr;
    if (xhr.status >= 400 && event.detail.target && event.detail.target.hasAttribute('data-timeline')) {
      event.detail.shouldSwap = false;
      return;
    }
    if (xhr.status >= 400 && xhr.responseText) {
      event.detail.shouldSwap = true;
      event.detail.isError = false;
    }
  });

  document.addEventListener('htmx:afterRequest', function (event) {
    var source = event.detail.elt;
    source.removeAttribute('aria-busy');
    if (event.detail.target.id === 'request-list') event.detail.target.setAttribute('aria-busy', 'false');
    if (source.hasAttribute('data-list-filter')) reflectFilters();
    if (event.detail.failed && !event.detail.xhr.responseText) setNotice(UNAVAILABLE);
  });

  document.addEventListener('htmx:responseError', function (event) {
    var target = event.detail.target;
    if (target && target.hasAttribute('data-timeline')) timelineFailure(target);
  });

  document.addEventListener('htmx:sendError', function (event) {
    var target = event.detail.target;
    if (target && target.hasAttribute('data-timeline')) timelineFailure(target);
    else setNotice(UNAVAILABLE);
  });

  document.addEventListener('htmx:afterSwap', function () {
    paintMotion();
    focusFirstAppended();
  });

  function boot() {
    paintMotion();
    guardStep();
    hydrateDraft();
    var dialog = document.getElementById('discard-dialog');
    if (dialog) {
      dialog.addEventListener('close', function () {
        if (!cancelOpener) return;
        cancelOpener.focus();
        cancelOpener = null;
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
