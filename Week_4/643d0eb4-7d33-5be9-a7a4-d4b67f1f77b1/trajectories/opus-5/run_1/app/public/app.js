/* Keystone Tables console and public behaviour. */
(function () {
  'use strict';

  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  var SAVED_ROW_DURATION = 4000;
  var REFUSAL_DURATION = 8000;
  var ROW_STAGGER = 36;

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function visibleFocusables(root) {
    return qsa(FOCUSABLE, root).filter(function (el) {
      if (el.hidden) return false;
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }
  function bootstrap() {
    var node = document.getElementById('bootstrap');
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || '{}');
    } catch (err) {
      return {};
    }
  }
  function restartAnimation(el) {
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  var DATA = bootstrap();

  /* -------------------------------------------------------------- *
   * The one status region: Workspace updates
   * -------------------------------------------------------------- */

  var noticeTimer = null;
  var noticeToken = 0;

  function allowanceNotice() {
    return document.getElementById('allowance-notice');
  }

  function announce(sentence, kind, duration) {
    var strip = document.getElementById('notice-strip');
    if (!strip) return;
    noticeToken += 1;
    var token = noticeToken;
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    strip.textContent = sentence;
    strip.setAttribute('data-kind', kind || 'neutral');
    strip.hidden = false;
    restartAnimation(strip);
    if (kind === 'refuse') {
      var notice = allowanceNotice();
      if (notice) notice.hidden = true;
    }
    if (duration) {
      noticeTimer = setTimeout(function () {
        if (token !== noticeToken) return;
        strip.hidden = true;
        strip.textContent = '';
        var standing = allowanceNotice();
        if (standing) standing.hidden = false;
        noticeTimer = null;
      }, duration);
    }
  }

  function announceSavedRow(reference) {
    announce('Row saved: ' + reference + '.', 'affirm', SAVED_ROW_DURATION);
  }
  function announceRefusal(reason) {
    announce('Amendment refused: ' + reason + '.', 'refuse', REFUSAL_DURATION);
  }

  /* -------------------------------------------------------------- *
   * Requests to the interface
   * -------------------------------------------------------------- */

  function send(method, url, body, headers) {
    var init = {
      method: method,
      credentials: 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, headers || {}),
    };
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function (res) {
      var type = res.headers.get('Content-Type') || '';
      if (res.status === 204 || !type.indexOf) {
        return { res: res, body: null };
      }
      if (type.indexOf('application/json') === -1) return { res: res, body: null };
      return res.json().then(
        function (parsed) {
          return { res: res, body: parsed };
        },
        function () {
          return { res: res, body: null };
        }
      );
    });
  }

  function sendForm(url, fields) {
    var data = new URLSearchParams();
    Object.keys(fields).forEach(function (key) {
      data.append(key, fields[key] === undefined || fields[key] === null ? '' : String(fields[key]));
    });
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: data.toString(),
    }).then(function (res) {
      return res.json().then(
        function (parsed) {
          return { res: res, body: parsed };
        },
        function () {
          return { res: res, body: null };
        }
      );
    });
  }

  /* -------------------------------------------------------------- *
   * Chrome: the navigation drawer and the account control
   * -------------------------------------------------------------- */

  var nav = document.getElementById('route-nav');
  var navToggle = document.getElementById('nav-toggle');
  var drawerOpen = false;

  function isDesktop() {
    return window.innerWidth >= 800;
  }

  function applyNavState() {
    if (!nav || !navToggle) return;
    if (isDesktop()) {
      nav.hidden = false;
      navToggle.hidden = true;
      navToggle.setAttribute('aria-expanded', 'false');
      drawerOpen = false;
      return;
    }
    navToggle.hidden = false;
    nav.hidden = !drawerOpen;
    navToggle.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
  }

  function openDrawer() {
    drawerOpen = true;
    applyNavState();
    restartAnimation(nav);
    var first = visibleFocusables(nav)[0];
    if (first) first.focus();
  }

  function closeDrawer(returnFocus) {
    drawerOpen = false;
    applyNavState();
    if (returnFocus && navToggle && !navToggle.hidden) navToggle.focus();
  }

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      if (drawerOpen) closeDrawer(true);
      else openDrawer();
    });
  }

  if (nav) {
    nav.addEventListener('keydown', function (event) {
      if (isDesktop() || !drawerOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer(true);
        return;
      }
      if (event.key !== 'Tab') return;
      var items = visibleFocusables(nav);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  window.addEventListener('resize', applyNavState);
  applyNavState();

  var header = document.getElementById('chrome-header');
  function applyHeaderRule() {
    if (!header) return;
    if (window.scrollY > 0) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  }
  window.addEventListener('scroll', applyHeaderRule, { passive: true });
  applyHeaderRule();

  var signOut = document.getElementById('sign-out');
  if (signOut) {
    signOut.addEventListener('click', function () {
      send('POST', '/api/auth/logout').then(function () {
        window.location.href = '/?signed_out=1';
      });
    });
  }

  /* -------------------------------------------------------------- *
   * Console dialogs
   * -------------------------------------------------------------- */

  var openDialogKey = null;
  var dialogOpener = null;

  function backdropFor(key) {
    return qs('[data-dialog="' + key + '"]');
  }

  function openDialog(key, opener) {
    var backdrop = backdropFor(key);
    if (!backdrop) return null;
    openDialogKey = key;
    dialogOpener = opener || document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add('dialog-open');
    document.documentElement.classList.add('dialog-open');
    var box = qs('.dialog', backdrop);
    restartAnimation(box);
    var error = qs('[data-dialog-error]', backdrop);
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    var items = visibleFocusables(box);
    if (items.length) items[0].focus();
    return backdrop;
  }

  function closeDialog(key) {
    var backdrop = backdropFor(key || openDialogKey);
    if (!backdrop) return;
    backdrop.hidden = true;
    document.body.classList.remove('dialog-open');
    document.documentElement.classList.remove('dialog-open');
    openDialogKey = null;
    var opener = dialogOpener;
    dialogOpener = null;
    if (opener && document.contains(opener)) opener.focus();
  }

  function dialogError(key, message) {
    var backdrop = backdropFor(key);
    if (!backdrop) return;
    var error = qs('[data-dialog-error]', backdrop);
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  document.addEventListener('click', function (event) {
    var opener = event.target.closest ? event.target.closest('[data-open-dialog]') : null;
    if (opener) {
      event.preventDefault();
      prepareDialog(opener.getAttribute('data-open-dialog'), opener);
      openDialog(opener.getAttribute('data-open-dialog'), opener);
      return;
    }
    var cancel = event.target.closest ? event.target.closest('[data-dialog-cancel]') : null;
    if (cancel) {
      event.preventDefault();
      closeDialog();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (!openDialogKey) return;
    var backdrop = backdropFor(openDialogKey);
    if (!backdrop || backdrop.hidden) return;
    var box = qs('.dialog', backdrop);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    var items = visibleFocusables(box);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (!box.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function prepareDialog(key, opener) {
    if (key === 'edit-row') prepareEditRow(opener);
    if (key === 'decide-request') prepareDecideRequest(opener);
  }

  /* -------------------------------------------------------------- *
   * The plan toggle
   * -------------------------------------------------------------- */

  qsa('.toggle-option').forEach(function (button) {
    button.addEventListener('click', function () {
      var word = button.getAttribute('data-period-word');
      qsa('.toggle-option').forEach(function (other) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
        other.classList.toggle('is-selected', other === button);
      });
      qsa('[data-period]').forEach(function (span) {
        span.textContent = word;
      });
    });
  });

  /* -------------------------------------------------------------- *
   * Public forms
   * -------------------------------------------------------------- */

  function clearFieldErrors(form) {
    qsa('[data-error-for]', form).forEach(function (node) {
      node.hidden = true;
      node.textContent = '';
    });
    qsa('.control', form).forEach(function (control) {
      control.removeAttribute('aria-invalid');
    });
  }

  function showFieldError(form, field, reason) {
    var node = qs('[data-error-for="' + field + '"]', form);
    if (!node) {
      var fallback = qs('.form-result', form);
      if (fallback) {
        fallback.textContent = reason;
        fallback.classList.add('is-refuse');
      }
      return;
    }
    node.textContent = reason;
    node.hidden = false;
    var control = document.getElementById(field);
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', field + '-error');
    }
  }

  var enquiryForm = document.getElementById('enquiry-form');
  if (enquiryForm) {
    enquiryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(enquiryForm);
      var result = document.getElementById('enquiry-result');
      result.classList.remove('is-refuse');
      result.textContent = '';
      sendForm('/api/enquiries', {
        form_token: qs('#form_token').value,
        full_name: qs('#full_name').value,
        work_email: qs('#work_email').value,
        phone: qs('#phone').value,
        company: qs('#company').value,
        role: qs('#role').value,
        message: qs('#message').value,
      }).then(function (out) {
        if (out.res.ok) {
          result.textContent = out.body && out.body.confirmation ? out.body.confirmation : 'Enquiry recorded.';
          return;
        }
        var field = out.body && out.body.field ? out.body.field : 'message';
        var reason = out.body && out.body.reason ? out.body.reason : 'That enquiry was refused.';
        showFieldError(enquiryForm, field, reason);
      });
    });
  }

  var subscribeForm = document.getElementById('subscribe-form');
  if (subscribeForm) {
    subscribeForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(subscribeForm);
      var result = document.getElementById('subscribe-result');
      result.classList.remove('is-refuse');
      sendForm('/api/subscribers', {
        form_token: qs('#subscribe_form_token').value,
        email: qs('#email', subscribeForm).value,
      }).then(function (out) {
        if (out.res.ok) {
          result.textContent = out.body && out.body.confirmation ? out.body.confirmation : 'Thank you.';
          return;
        }
        var field = out.body && out.body.field ? out.body.field : 'email';
        showFieldError(subscribeForm, field, out.body ? out.body.reason : 'That subscribe was refused.');
      });
    });
  }

  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(loginForm);
      var result = document.getElementById('login-result');
      result.classList.remove('is-refuse');
      result.textContent = '';
      send('POST', '/api/auth/login', {
        email: qs('#email', loginForm).value,
        password: qs('#password', loginForm).value,
      }).then(function (out) {
        if (out.res.ok) {
          window.location.href = '/console/tables';
          return;
        }
        result.textContent = out.body && out.body.reason ? out.body.reason : 'Email or password is wrong.';
        result.classList.add('is-refuse');
      });
    });
  }

  var signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(signupForm);
      var result = document.getElementById('signup-result');
      result.classList.remove('is-refuse');
      result.textContent = '';
      send('POST', '/api/auth/signup', {
        email: qs('#signup_email').value,
        display_name: qs('#signup_display_name').value,
        department: qs('#signup_department').value,
        tier: qs('#signup_tier').value,
        password: qs('#signup_password').value,
      }).then(function (out) {
        if (out.res.ok) {
          result.textContent = 'Account created for ' + out.body.email + ' on the ' + out.body.tier + ' tier. Sign in to continue.';
          return;
        }
        var map = { email: 'signup_email', password: 'signup_password', tier: 'signup_tier', department: 'signup_department' };
        var field = out.body && out.body.field ? out.body.field : 'email';
        showFieldError(signupForm, map[field] || 'signup_email', out.body ? out.body.reason : 'That sign up was refused.');
        result.textContent = out.body && out.body.reason ? out.body.reason : '';
        result.classList.add('is-refuse');
      });
    });
  }

  /* -------------------------------------------------------------- *
   * The console table, updated in place
   * -------------------------------------------------------------- */

  var tableState = null;
  var rowsSequence = 0;
  var rowCache = {};

  function columnsByCaption() {
    var map = {};
    (DATA.columns || []).forEach(function (c) {
      map[c.caption] = c;
    });
    return map;
  }

  function cellText(col, value) {
    if (value === null || value === undefined) return '';
    if (col.type === 'flag') return value === true ? 'true' : 'false';
    return String(value);
  }

  function renderRows(rows) {
    var body = document.getElementById('rows-body');
    var cols = DATA.columns || [];
    if (!body) return;
    rowCache = {};
    qsa('.data-row', body).forEach(function (tr) {
      tr.parentNode.removeChild(tr);
    });
    rows.forEach(function (row, index) {
      rowCache[row.id] = row;
      var tr = document.createElement('tr');
      tr.className = 'data-row';
      tr.setAttribute('data-row-id', row.id);
      tr.setAttribute('data-version', row.version);
      tr.style.animationDelay = index * ROW_STAGGER + 'ms';
      cols.forEach(function (col, i) {
        var cell = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) {
          cell.setAttribute('scope', 'row');
          cell.className = 'row-title-cell';
        } else {
          cell.className = 'value-cell';
        }
        cell.setAttribute('data-column', col.caption);
        cell.textContent = cellText(col, row.values[col.caption]);
        tr.appendChild(cell);
      });
      var amend = document.createElement('td');
      amend.className = 'amend-cell';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-quiet edit-row-control';
      button.setAttribute('data-open-dialog', 'edit-row');
      button.setAttribute('data-edit-row', row.id);
      button.textContent = 'Edit row';
      amend.appendChild(button);
      tr.appendChild(amend);
      body.appendChild(tr);
    });
    var empty = document.getElementById('empty-line');
    if (empty) empty.hidden = rows.length > 0;
  }

  /** While a page of rows is on its way, each row shows a pulsing placeholder. */
  function setLoading(on) {
    var body = document.getElementById('rows-body');
    var template = document.getElementById('loading-row-template');
    if (!body || !template) return;
    qsa('[data-loading-row]', body).forEach(function (row) {
      row.parentNode.removeChild(row);
    });
    if (!on) return;
    for (var i = 0; i < 6; i += 1) {
      body.appendChild(template.content.cloneNode(true));
    }
  }

  function stateToQuery(state) {
    var params = new URLSearchParams();
    if (state.view) params.set('view', state.view);
    if (state.sort) params.set('sort', state.sort);
    params.set('page', String(state.page));
    return params.toString();
  }

  function updatePager(total) {
    var perPage = tableState.perPage;
    var pages = Math.max(1, Math.ceil(total / perPage));
    var pageNode = qs('[data-page-number]');
    var totalNode = qs('[data-page-total]');
    var rowsNode = qs('[data-row-total]');
    if (pageNode) pageNode.textContent = String(tableState.page);
    if (totalNode) totalNode.textContent = String(pages);
    if (rowsNode) rowsNode.textContent = String(total);
    var previous = document.getElementById('previous-page');
    var next = document.getElementById('next-page');
    if (previous) previous.disabled = tableState.page <= 1;
    if (next) next.disabled = tableState.page >= pages;
  }

  function loadRows(pushHistory) {
    if (!tableState) return Promise.resolve();
    var sequence = ++rowsSequence;
    setLoading(true);
    var url =
      '/api/tables/' + encodeURIComponent(tableState.slug) + '/rows?' + stateToQuery(tableState) + '&per_page=' + tableState.perPage;
    if (pushHistory) {
      var next = window.location.pathname + '?' + stateToQuery(tableState);
      window.history.pushState({ keystone: tableState }, '', next);
    }
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (rows) {
          return { rows: rows, total: Number(res.headers.get('X-Total-Count') || 0), ok: res.ok };
        });
      })
      .then(function (out) {
        // The later change wins, whichever request answers first.
        if (sequence !== rowsSequence) return;
        setLoading(false);
        if (!out.ok) return;
        renderRows(out.rows);
        updatePager(out.total);
      });
  }

  function readStateFromLocation() {
    var params = new URLSearchParams(window.location.search);
    tableState.view = params.get('view') || null;
    tableState.sort = params.get('sort') || null;
    tableState.page = Math.max(1, Number(params.get('page')) || 1);
  }

  if (document.body.getAttribute('data-route') === 'table' && DATA.slug) {
    tableState = {
      slug: DATA.slug,
      view: DATA.view || null,
      sort: DATA.sort || null,
      page: DATA.page || 1,
      perPage: DATA.per_page || 100,
    };
    (DATA.columns || []).forEach(function () {});
    qsa('#rows-body .data-row').forEach(function (tr) {
      var id = tr.getAttribute('data-row-id');
      var values = {};
      qsa('[data-column]', tr).forEach(function (cell) {
        values[cell.getAttribute('data-column')] = cell.textContent;
      });
      rowCache[id] = { id: id, version: Number(tr.getAttribute('data-version')), text: values };
    });

    var viewPicker = document.getElementById('view-picker');
    if (viewPicker) {
      viewPicker.addEventListener('change', function () {
        tableState.view = viewPicker.value || null;
        tableState.page = 1;
        loadRows(true).then(function () {
          if (tableState.view) announce('View applied: ' + tableState.view + '.', 'neutral', 0);
        });
      });
    }
    var sortPicker = document.getElementById('sort-picker');
    if (sortPicker) {
      sortPicker.addEventListener('change', function () {
        tableState.sort = sortPicker.value || null;
        tableState.page = 1;
        loadRows(true);
      });
    }
    var previousPage = document.getElementById('previous-page');
    if (previousPage) {
      previousPage.addEventListener('click', function () {
        if (tableState.page <= 1) return;
        tableState.page -= 1;
        loadRows(true);
      });
    }
    var nextPage = document.getElementById('next-page');
    if (nextPage) {
      nextPage.addEventListener('click', function () {
        tableState.page += 1;
        loadRows(true);
      });
    }
    window.addEventListener('popstate', function () {
      readStateFromLocation();
      var picker = document.getElementById('view-picker');
      if (picker) picker.value = tableState.view || '';
      var sorter = document.getElementById('sort-picker');
      if (sorter && tableState.sort) sorter.value = tableState.sort;
      loadRows(false);
    });
  }

  /* ---------------------------- Edit row ------------------------- */

  var editRowTarget = null;

  function cellFor(tr, caption) {
    if (!tr) return null;
    var cells = qsa('[data-column]', tr);
    for (var i = 0; i < cells.length; i += 1) {
      if (cells[i].getAttribute('data-column') === caption) return cells[i];
    }
    return null;
  }

  function prepareEditRow(opener) {
    var id = opener.getAttribute('data-edit-row');
    var tr = qs('[data-row-id="' + id + '"]');
    editRowTarget = { id: id, tr: tr, version: tr ? Number(tr.getAttribute('data-version')) : 1, original: {} };
    var backdrop = backdropFor('edit-row');
    if (!backdrop) return;
    qsa('[data-column]', backdrop).forEach(function (control) {
      var caption = control.getAttribute('data-column');
      var cell = cellFor(tr, caption);
      var text = cell ? cell.textContent : '';
      editRowTarget.original[caption] = text;
      control.value = text;
    });
  }

  function parseControlValue(control) {
    var type = control.getAttribute('data-type');
    var raw = control.value;
    if (raw === '') return null;
    if (type === 'integer' || type === 'decimal') {
      var n = Number(raw);
      if (!isFinite(n) || raw.trim() === '') return raw;
      return n;
    }
    if (type === 'flag') {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return raw;
    }
    return raw;
  }

  var editRowForm = qs('[data-dialog-form="edit-row"]');
  if (editRowForm) {
    editRowForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!editRowTarget) return;
      var backdrop = backdropFor('edit-row');
      var values = {};
      var typed = {};
      qsa('[data-column]', backdrop).forEach(function (control) {
        var caption = control.getAttribute('data-column');
        if (control.value === editRowTarget.original[caption]) return;
        values[caption] = parseControlValue(control);
        typed[caption] = control.value;
      });
      var target = editRowTarget;
      closeDialog('edit-row');
      if (!Object.keys(values).length) return;

      // The amendment is shown on the row before the server has answered it.
      Object.keys(typed).forEach(function (caption) {
        var cell = cellFor(target.tr, caption);
        if (cell) cell.textContent = typed[caption];
      });

      send('PATCH', '/api/tables/' + encodeURIComponent(DATA.slug) + '/rows/' + encodeURIComponent(target.id), { values: values }, {
        'If-Match-Version': String(target.version),
      }).then(function (out) {
        if (out.res.ok && out.body) {
          if (target.tr) {
            target.tr.setAttribute('data-version', out.body.version);
            (DATA.columns || []).forEach(function (col) {
              var cell = cellFor(target.tr, col.caption);
              if (cell) cell.textContent = cellText(col, out.body.values[col.caption]);
            });
            qsa('.data-row.is-saved').forEach(function (other) {
              other.classList.remove('is-saved');
            });
            target.tr.classList.add('is-saved');
            setTimeout(function () {
              if (target.tr) target.tr.classList.remove('is-saved');
            }, 600);
          }
          var reference = out.body.values.Reference;
          if (reference === undefined) {
            var first = (DATA.columns || [])[0];
            reference = first ? out.body.values[first.caption] : target.id;
          }
          announceSavedRow(reference);
          return;
        }
        // A refused amendment returns the row to its stored value, visibly.
        if (target.tr) {
          target.tr.classList.add('is-reverting');
          setTimeout(function () {
            if (!target.tr) return;
            Object.keys(target.original).forEach(function (caption) {
              var cell = cellFor(target.tr, caption);
              if (cell) cell.textContent = target.original[caption];
            });
            target.tr.classList.remove('is-reverting');
          }, 420);
        }
        announceRefusal(out.body && out.body.reason ? out.body.reason : 'That amendment was refused.');
      });
    });
  }

  /* ---------------------------- New view ------------------------- */

  function viewColumns() {
    var node = document.getElementById('view-columns');
    if (!node) return [];
    try {
      return JSON.parse(node.textContent || '[]');
    } catch (err) {
      return [];
    }
  }

  var ORDERED_TYPES = ['integer', 'decimal', 'date', 'text', 'choice'];

  function operatorsFor(type) {
    var out = ['equals', 'not equals'];
    if (type === 'text') out.push('contains');
    if (ORDERED_TYPES.indexOf(type) !== -1) out.push('greater than', 'less than');
    out.push('is empty');
    return out;
  }

  var filterCount = 0;
  var sortCount = 0;

  function columnOptions(select, cols) {
    cols.forEach(function (col) {
      var option = document.createElement('option');
      option.value = col.caption;
      option.textContent = col.caption;
      select.appendChild(option);
    });
  }

  function fillOperators(select, type) {
    select.innerHTML = '';
    operatorsFor(type).forEach(function (operator) {
      var option = document.createElement('option');
      option.value = operator;
      option.textContent = operator;
      select.appendChild(option);
    });
  }

  var addFilter = document.getElementById('add-filter');
  if (addFilter) {
    addFilter.addEventListener('click', function () {
      var cols = viewColumns();
      if (!cols.length) return;
      filterCount += 1;
      var index = filterCount;
      var group = document.createElement('fieldset');
      group.className = 'filter-group';
      group.setAttribute('data-filter-group', '');
      var legend = document.createElement('legend');
      legend.textContent = 'Filter';
      group.appendChild(legend);

      var columnField = document.createElement('div');
      columnField.className = 'field';
      var columnLabel = document.createElement('label');
      columnLabel.className = 'control-label';
      columnLabel.setAttribute('for', 'filter-column-' + index);
      columnLabel.textContent = 'Column';
      var columnSelect = document.createElement('select');
      columnSelect.className = 'control';
      columnSelect.id = 'filter-column-' + index;
      columnSelect.setAttribute('data-filter-column', '');
      columnOptions(columnSelect, cols);
      columnField.appendChild(columnLabel);
      columnField.appendChild(columnSelect);

      var operatorField = document.createElement('div');
      operatorField.className = 'field';
      var operatorLabel = document.createElement('label');
      operatorLabel.className = 'control-label';
      operatorLabel.setAttribute('for', 'filter-operator-' + index);
      operatorLabel.textContent = 'Operator';
      var operatorSelect = document.createElement('select');
      operatorSelect.className = 'control';
      operatorSelect.id = 'filter-operator-' + index;
      operatorSelect.setAttribute('data-filter-operator', '');
      fillOperators(operatorSelect, cols[0].type);
      operatorField.appendChild(operatorLabel);
      operatorField.appendChild(operatorSelect);

      var valueField = document.createElement('div');
      valueField.className = 'field';
      var valueLabel = document.createElement('label');
      valueLabel.className = 'control-label';
      valueLabel.setAttribute('for', 'filter-value-' + index);
      valueLabel.textContent = 'Value';
      var valueInput = document.createElement('input');
      valueInput.className = 'control';
      valueInput.type = 'text';
      valueInput.id = 'filter-value-' + index;
      valueInput.setAttribute('data-filter-value', '');
      valueField.appendChild(valueLabel);
      valueField.appendChild(valueInput);

      columnSelect.addEventListener('change', function () {
        var found = cols.filter(function (c) {
          return c.caption === columnSelect.value;
        })[0];
        fillOperators(operatorSelect, found ? found.type : 'text');
      });

      group.appendChild(columnField);
      group.appendChild(operatorField);
      group.appendChild(valueField);
      document.getElementById('filter-groups').appendChild(group);
      columnSelect.focus();
    });
  }

  var addSort = document.getElementById('add-sort');
  if (addSort) {
    addSort.addEventListener('click', function () {
      var cols = viewColumns();
      if (!cols.length) return;
      sortCount += 1;
      var index = sortCount;
      var group = document.createElement('fieldset');
      group.className = 'sort-group';
      group.setAttribute('data-sort-group', '');
      var legend = document.createElement('legend');
      legend.textContent = 'Sort';
      group.appendChild(legend);

      var columnField = document.createElement('div');
      columnField.className = 'field';
      var columnLabel = document.createElement('label');
      columnLabel.className = 'control-label';
      columnLabel.setAttribute('for', 'sort-column-' + index);
      columnLabel.textContent = 'Column';
      var columnSelect = document.createElement('select');
      columnSelect.className = 'control';
      columnSelect.id = 'sort-column-' + index;
      columnSelect.setAttribute('data-sort-column', '');
      columnOptions(columnSelect, cols);
      columnField.appendChild(columnLabel);
      columnField.appendChild(columnSelect);

      var directionField = document.createElement('div');
      directionField.className = 'field';
      var directionLabel = document.createElement('label');
      directionLabel.className = 'control-label';
      directionLabel.setAttribute('for', 'sort-direction-' + index);
      directionLabel.textContent = 'Direction';
      var directionSelect = document.createElement('select');
      directionSelect.className = 'control';
      directionSelect.id = 'sort-direction-' + index;
      directionSelect.setAttribute('data-sort-direction', '');
      ['asc', 'desc'].forEach(function (direction) {
        var option = document.createElement('option');
        option.value = direction;
        option.textContent = direction;
        directionSelect.appendChild(option);
      });
      directionField.appendChild(directionLabel);
      directionField.appendChild(directionSelect);

      group.appendChild(columnField);
      group.appendChild(directionField);
      document.getElementById('sort-groups').appendChild(group);
      columnSelect.focus();
    });
  }

  var newViewForm = qs('[data-dialog-form="new-view"]');
  if (newViewForm) {
    newViewForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = qs('#view-name').value;
      var visibility = qs('#view-visibility').value;
      var filters = qsa('[data-filter-group]').map(function (group) {
        return {
          column: qs('[data-filter-column]', group).value,
          operator: qs('[data-filter-operator]', group).value,
          value: qs('[data-filter-value]', group).value,
        };
      });
      var sorts = qsa('[data-sort-group]').map(function (group) {
        return {
          column: qs('[data-sort-column]', group).value,
          direction: qs('[data-sort-direction]', group).value,
        };
      });
      send('POST', '/api/tables/' + encodeURIComponent(DATA.slug) + '/views', {
        name: name,
        visibility: visibility,
        filters: filters,
        sorts: sorts,
      }).then(function (out) {
        if (!out.res.ok) {
          dialogError('new-view', out.body && out.body.reason ? out.body.reason : 'That view was refused.');
          return;
        }
        closeDialog('new-view');
        var picker = document.getElementById('view-picker');
        if (picker) {
          var option = document.createElement('option');
          option.value = out.body.name;
          option.textContent = out.body.name;
          picker.appendChild(option);
          picker.value = out.body.name;
        }
        tableState.view = out.body.name;
        tableState.page = 1;
        loadRows(true).then(function () {
          announce('View applied: ' + out.body.name + '.', 'neutral', 0);
        });
      });
    });
  }

  /* ---------------------------- Requests ------------------------- */

  var decideTarget = null;

  function prepareDecideRequest(opener) {
    decideTarget = {
      id: opener.getAttribute('data-request-id'),
      department: opener.getAttribute('data-request-department'),
      account: opener.getAttribute('data-request-account'),
      row: opener.closest('tr'),
    };
    var context = qs('[data-request-context]');
    if (context) {
      context.textContent = decideTarget.account + ' asks for a role on ' + decideTarget.department + '.';
    }
  }

  var decideForm = qs('[data-dialog-form="decide-request"]');
  if (decideForm) {
    decideForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!decideTarget) return;
      var decision = qs('#decision').value;
      var reason = qs('#decision-reason').value;
      var target = decideTarget;
      send('POST', '/api/requests/' + encodeURIComponent(target.id) + '/decision', {
        decision: decision,
        reason: reason,
      }).then(function (out) {
        if (!out.res.ok) {
          dialogError('decide-request', out.body && out.body.reason ? out.body.reason : 'That decision was refused.');
          return;
        }
        closeDialog('decide-request');
        if (target.row) {
          var cells = target.row.children;
          if (cells[3]) cells[3].textContent = out.body.state;
          if (cells[5]) cells[5].textContent = out.body.reason || '';
          if (cells[6]) cells[6].textContent = '';
          target.row.setAttribute('data-state', out.body.state);
        }
        announce(
          (out.body.state === 'approved' ? 'Request approved for ' : 'Request declined for ') + target.department + '.',
          out.body.state === 'approved' ? 'affirm' : 'neutral',
          0
        );
      });
    });
  }

  var requestForm = document.getElementById('request-form');
  if (requestForm) {
    requestForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = document.getElementById('request-result');
      result.classList.remove('is-refuse');
      send('POST', '/api/requests', {
        department: qs('#request-department').value,
        role: qs('#request-role').value,
      }).then(function (out) {
        if (!out.res.ok) {
          result.textContent = out.body && out.body.reason ? out.body.reason : 'That request was refused.';
          result.classList.add('is-refuse');
          return;
        }
        result.textContent = 'Request raised for ' + out.body.department + ' as ' + out.body.role + '.';
        window.setTimeout(function () {
          window.location.reload();
        }, 200);
      });
    });
  }

  /* ---------------------------- Snapshots ------------------------ */

  var RETENTION_COUNTS = { 'one period': 1, 'four periods': 4, 'twelve periods': 12 };

  function retentionCount(words) {
    return RETENTION_COUNTS[words] === undefined ? Infinity : RETENTION_COUNTS[words];
  }

  var publishForm = qs('[data-dialog-form="publish-snapshot"]');
  if (publishForm) {
    publishForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var table = qs('#snapshot-table').value;
      var period = qs('#snapshot-period').value;
      send('POST', '/api/snapshots', { table: table, period: period }).then(function (out) {
        if (!out.res.ok) {
          dialogError('publish-snapshot', out.body && out.body.reason ? out.body.reason : 'That publish was refused.');
          return;
        }
        closeDialog('publish-snapshot');
        var snapshots = DATA.snapshots || [];
        var before = {};
        snapshots.forEach(function (s) {
          before[s.id] = s.retained;
        });
        snapshots.unshift({
          id: out.body.id,
          table: out.body.table,
          department: out.body.department,
          period: out.body.period,
          published_at: out.body.published_at,
          business_day: out.body.business_day,
          sequence: out.body.sequence,
          tier: out.body.tier,
          retention: out.body.retention,
          row_count: out.body.row_count,
          retained: true,
        });
        // Rank each table's snapshots again, newest first, at this read.
        var byTable = {};
        snapshots.forEach(function (s) {
          if (!byTable[s.table]) byTable[s.table] = [];
          byTable[s.table].push(s);
        });
        var expired = [];
        Object.keys(byTable).forEach(function (slug) {
          var list = byTable[slug].slice().sort(function (a, b) {
            return a.published_at < b.published_at ? 1 : -1;
          });
          list.forEach(function (s, index) {
            s.retained = index + 1 <= retentionCount(s.retention);
            if (before[s.id] === true && s.retained === false) expired.push(s);
          });
        });
        DATA.snapshots = snapshots;
        renderSnapshots(snapshots);
        announce('Snapshot published for ' + out.body.period + '.', 'affirm', 0);
        if (expired.length) showRetentionBanner(expired[0].period);
      });
    });
  }

  function renderSnapshots(snapshots) {
    var body = document.getElementById('snapshots-body');
    if (!body) return;
    body.innerHTML = '';
    snapshots.forEach(function (s, index) {
      var tr = document.createElement('tr');
      tr.className = 'data-row snapshot-row';
      tr.setAttribute('data-retained', String(s.retained));
      tr.style.animationDelay = index * ROW_STAGGER + 'ms';
      if (!s.retained) tr.setAttribute('aria-disabled', 'true');
      var cells = [
        s.period,
        s.table,
        s.department,
        s.sequence,
        s.tier,
        s.row_count,
        s.published_at,
        s.business_day,
        s.retained ? 'Available' : 'Unavailable',
      ];
      cells.forEach(function (value, i) {
        var cell = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) {
          cell.setAttribute('scope', 'row');
          cell.className = 'row-title-cell';
        }
        if (i === cells.length - 1) cell.className = 'availability-cell';
        cell.textContent = String(value);
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  function showRetentionBanner(period) {
    var slot = document.getElementById('retention-banner-slot');
    if (!slot) return;
    slot.innerHTML = '';
    var banner = document.createElement('p');
    banner.className = 'retention-banner';
    banner.id = 'retention-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'The ' + period + ' snapshot has fallen outside its retention window.';
    slot.appendChild(banner);
  }

  /* ---------------------------- Administration ------------------- */

  var grantForm = document.getElementById('grant-form');
  if (grantForm) {
    grantForm.addEventListener('submit', function (event) {
      event.preventDefault();
      send('POST', '/api/admin/grants', {
        account: qs('#grant-account').value,
        role: qs('#grant-role').value,
      }).then(function (out) {
        if (!out.res.ok) {
          announce('Grant refused: ' + (out.body && out.body.reason ? out.body.reason : 'unknown') + '.', 'refuse', 0);
          return;
        }
        announce('Grant created for ' + out.body.account + '.', 'affirm', 0);
        window.setTimeout(function () {
          window.location.reload();
        }, 200);
      });
    });
  }

  var revokeForm = qs('[data-dialog-form="confirm-bulk-revoke"]');
  if (revokeForm) {
    revokeForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var phrase = qs('#confirmation-phrase').value;
      var ids = qsa('.revoke-box')
        .filter(function (box) {
          return box.checked;
        })
        .map(function (box) {
          return box.getAttribute('data-revoke-id');
        });
      send('POST', '/api/admin/grants/revocations', { grants: ids, confirmation: phrase }).then(function (out) {
        closeDialog('confirm-bulk-revoke');
        if (!out.res.ok) {
          if (out.body && out.body.field === 'confirmation') {
            announce('Bulk revoke refused: the confirmation phrase does not match.', 'refuse', 0);
          } else {
            announce('Bulk revoke refused: ' + (out.body && out.body.reason ? out.body.reason : 'unknown') + '.', 'refuse', 0);
          }
          var strip = document.getElementById('notice-strip');
          if (strip) strip.classList.remove('is-flashing');
          return;
        }
        announce('Grants revoked: ' + out.body.revoked + '.', 'affirm', 0);
        var affirmed = document.getElementById('notice-strip');
        if (affirmed) {
          affirmed.classList.add('is-flashing');
          setTimeout(function () {
            affirmed.classList.remove('is-flashing');
          }, 600);
        }
        window.setTimeout(function () {
          window.location.reload();
        }, 400);
      });
    });
  }
})();
