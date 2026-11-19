// The browser behaviour: the drawer, the five dialogs with their focus rules, the notices and
// their timers, the in-place table updates with the address carrying its state, the plan
// toggle, the auth tabs and the forms. Everything degrades to the server-rendered page.
(function () {
  'use strict';

  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------- the one status region ----------

  function statusRegion() { return $('#workspace-updates'); }

  var regionTimer = null;
  // Announces one sentence in the Workspace updates region, politely.
  function announce(sentence) {
    var region = statusRegion();
    if (!region) return;
    region.textContent = '';
    if (regionTimer) { clearTimeout(regionTimer); regionTimer = null; }
    // A short reflow so a screen reader hears the change.
    void region.offsetWidth;
    region.textContent = sentence;
  }

  function announceThenClear(sentence, ms) {
    announce(sentence);
    var region = statusRegion();
    if (!region) return;
    if (regionTimer) { clearTimeout(regionTimer); }
    regionTimer = setTimeout(function () {
      // Only clear when the sentence is still this one: a later notice is never hidden by an
      // earlier timer.
      if (region.textContent === sentence) region.textContent = '';
      regionTimer = null;
    }, ms);
  }

  // The published notice durations.
  var AFFIRM_MS = 4000;
  var REFUSAL_MS = 8000;

  function noticeStrip(kind, sentence) {
    var strip = document.createElement('div');
    strip.className = 'notice-strip is-arriving ' + (kind === 'affirm' ? 'notice-affirm' : kind === 'refuse' ? 'notice-refuse' : 'notice-caution');
    strip.setAttribute('role', 'status');
    strip.textContent = sentence;
    var frame = $('.page-frame');
    if (frame) frame.insertBefore(strip, frame.firstChild);
    return strip;
  }

  function removeStrip(strip) {
    if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
  }

  // ---------- the navigation drawer ----------

  function setupDrawer() {
    var toggle = $('#nav-toggle');
    var drawer = $('#nav-drawer');
    var scrim = $('#nav-scrim');
    if (!toggle || !drawer || !scrim) return;
    var open = false;

    function apply(next) {
      open = next;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        drawer.hidden = false;
        scrim.hidden = false;
        // A closed drawer is unavailable: opening returns its links to the tree and the
        // keyboard order.
        $all('a', drawer).forEach(function (a) { a.removeAttribute('tabindex'); a.removeAttribute('aria-hidden'); });
        requestAnimationFrame(function () {
          drawer.classList.add('is-open');
          var first = $('a', drawer);
          if (first) first.focus();
        });
      } else {
        drawer.classList.remove('is-open');
        scrim.hidden = true;
        // While the drawer is closed its links take no focus and hide from the tree.
        $all('a', drawer).forEach(function (a) { a.setAttribute('tabindex', '-1'); a.setAttribute('aria-hidden', 'true'); });
        window.setTimeout(function () {
          if (!open) drawer.hidden = true;
        }, REDUCED_MOTION ? 0 : 240);
      }
    }

    toggle.addEventListener('click', function () { apply(!open); toggle.focus(); });
    scrim.addEventListener('click', function () { apply(false); toggle.focus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { apply(false); toggle.focus(); }
    });
    apply(false);
    // Opening the drawer moves focus into it; Tab stays inside while it is open.
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var links = $all('a', drawer).filter(function (a) { return a.getAttribute('tabindex') !== '-1'; });
      if (links.length === 0) return;
      var first = links[0], last = links[links.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  // ---------- the header hairline ----------

  function setupHeaderScrolled() {
    var header = $('#site-header');
    if (!header) return;
    var update = function () {
      if (window.scrollY > 0) header.classList.add('is-scrolled');
      else header.classList.remove('is-scrolled');
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ---------- dialogs ----------

  var activeDialog = null;
  var openingControl = null;

  function dialogControls(dialog) {
    return $all('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog)
      .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  var savedBodyOverflow = null;
  function openDialog(dialog, opener) {
    if (activeDialog) closeDialog(false);
    openingControl = opener || document.activeElement;
    activeDialog = dialog;
    // The page behind an open dialog does not scroll: hold it still while the dialog holds.
    if (savedBodyOverflow === null) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    var backdrop = dialog.closest('.dialog-backdrop');
    if (backdrop) backdrop.hidden = false;
    if (!REDUCED_MOTION) {
      dialog.classList.remove('is-entering');
      void dialog.offsetWidth;
      dialog.classList.add('is-entering');
    }
    var controls = dialogControls(dialog);
    if (controls.length > 0) {
      var target = controls.find(function (c) { return c.tagName !== 'BUTTON' || !c.hasAttribute('data-dialog-cancel'); }) || controls[0];
      target.focus();
    }
    // A dialog taller than the viewport keeps the primary control reachable: the dialog
    // scrolls inside itself, so place the primary inside the dialog's own scroll without
    // scrolling the page behind it.
    var primary = dialog.querySelector('button[type=submit]');
    if (primary && dialog.scrollHeight > dialog.clientHeight) {
      var pr = primary.offsetTop;
      dialog.scrollTop = Math.max(0, pr - dialog.clientHeight / 2 + primary.offsetHeight / 2);
    }
    document.addEventListener('keydown', dialogKeydown, true);
  }

  function closeDialog(restoreFocus) {
    if (!activeDialog) return;
    var dialog = activeDialog;
    var backdrop = dialog.closest('.dialog-backdrop');
    if (backdrop) backdrop.hidden = true;
    dialog.classList.remove('is-entering');
    activeDialog = null;
    if (savedBodyOverflow !== null) {
      document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = null;
    }
    document.removeEventListener('keydown', dialogKeydown, true);
    if (restoreFocus !== false && openingControl && document.contains(openingControl)) {
      openingControl.focus();
    }
    openingControl = null;
  }

  function dialogKeydown(e) {
    if (!activeDialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog(true);
      return;
    }
    if (e.key !== 'Tab') return;
    var controls = dialogControls(activeDialog);
    if (controls.length === 0) return;
    var first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  }

  // ---------- the plan toggle ----------

  function setupPlanToggle() {
    var yearly = $('#toggle-yearly');
    var monthly = $('#toggle-monthly');
    if (!yearly || !monthly) return;
    function apply(period) {
      yearly.classList.toggle('is-active', period === 'yearly');
      monthly.classList.toggle('is-active', period === 'monthly');
      yearly.setAttribute('aria-pressed', period === 'yearly' ? 'true' : 'false');
      monthly.setAttribute('aria-pressed', period === 'monthly' ? 'true' : 'false');
      var existing = $('#plan-period-note');
      if (existing) existing.remove();
      // The toggle changes the rendered period word on every card and no number.
      $all('.tier-figures dt').forEach(function (dt) {
        var text = dt.textContent;
        var base = text.replace(/\s+\((per [a-z]+)\)$/, '');
        if (dt.dataset.periodBase === undefined) dt.dataset.periodBase = base;
        dt.textContent = dt.dataset.periodBase + ' (' + (period === 'yearly' ? 'per year' : 'per month') + ')';
      });
    }
    yearly.addEventListener('click', function () { apply('yearly'); });
    monthly.addEventListener('click', function () { apply('monthly'); });
    apply('yearly');
  }

  // ---------- auth tabs ----------

  function setupAuthTabs() {
    var tabs = $all('.auth-tab');
    if (tabs.length === 0) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (other) {
          var active = other === tab;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-selected', active ? 'true' : 'false');
          var panel = document.getElementById(other.dataset.panel);
          if (panel) panel.hidden = !active;
        });
        var panel = document.getElementById(tab.dataset.panel);
        if (panel) {
          var first = $('input, select, button', panel);
          if (first) first.focus();
        }
      });
    });
  }

  // ---------- api helper ----------

  function apiFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({
      'Accept': 'application/json',
    }, options.headers || {});
    if (options.json !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
      options.method = options.method || 'POST';
      delete options.json;
    }
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
        return { status: res.status, ok: res.ok, body: body, headers: res.headers };
      });
    });
  }

  // ---------- sign in and sign up ----------

  function setupAuthForms() {
    var signin = $('#signin-form');
    if (signin) {
      signin.addEventListener('submit', function (e) {
        e.preventDefault();
        var error = $('#signin-error');
        if (error) { error.textContent = ''; error.hidden = true; }
        apiFetch('/api/auth/login', {
          json: { email: $('#signin_email').value, password: $('#signin_password').value },
        }).then(function (res) {
          if (res.status === 200) {
            window.location.href = '/console/tables';
          } else {
            var message = res.body && res.body.reason ? res.body.reason : 'Sign in failed.';
            if (error) { error.textContent = message; error.hidden = false; }
          }
        });
      });
    }
    var signup = $('#signup-form');
    if (signup) {
      signup.addEventListener('submit', function (e) {
        e.preventDefault();
        apiFetch('/api/auth/signup', {
          json: {
            display_name: $('#signup_display_name').value,
            email: $('#signup_email').value,
            department: $('#signup_department').value,
            password: $('#signup_password').value,
            tier: $('#signup_tier').value,
          },
        }).then(function (res) {
          if (res.status === 201) {
            // A sign up opens no session; the reader signs in afterwards.
            var panel = $('#signup-panel');
            var note = document.createElement('p');
            note.className = 'confirm-note';
            note.setAttribute('role', 'status');
            note.textContent = 'Account recorded for ' + res.body.email + '. Sign in to reach a department.';
            if (panel) panel.insertBefore(note, panel.firstChild);
          } else {
            var error = document.createElement('p');
            error.className = 'field-error';
            error.setAttribute('role', 'alert');
            error.textContent = (res.body && res.body.reason) ? (res.body.reason + ' (' + res.body.field + ')') : 'Sign up failed.';
            var panel = $('#signup-panel');
            if (panel) panel.insertBefore(error, panel.firstChild);
          }
        });
      });
    }
  }

  // ---------- sign out ----------

  function setupSignOut() {
    var button = $('#signout-button');
    if (!button) return;
    button.addEventListener('click', function () {
      apiFetch('/api/auth/logout', { method: 'POST' }).then(function () {
        // The one navigation sign out performs: the landing page carrying the published
        // sentence.
        window.location.href = '/signed-out';
      });
    });
  }

  // ---------- the table page ----------

  function setupTablePage() {
    var tableEl = $('#rows-table');
    if (!tableEl || !window.__TABLE__) return;
    var meta = window.__TABLE__;
    var body = $('#rows-body');
    var viewPicker = $('#view-picker');
    var sortPicker = $('#sort-picker');
    var pager = $('#table-pager');
    var emptyLine = $('.empty-table-line');
    var requestId = 0;

    function stateFromLocation() {
      var params = new URLSearchParams(window.location.search);
      return {
        view: params.get('view') || '',
        sort: params.get('sort') || '',
        page: Math.max(1, Number(params.get('page')) || 1),
      };
    }

    function pushState(next) {
      var params = new URLSearchParams();
      if (next.view) params.set('view', next.view);
      if (next.sort) params.set('sort', next.sort);
      if (next.page > 1) params.set('page', String(next.page));
      var url = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.pushState(next, '', url);
    }

    function readState() {
      var state = stateFromLocation();
      if (viewPicker) viewPicker.value = state.view;
      if (sortPicker) sortPicker.value = state.sort;
      return state;
    }

    function renderRows(rows, total) {
      var columns = meta.columns;
      var rowTitle = columns[0];
      var valueColumns = columns.slice(1);
      var canAmend = meta.canAmend;
      body.innerHTML = rows.map(function (row, index) {
        var cells = valueColumns.map(function (c) {
          return '<td>' + displayValue(row.values[c.caption]) + '</td>';
        }).join('');
        var actions = canAmend
          ? '<td class="cell-actions"><button type="button" class="btn btn-secondary btn-small edit-row-button" data-row="' + escAttr(row.id) + '" data-control="Edit row">Edit row</button></td>'
          : '';
        return '<tr class="table-row is-entering" data-row="' + escAttr(row.id) + '" data-version="' + row.version + '" data-stagger="' + index + '">' +
          '<th scope="row" class="cell-rowtitle">' + displayValue(row.values[rowTitle.caption]) + '</th>' + cells + actions + '</tr>';
      }).join('');
      if (!REDUCED_MOTION) {
        $all('tr.is-entering', body).forEach(function (tr) {
          tr.style.animationDelay = (Number(tr.dataset.stagger) * 40) + 'ms';
        });
      } else {
        $all('tr.is-entering', body).forEach(function (tr) { tr.classList.remove('is-entering'); });
      }
      if (emptyLine) emptyLine.hidden = total > 0;
      tableEl.dataset.total = String(total);
      wireEditButtons();
    }

    function displayValue(value) {
      if (value === null || value === undefined || value === '') return '<span class="empty-value" aria-hidden="true">—</span>';
      return escapeHtml(typeof value === 'boolean' ? (value ? 'true' : 'false') : value);
    }

    function escapeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escAttr(text) { return escapeHtml(text); }

    function fetchRows(state) {
      var myId = ++requestId;
      var params = new URLSearchParams();
      if (state.view) params.set('view', state.view);
      if (state.sort) params.set('sort', state.sort);
      params.set('page', String(state.page));
      params.set('per_page', '100');
      return apiFetch('/api/tables/' + encodeURIComponent(meta.slug) + '/rows?' + params.toString()).then(function (res) {
        if (myId !== requestId) return null; // a later change already won
        if (res.status !== 200) return { rows: [], total: 0 };
        return { rows: res.body, total: Number(res.headers.get('X-Total-Count') || res.body.length) };
      });
    }

    function applyState(state, push) {
      if (push) pushState(state);
      if (viewPicker) viewPicker.value = state.view;
      if (sortPicker) sortPicker.value = state.sort;
      if (pager) {
        pager.dataset.page = String(state.page);
        var totalPages = Math.max(1, Math.ceil(state.total / 100));
      }
      showLoading();
      return fetchRows(state).then(function (result) {
        if (!result) return;
        renderRows(result.rows, result.total);
        var totalPages = Math.max(1, Math.ceil(result.total / 100));
        if (pager) {
          var prev = $('#prev-page'), next = $('#next-page');
          if (prev) prev.disabled = state.page <= 1;
          if (next) next.disabled = state.page >= totalPages;
          pager.dataset.totalPages = String(totalPages);
          var status = $('#pager-status');
          if (status) status.textContent = 'Page ' + state.page + ' of ' + totalPages;
        }
      });
    }

    var currentState = null;
    readState();
    currentState = stateFromLocation();
    currentState.total = Number(tableEl.dataset.total || 0);
    applyState(currentState, false);

    function showLoading() {
      body.innerHTML = '<tr class="loading-row"><th scope="row" class="cell-rowtitle"><span class="loading-cell"></span></th>' +
        (meta.columns.length > 1 ? '<td colspan="' + (meta.columns.length - 1 + (meta.canAmend ? 1 : 0)) + '"><span class="loading-cell"></span></td>' : '') + '</tr>';
    }

    if (viewPicker) {
      viewPicker.addEventListener('change', function () {
        var next = { view: viewPicker.value, sort: currentState.sort, page: 1, total: currentState.total };
        currentState = next;
        announceAppliedView(next.view);
        applyState(next, true);
      });
    }
    if (sortPicker) {
      sortPicker.addEventListener('change', function () {
        var next = { view: currentState.view, sort: sortPicker.value, page: 1, total: currentState.total };
        currentState = next;
        applyState(next, true);
      });
    }
    if (pager) {
      $('#prev-page').addEventListener('click', function () {
        if (currentState.page <= 1) return;
        var next = Object.assign({}, currentState, { page: currentState.page - 1 });
        currentState = next;
        applyState(next, true);
      });
      $('#next-page').addEventListener('click', function () {
        var next = Object.assign({}, currentState, { page: currentState.page + 1 });
        currentState = next;
        applyState(next, true);
      });
    }
    window.addEventListener('popstate', function () {
      currentState = stateFromLocation();
      currentState.total = Number(tableEl.dataset.total || 0);
      applyState(currentState, false);
    });

    function announceAppliedView(name) {
      if (name) announceThenClear('View applied: ' + name + '.', AFFIRM_MS);
    }

    // ---------- the edit row dialog ----------

    function wireEditButtons() {
      $all('.edit-row-button', body).forEach(function (button) {
        button.addEventListener('click', function () {
          openEditDialog(button);
        });
      });
    }

    function openEditDialog(button) {
      var rowId = button.dataset.row;
      var tr = button.closest('tr');
      var backdrop = document.getElementById('dialog-backdrop-' + rowId);
      if (!backdrop || !tr) return;
      var dialog = $('.dialog', backdrop);
      // Optimistically show the values the dialog holds, so the row reads what the reader
      // typed before the server answers.
      var form = $('form', dialog);
      form.dataset.reference = tr.children[0].textContent;
      form.dataset.optimistic = '';
      var referenceCell = tr.children[0];
      form.dataset.referenceValue = referenceCell.textContent;
      var opener = button;
      openDialog(dialog, opener);
      // the version stated when the dialog opened travels on the save
      form.dataset.version = tr.dataset.version;
      form.dataset.row = rowId;
      form.__tr = tr;

      var cancel = $('[data-dialog-cancel]', dialog);
      if (cancel && !cancel.__wired) {
        cancel.__wired = true;
        cancel.addEventListener('click', function () { closeDialog(true); });
      }
      if (!form.__wired) {
        form.__wired = true;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          saveRow(form, dialog, tr);
        });
      }
    }

    function collectValues(form) {
      var values = {};
      $all('[data-column]', form).forEach(function (input) {
        var column = input.dataset.column;
        var value = input.value;
        var type = (meta.columns.find(function (c) { return c.caption === column; }) || {}).type;
        if (value === '') { values[column] = null; return; }
        // A wrong-type value keeps the shape the reader typed, so the write boundary refuses
        // it for its type rather than the browser silently rewriting it.
        if (type === 'integer' || type === 'decimal') {
          var num = Number(value);
          values[column] = value.trim() !== '' && !isNaN(num) ? num : value;
        }
        else if (type === 'flag') values[column] = value === 'true';
        else values[column] = value;
      });
      return values;
    }

    function optimisticallyApply(form, tr) {
      // the row carries the value the reader typed before the server has answered
      var columns = meta.columns;
      var cells = tr.children;
      var valueIndex = 1;
      columns.slice(1).forEach(function (c) {
        var input = form.querySelector('[data-column="' + cssEscape(c.caption) + '"]');
        if (!input) return;
        var value = input.value;
        var displayed = value === '' ? '<span class="empty-value" aria-hidden="true">—</span>'
          : escapeHtml(c.type === 'flag' ? value : value);
        if (cells[valueIndex]) cells[valueIndex].innerHTML = displayed;
        valueIndex++;
      });
    }

    function restoreStoredValues(tr) {
      // A refused amendment is seen to roll back: the return runs 320-600ms and ends on the
      // stored value.
      apiFetch('/api/tables/' + encodeURIComponent(meta.slug) + '/rows/' + encodeURIComponent(tr.dataset.row))
        .then(function (res) {
          if (res.status !== 200) return;
          var values = res.body.values;
          var columns = meta.columns;
          var cells = tr.children;
          var valueIndex = 1;
          columns.slice(1).forEach(function (c) {
            var v = values[c.caption];
            if (cells[valueIndex]) {
              cells[valueIndex].innerHTML = (v === null || v === undefined || v === '')
                ? '<span class="empty-value" aria-hidden="true">—</span>'
                : escapeHtml(typeof v === 'boolean' ? (v ? 'true' : 'false') : v);
            }
            valueIndex++;
          });
          var first = columns[0];
          var v0 = values[first.caption];
          if (cells[0]) {
            cells[0].innerHTML = (v0 === null || v0 === undefined || v0 === '')
              ? '<span class="empty-value" aria-hidden="true">—</span>'
              : escapeHtml(typeof v0 === 'boolean' ? (v0 ? 'true' : 'false') : v0);
          }
        });
    }

    function saveRow(form, dialog, tr) {
      var values = collectValues(form);
      var headers = { 'If-Match-Version': form.dataset.version };
      // optimistic update
      optimisticallyApply(form, tr);
      apiFetch('/api/tables/' + encodeURIComponent(meta.slug) + '/rows/' + encodeURIComponent(form.dataset.row), {
        method: 'PATCH',
        headers: headers,
        json: { values: values },
      }).then(function (res) {
        closeDialog(true);
        if (res.status === 200) {
          var saved = res.body;
          tr.dataset.version = String(saved.version);
          refreshRowCells(tr, saved.values);
          flashRow(tr);
          var reference = tr.children[0].textContent.trim();
          announceThenClear('Row saved: ' + reference + '.', AFFIRM_MS);
        } else {
          // A refused amendment leaves the row unchanged and states the reason.
          if (!REDUCED_MOTION) {
            tr.classList.remove('is-returning');
            void tr.offsetWidth;
            tr.classList.add('is-returning');
          }
          restoreStoredValues(tr);
          announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
          showRefusalStrip((res.body && res.body.reason) ? res.body.reason : 'refused');
        }
      });
    }

    function refreshRowCells(tr, values) {
      var columns = meta.columns;
      var cells = tr.children;
      columns.forEach(function (c, i) {
        var v = values[c.caption];
        if (cells[i]) {
          cells[i].innerHTML = (v === null || v === undefined || v === '')
            ? '<span class="empty-value" aria-hidden="true">—</span>'
            : escapeHtml(typeof v === 'boolean' ? (v ? 'true' : 'false') : v);
        }
      });
    }

    function flashRow(tr) {
      if (REDUCED_MOTION) return;
      tr.classList.remove('is-flash');
      void tr.offsetWidth;
      tr.classList.add('is-flash');
      tr.addEventListener('animationend', function handler() {
        tr.classList.remove('is-flash');
        tr.removeEventListener('animationend', handler);
      });
    }

    function showRefusalStrip(reason) {
      var strip = noticeStrip('refuse', 'Amendment refused: ' + reason + '.');
      if (strip && !REDUCED_MOTION) {
        strip.addEventListener('animationend', function () { strip.classList.remove('is-arriving'); });
      }
    }

    // ---------- the new view dialog ----------

    var newViewButton = $('#new-view-button');
    if (newViewButton) {
      newViewButton.addEventListener('click', function () {
        var backdrop = $('#dialog-backdrop-new-view');
        var dialog = $('#dialog-new-view');
        if (!dialog) return;
        openDialog(dialog, newViewButton);
        var cancel = $('[data-dialog-cancel]', dialog);
        cancel.onclick = function () { closeDialog(true); };
      });
      var addFilter = $('#add-filter');
      if (addFilter) {
        addFilter.addEventListener('click', function () {
          addFilterGroup();
        });
      }
      var addSort = $('#add-sort');
      if (addSort) {
        addSort.addEventListener('click', function () {
          addSortGroup();
        });
      }
      var form = $('#new-view-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var filters = $all('.view-filter-group:not([data-template])', form).map(function (group) {
            return {
              column: $('.filter-column', group).value,
              operator: $('.filter-operator', group).value,
              value: $('.filter-value', group).value,
            };
          });
          var sorts = $all('.view-sort-group:not([data-template])', form).map(function (group) {
            return {
              column: $('.sort-column', group).value,
              direction: $('.sort-direction', group).value,
            };
          });
          apiFetch('/api/tables/' + encodeURIComponent(meta.slug) + '/views', {
            json: {
              name: $('#new-view-name').value,
              visibility: $('input[name="visibility"]:checked', form).value,
              filters: filters,
              sorts: sorts,
            },
          }).then(function (res) {
            if (res.status === 201) {
              closeDialog(true);
              var option = document.createElement('option');
              option.value = res.body.name;
              option.textContent = res.body.name;
              if (viewPicker) viewPicker.appendChild(option);
              if (viewPicker) {
                viewPicker.value = res.body.name;
                var next = { view: res.body.name, sort: currentState.sort, page: 1, total: currentState.total };
                currentState = next;
                applyState(next, true);
                announceThenClear('View applied: ' + res.body.name + '.', AFFIRM_MS);
              }
            } else {
              announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
              showRefusalStrip((res.body && res.body.reason) ? res.body.reason : 'refused');
            }
          });
        });
      }
    }

    function addFilterGroup() {
      var host = $('#view-filters');
      var template = $('[data-template="filter"]', host);
      if (!template) return;
      var clone = template.cloneNode(true);
      clone.hidden = false;
      clone.removeAttribute('data-template');
      clone.removeAttribute('hidden');
      var columnSelect = $('.filter-column', clone);
      columnSelect.removeAttribute('id');
      var operatorSelect = $('.filter-operator', clone);
      operatorSelect.removeAttribute('id');
      var valueInput = $('.filter-value', clone);
      valueInput.removeAttribute('id');
      // Each filter sits in its own group labelled Filter with its own pickers.
      var count = $all('.view-filter-group:not([data-template])', host).length + 1;
      var labels = $all('label', clone);
      if (labels[0]) { labels[0].setAttribute('for', 'filter-column-' + count); columnSelect.id = 'filter-column-' + count; }
      if (labels[1]) { labels[1].setAttribute('for', 'filter-operator-' + count); operatorSelect.id = 'filter-operator-' + count; }
      if (labels[2]) { labels[2].setAttribute('for', 'filter-value-' + count); valueInput.id = 'filter-value-' + count; }
      updateOperators(columnSelect, operatorSelect);
      columnSelect.addEventListener('change', function () { updateOperators(columnSelect, operatorSelect); });
      $('[data-remove-filter]', clone).addEventListener('click', function () { clone.remove(); });
      host.appendChild(clone);
      columnSelect.focus();
    }

    function addSortGroup() {
      var host = $('#view-sorts');
      var template = $('[data-template="sort"]', host);
      if (!template) return;
      var clone = template.cloneNode(true);
      clone.hidden = false;
      clone.removeAttribute('data-template');
      clone.removeAttribute('hidden');
      var columnSelect = $('.sort-column', clone);
      columnSelect.removeAttribute('id');
      var directionSelect = $('.sort-direction', clone);
      directionSelect.removeAttribute('id');
      var count = $all('.view-sort-group:not([data-template])', host).length + 1;
      var labels = $all('label', clone);
      if (labels[0]) { labels[0].setAttribute('for', 'sort-column-' + count); columnSelect.id = 'sort-column-' + count; }
      if (labels[1]) { labels[1].setAttribute('for', 'sort-direction-' + count); directionSelect.id = 'sort-direction-' + count; }
      $('[data-remove-sort]', clone).addEventListener('click', function () { clone.remove(); });
      host.appendChild(clone);
      columnSelect.focus();
    }

    // An operator is offered only where the column type supports it.
    function updateOperators(columnSelect, operatorSelect) {
      var caption = columnSelect.value;
      var column = meta.columns.find(function (c) { return c.caption === caption; });
      var operators = column ? (meta.operators[caption] || []) : [];
      operatorSelect.innerHTML = operators.map(function (op) {
        return '<option value="' + escapeHtml(op) + '">' + escapeHtml(op) + '</option>';
      }).join('');
    }

    function cssEscape(text) {
      return window.CSS && CSS.escape ? CSS.escape(text) : String(text).replace(/"/g, '\\"');
    }

    wireEditButtons();
  }

  // ---------- the requests page ----------

  function setupRequestsPage() {
    var raiseForm = $('#raise-request-form');
    if (raiseForm) {
      raiseForm.addEventListener('submit', function (e) {
        e.preventDefault();
        apiFetch('/api/requests', {
          json: {
            department: $('#request-department').value,
            role: $('#request-role').value,
          },
        }).then(function (res) {
          if (res.status === 201) {
            window.location.reload();
          } else {
            announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
          }
        });
      });
    }
    var decideButtons = $all('.decide-request-button');
    var dialog = $('#dialog-decide');
    decideButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        if (!dialog) return;
        dialog.dataset.request = button.dataset.request;
        openDialog(dialog, button);
        var cancel = $('[data-dialog-cancel]', dialog);
        cancel.onclick = function () { closeDialog(true); };
      });
    });
    var decideForm = $('#decide-form');
    if (decideForm) {
      decideForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var requestId = dialog.dataset.request;
        apiFetch('/api/requests/' + encodeURIComponent(requestId) + '/decision', {
          json: {
            decision: $('input[name="decision"]:checked', decideForm).value,
            reason: $('#decide-reason').value,
          },
        }).then(function (res) {
          closeDialog(true);
          if (res.status === 200) {
            var department = res.body.department;
            var sentence = res.body.state === 'approved'
              ? 'Request approved for ' + department + '.'
              : 'Request declined for ' + department + '.';
            announceThenClear(sentence, AFFIRM_MS);
            window.setTimeout(function () { window.location.reload(); }, 350);
          } else {
            announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
          }
        });
      });
    }
  }

  // ---------- the snapshots page ----------

  function setupSnapshotsPage() {
    var publishButton = $('#publish-snapshot-button');
    var dialog = $('#dialog-publish');
    if (!publishButton || !dialog) return;
    publishButton.addEventListener('click', function () {
      openDialog(dialog, publishButton);
      var cancel = $('[data-dialog-cancel]', dialog);
      cancel.onclick = function () { closeDialog(true); };
    });
    var form = $('#publish-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      apiFetch('/api/snapshots', {
        json: { table: $('#publish-table').value, period: $('#publish-period').value },
      }).then(function (res) {
        closeDialog(true);
        if (res.status === 201) {
          announceThenClear('Snapshot published for ' + res.body.period + '.', AFFIRM_MS);
          window.setTimeout(function () { window.location.reload(); }, 350);
        } else {
          announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
        }
      });
    });
  }

  // ---------- the administration page ----------

  function setupAdministrationPage() {
    var createForm = $('#create-grant-form');
    if (createForm) {
      createForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var payload = {
          account: $('#grant-account').value,
          role: $('#grant-role').value,
        };
        var from = $('#grant-from').value;
        if (from) payload.authorises_from = new Date(from).toISOString();
        apiFetch('/api/admin/grants', { json: payload }).then(function (res) {
          if (res.status === 201) {
            window.location.reload();
          } else {
            announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
          }
        });
      });
    }
    var revokeButton = $('#revoke-grants-button');
    var dialog = $('#dialog-revoke');
    if (!revokeButton || !dialog) return;
    revokeButton.addEventListener('click', function () {
      openDialog(dialog, revokeButton);
      var cancel = $('[data-dialog-cancel]', dialog);
      cancel.onclick = function () { closeDialog(true); };
    });
    var form = $('#revoke-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var grants = $all('.grant-check:checked').map(function (c) { return c.value; });
      apiFetch('/api/admin/grants/revocations', {
        json: { grants: grants, confirmation: $('#revoke-phrase').value },
      }).then(function (res) {
        closeDialog(true);
        if (res.status === 200) {
          announceThenClear('Grants revoked: ' + res.body.revoked + '.', AFFIRM_MS);
          window.setTimeout(function () { window.location.reload(); }, 350);
        } else if (res.body && res.body.field === 'confirmation') {
          var strip = noticeStrip('refuse', 'Bulk revoke refused: the confirmation phrase does not match.');
          announceThenClear('Bulk revoke refused: the confirmation phrase does not match.', REFUSAL_MS);
        } else {
          announceThenClear('Amendment refused: ' + (res.body && res.body.reason ? res.body.reason : 'refused') + '.', REFUSAL_MS);
        }
      });
    });
  }

  // ---------- boot ----------

  document.addEventListener('DOMContentLoaded', function () {
    setupDrawer();
    setupHeaderScrolled();
    setupPlanToggle();
    setupAuthTabs();
    setupAuthForms();
    setupSignOut();
    setupTablePage();
    setupRequestsPage();
    setupSnapshotsPage();
    setupAdministrationPage();
  });
})();
