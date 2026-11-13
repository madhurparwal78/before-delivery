/* Switchlamp frontend. One socket per page, server-owned countdowns, keyboard
   triage, the handoff cut and the policy editor. Nothing depends on the device
   clock. */
(function () {
  'use strict';

  var state = {
    socket: null,
    lastSeq: 0,
    countdowns: [],
    reconnectDelay: 500,
    newIncidents: 0,
    rows: [],
    cursorRow: null,
    selected: {},
    savedFilters: [],
    cut: null,
    focusRow: null
  };

  // ---- Announcements and notices ----
  function liveRegion() { return document.getElementById('live'); }
  function announce(text) {
    var el = liveRegion();
    if (!el) return;
    var lines = el.getAttribute('data-lines') || '';
    var parts = lines ? lines.split('\n') : [];
    parts.push(text);
    if (parts.length > 20) parts = parts.slice(parts.length - 20);
    el.setAttribute('data-lines', parts.join('\n'));
    // Each decided event adds one new line at the end, in event order.
    el.textContent = parts.join('\n');
  }
  function problems(text) {
    var el = document.getElementById('problems');
    if (el) el.textContent = text || '';
  }

  // ---- API helper ----
  function api(method, path, body, cb) {
    var opts = { method: method, headers: {} };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    fetch(path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }).then(function (res) {
      if (cb) cb(null, res);
    }).catch(function (e) { if (cb) cb(e); });
  }

  // ---- One socket per page, opened before anything is sent ----
  function connectSocket() {
    if (!document.querySelector('[data-live="true"]') && !document.body.dataset.zone) {
      // Public pages and a stakeholder's /me open none.
      if (!document.querySelector('nav.main-nav')) return;
    }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/api/live?after=' + state.lastSeq;
    try {
      var sock = new WebSocket(url);
      state.socket = sock;
      sock.onopen = function () {
        state.reconnectDelay = 500;
        // Its first frame is then {"type":"hello"}.
        sock.send(JSON.stringify({ type: 'hello' }));
      };
      sock.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.seq && msg.seq > state.lastSeq) state.lastSeq = msg.seq;
        if (msg.type === 'hello') return;
        handleSocketMessage(msg);
      };
      sock.onclose = function (ev) {
        // Close codes: 4401 signed out, 4403 role changed.
        if (ev.code === 4401) { location.href = '/sign-in'; return; }
        if (ev.code === 4403) { location.reload(); return; }
        setTimeout(connectSocket, state.reconnectDelay);
        state.reconnectDelay = Math.min(state.reconnectDelay * 2, 5000);
      };
    } catch (e) { /* WebSockets unavailable */ }
  }

  function handleSocketMessage(msg) {
    var data = msg.data || {};
    switch (msg.type) {
      case 'incident': handleIncidentMessage(data); break;
      case 'analytics': handleAnalyticsMessage(data); break;
      case 'schedule': refreshSchedule(); break;
      case 'status': refreshStatus(); break;
      case 'clock': location.reload(); break;
    }
  }

  // ---- Server-owned countdowns ----
  // A countdown shows the value the server last sent; the server sends it at
  // least once a second.
  function registerCountdown(el, getRemaining) {
    if (!el) return;
    state.countdowns.push({ el: el, get: getRemaining });
  }

  function tickCountdowns() {
    for (var i = 0; i < state.countdowns.length; i++) {
      var c = state.countdowns[i];
      var remaining = c.get();
      if (remaining === null || remaining === undefined) continue;
      var txt = formatClock(remaining);
      if (c.el.textContent !== txt) c.el.textContent = txt;
    }
  }

  function formatClock(remaining) {
    if (remaining <= 0) return '--:--';
    var s = Math.floor(remaining);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(sec);
    return pad(m) + ':' + pad(sec);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---- Incident list ----
  function loadIncidents(keepFocus) {
    var params = new URLSearchParams(location.search);
    var status = params.get('status') || 'open';
    var service = params.get('service') || '';
    var q = '?status=' + encodeURIComponent(status) + '&limit=25';
    if (service) q += '&service_id=' + encodeURIComponent(service);
    api('GET', '/api/incidents' + q, undefined, function (err, res) {
      if (err || !res || res.status !== 200) return;
      renderIncidents(res.body.items || [], res.body.total || 0, keepFocus);
    });
  }

  function renderIncidents(items, total, keepFocus) {
    var tbody = document.getElementById('incident-rows');
    var empty = document.getElementById('empty');
    var totalEl = document.getElementById('incident-total');
    if (!tbody) return;
    if (totalEl) {
      // The exact total as the enormous figure.
      totalEl.childNodes[0].textContent = String(total);
    }
    if (items.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      // The empty sentence can take focus.
      if (empty) empty.tabIndex = 0;
      return;
    }
    if (empty) empty.hidden = true;
    var prevFocus = state.focusRow;
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += incidentRow(items[i]);
    }
    tbody.innerHTML = html;
    state.rows = items;
    // First row has document focus on arrival, so the first J moves to the
    // second row.
    if (!prevFocus || !keepFocus) {
      var first = tbody.querySelector('tr');
      if (first) setRowFocus(first);
    } else {
      var again = tbody.querySelector('tr[data-incident="' + prevFocus + '"]');
      if (again) setRowFocus(again);
    }
    updateNotices();
  }

  function incidentRow(inc) {
    var holders = (inc.holders || []).map(function (h) { return h.name; }).join(', ') || 'Nobody';
    var opened = localTime(inc.opened_at);
    return '<tr data-incident="' + inc.number + '" tabindex="-1">' +
      '<td class="col-num">#' + inc.number + '</td>' +
      '<td><a href="/incidents/' + inc.id + '">' + esc(inc.title) + '</a></td>' +
      '<td>' + esc(inc.service && inc.service.name) + '</td>' +
      '<td><span class="word word-' + inc.status + '">' + statusWord(inc.status) + '</span></td>' +
      '<td>' + esc(holders) + '</td>' +
      '<td>' + esc(opened) + '</td>' +
      '<td><input type="checkbox" aria-label="Select incident ' + inc.number + '" data-select="' + inc.id + '"></td>' +
      '</tr>';
  }

  function statusWord(status) {
    return { triggered: 'Triggered', acknowledged: 'Acknowledged', snoozed: 'Snoozed', resolved: 'Resolved' }[status] || status;
  }

  function setRowFocus(row) {
    if (!row) return;
    state.focusRow = row.getAttribute('data-incident');
    row.setAttribute('data-focus', 'true');
    row.focus();
  }

  function clearRowFocus() {
    var el = document.querySelector('tr[data-focus="true"]');
    if (el) el.removeAttribute('data-focus');
  }

  // ---- Keyboard triage: J, K, X, A, R alone, Home and End ----
  function onTableKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    var tbody = document.getElementById('incident-rows');
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;
    var current = document.querySelector('tr[data-focus="true"]');
    var idx = current ? rows.indexOf(current) : 0;
    switch (e.key) {
      case 'j':
        if (idx < rows.length - 1) { clearRowFocus(); setRowFocus(rows[idx + 1]); }
        e.preventDefault();
        break;
      case 'k':
        if (idx > 0) { clearRowFocus(); setRowFocus(rows[idx - 1]); }
        e.preventDefault();
        break;
      case 'Home':
        clearRowFocus();
        setRowFocus(rows[0]);
        rows[0].scrollIntoView({ block: 'start' });
        e.preventDefault();
        break;
      case 'End':
        clearRowFocus();
        setRowFocus(rows[rows.length - 1]);
        rows[rows.length - 1].scrollIntoView({ block: 'end' });
        e.preventDefault();
        break;
      case 'x': {
        var id = current.getAttribute('data-incident');
        var box = current.querySelector('input[type="checkbox"]');
        if (box) {
          box.checked = !box.checked;
          if (box.checked) current.setAttribute('aria-selected', 'true');
          else current.removeAttribute('aria-selected');
        }
        e.preventDefault();
        break;
      }
      case 'a':
        bulkAction('acknowledge');
        e.preventDefault();
        break;
      case 'r':
        openResolveDialog();
        e.preventDefault();
        break;
    }
  }

  function selectedIds() {
    var ids = [];
    var tbody = document.getElementById('incident-rows');
    if (!tbody) return ids;
    var boxes = tbody.querySelectorAll('input[type="checkbox"]:checked');
    for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].getAttribute('data-select'));
    return ids;
  }

  function bulkAction(action) {
    var ids = selectedIds();
    var focused = document.querySelector('tr[data-focus="true"]');
    if (ids.length === 0 && focused) {
      // A acts on the focused row when none is selected.
      var box = focused.querySelector('input[type="checkbox"]');
      if (box) ids = [box.getAttribute('data-select')];
    }
    if (ids.length === 0) return;
    api('POST', '/api/incidents/bulk', { action: action, ids: ids }, function (err, res) {
      var region = document.getElementById('bulk-results');
      if (!region) return;
      // Each row reports its own result, one line per row in row order.
      var lines = [];
      (res.body.results || []).forEach(function (r) {
        if (r.status === 'ok') {
          lines.push('#' + r.number + ' ' + (action === 'acknowledge' ? 'acknowledged.' : 'resolved.'));
        } else {
          lines.push('#' + r.number + ': Already ' + r.decision + ' by ' + (r.decided_by || 'Switchlamp') + '.');
        }
      });
      region.textContent = lines.join('\n');
      lines.forEach(announce);
      loadIncidents(true);
    });
  }

  function openResolveDialog() {
    var dlg = document.getElementById('resolve-dialog');
    if (!dlg) return;
    dlg.setAttribute('data-opener', state.focusRow || '');
    dlg.showModal();
    var ok = dlg.querySelector('button[value="confirm"]');
    if (ok) ok.focus();
  }

  // ---- Filters in the address ----
  function applyFilter(status, service) {
    var params = new URLSearchParams(location.search);
    if (status !== null) params.set('status', status);
    if (service !== null) params.set('service', service);
    // A new history entry, so reload, Back and a pasted link show it.
    history.pushState({}, '', location.pathname + '?' + params.toString());
    loadIncidents();
  }

  function localTime(iso) {
    if (!iso) return '';
    var zone = document.body.dataset.zone || 'UTC';
    try {
      return new Date(iso).toLocaleString('sv-SE', { timeZone: zone, hour12: false }).replace('T', ' ');
    } catch (e) {
      return iso;
    }
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- Notices for you ----
  function updateNotices() {
    api('GET', '/api/incidents?status=triggered&limit=100', undefined, function (err, res) {
      var el = document.getElementById('notices');
      if (!el || err || !res || res.status !== 200) return;
      var me = document.body.dataset.user || '';
      var count = (res.body.items || []).filter(function (i) {
        return (i.holders || []).some(function (h) { return h.id === me; });
      }).length;
      el.textContent = count + ' incidents need you';
    });
  }

  // ---- Schedule page ----
  function refreshSchedule() {
    var body = document.getElementById('schedule-body');
    if (!body) return;
    var from = body.dataset.from;
    var to = body.dataset.to;
    var zone = body.dataset.zone;
    api('GET', '/api/schedules/' + body.dataset.schedule + '/final?from=' + from + '&to=' + to + '&zone=' + zone, undefined, function (err, res) {
      if (err || !res || res.status !== 200) return;
      renderSchedule(body, res.body);
    });
  }

  function renderSchedule(el, data) {
    var from = new Date(data.from).getTime();
    var to = new Date(data.to).getTime();
    var total = to - from;
    var layers = '';
    // Layer rows with the final row last.
    (data.layers || []).forEach(function (layer) {
      layers += '<div class="shift-row"><span class="layer-name">' + esc(layer.name) + '</span>' +
        blocksHTML(layer.blocks, from, total) + '</div>';
    });
    layers += '<div class="shift-row" id="final-row"><span class="layer-name">Final</span>' +
      blocksHTML(data.blocks, from, total) + '</div>';
    // Day bands measure to scale: a 25-hour day reads wider.
    var days = '';
    (data.days || []).forEach(function (d) {
      var w = ((new Date(d.end) - new Date(d.start)) / total) * 100;
      days += '<div class="day-band" data-date="' + d.date + '" data-minutes="' + d.minutes + '" style="grid-template-columns:' + w + '%">' +
        '<span class="day-label">' + d.date + ' <span class="hint">' + d.minutes + ' min</span></span></div>';
    });
    el.innerHTML = '<div class="schedule-grid"><div class="day-column">' + days + '</div><div class="layer-column">' + layers + '</div></div>';
    attachCutHandlers();
  }

  function blocksHTML(blocks, from, total) {
    var out = '';
    (blocks || []).forEach(function (b) {
      var left = ((new Date(b.start) - from) / total) * 100;
      var w = (b.minutes / (total / 60000)) * 100;
      var name = b.person ? b.person.name : 'Nobody';
      var cls = 'block' + (b.source === 'override' ? ' override' : '') + (b.gap ? ' gap' : '');
      out += '<span class="' + cls + '" data-start="' + b.start + '" data-end="' + b.end + '" data-person="' + esc(name) +
        '" data-source="' + b.source + '" data-minutes="' + b.minutes + '" style="left:' + left + '%;width:' + w + '%">' +
        esc(name) + '</span>';
    });
    return out;
  }

  // ---- Handoff Cut by pointer ----
  function attachCutHandlers() {
    var finalRow = document.getElementById('final-row');
    if (!finalRow) return;
    finalRow.addEventListener('pointerdown', onCutPointerDown);
  }

  function snapToStep(x, rect) {
    // The anchor snaps to the nearest 15-minute step; halfway takes the later.
    var pct = (x - rect.left) / rect.width;
    return Math.round(pct * 96) / 96;
  }

  function onCutPointerDown(e) {
    var row = e.currentTarget;
    if (!row || e.button !== 0) return;
    var rect = row.getBoundingClientRect();
    state.cut = { row: row, rect: rect, anchor: snapToStep(e.clientX, rect), edge: null, active: true };
    row.setPointerCapture(e.pointerId);
    row.addEventListener('pointermove', onCutPointerMove);
    row.addEventListener('pointerup', onCutPointerUp);
    e.preventDefault();
  }

  function onCutPointerMove(e) {
    var cut = state.cut;
    if (!cut) return;
    var pct = snapToStep(e.clientX, cut.rect);
    // The block's free edge moves from step to step, on either side.
    var edge = pct >= cut.anchor ? pct : pct;
    cut.edge = edge;
    drawCut(cut, edge);
  }

  function drawCut(cut, edge) {
    // The tab rides the free edge reading Ends <HH:MM>, <h> h <m> min.
    var tab = document.getElementById('cut-tab');
    if (!tab) {
      tab = document.createElement('div');
      tab.id = 'cut-tab';
      tab.className = 'cut-tab';
      tab.setAttribute('role', 'status');
      cut.row.appendChild(tab);
    }
    var startPct = Math.min(cut.anchor, edge) * 100;
    var widthPct = Math.abs(edge - cut.anchor) * 100;
    tab.style.left = (edge * 100) + '%';
    var body = document.getElementById('schedule-body');
    var fromMs = new Date(body.dataset.from).getTime();
    var toMs = new Date(body.dataset.to).getTime();
    var edgeMs = fromMs + (edge * (toMs - fromMs));
    var mins = Math.round((edge - cut.anchor) * (toMs - fromMs) / 60000);
    tab.textContent = 'Ends ' + localClock(edgeMs) + ', ' + lengthText(Math.abs(mins));
    // Cut preview shows the running result.
    previewCut(Math.min(cut.anchor, edge), Math.max(cut.anchor, edge));
  }

  function localClock(ms) {
    var zone = document.body.dataset.zone || 'UTC';
    var d = new Date(ms);
    try {
      return d.toLocaleTimeString('sv-SE', { timeZone: zone, hour12: false }).slice(0, 5);
    } catch (e) { return d.toISOString().slice(11, 16); }
  }

  function lengthText(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h > 0) return h + ' h ' + m + ' min';
    return m + ' min';
  }

  function previewCut(fromPct, toPct) {
    var body = document.getElementById('schedule-body');
    var fromMs = new Date(body.dataset.from).getTime();
    var toMs = new Date(body.dataset.to).getTime();
    var start = new Date(fromMs + fromPct * (toMs - fromMs)).toISOString();
    var end = new Date(fromMs + toPct * (toMs - fromMs)).toISOString();
    var person = (document.getElementById('cut-for') || {}).value || '';
    api('POST', '/api/schedules/' + body.dataset.schedule + '/overrides/preview',
      { person_id: person || null, start: start, end: end }, function (err, res) {
        var region = document.getElementById('cut-preview');
        if (!region) return;
        if (err || !res || res.status !== 200) return;
        region.textContent = res.body.summary || '';
      });
  }

  function onCutPointerUp(e) {
    var cut = state.cut;
    if (!cut) return;
    cut.row.removeEventListener('pointermove', onCutPointerMove);
    cut.row.removeEventListener('pointerup', onCutPointerUp);
    var body = document.getElementById('schedule-body');
    var fromMs = new Date(body.dataset.from).getTime();
    var toMs = new Date(body.dataset.to).getTime();
    // Releasing on the anchor step cancels and restores the prior blocks.
    if (cut.edge === null || cut.edge === cut.anchor) {
      cancelCut();
      return;
    }
    var start = new Date(fromMs + Math.min(cut.anchor, cut.edge) * (toMs - fromMs)).toISOString();
    var end = new Date(fromMs + Math.max(cut.anchor, cut.edge) * (toMs - fromMs)).toISOString();
    var person = (document.getElementById('cut-for') || {}).value || null;
    api('POST', '/api/schedules/' + body.dataset.schedule + '/overrides',
      { person_id: person, start: start, end: end }, function (err, res) {
        if (!res || res.status !== 201) {
          // A refused cut settles back and announces the reason.
          if (res && res.body && res.body.message) announce(res.body.message);
          cancelCut();
          return;
        }
        announce('Override saved.');
        refreshSchedule();
      });
    state.cut = null;
  }

  function cancelCut() {
    var tab = document.getElementById('cut-tab');
    if (tab) tab.remove();
    var region = document.getElementById('cut-preview');
    if (region) region.textContent = '';
    state.cut = null;
    refreshSchedule();
  }

  // Handoff Cut by keyboard: the cursor starts at the latest step at or before
  // the server clock's present.
  function attachCutKeyboard() {
    var group = document.getElementById('final-row');
    if (!group) return;
    group.setAttribute('tabindex', '0');
    group.addEventListener('keydown', function (e) {
      var body = document.getElementById('schedule-body');
      var fromMs = new Date(body.dataset.from).getTime();
      var toMs = new Date(body.dataset.to).getTime();
      var stepMs = (toMs - fromMs) / 96;
      if (!state.kbCut) {
        // The cursor starts inside the range at the present.
        var nowMs = Date.now();
        var pct = (nowMs - fromMs) / (toMs - fromMs);
        if (pct < 0 || pct >= 1) pct = 0;
        state.kbCut = { cursor: Math.floor(pct * 96) / 96 };
      }
      var k = state.kbCut;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var delta = e.key === 'ArrowRight' ? 1 / 96 : -1 / 96;
        if (k.anchor === undefined) {
          k.cursor = Math.max(0, Math.min(1, k.cursor + delta));
        } else {
          k.edge = Math.max(0, Math.min(1, (k.edge === undefined ? k.anchor : k.edge) + delta));
          drawKeyboardCut(k);
        }
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (k.anchor === undefined) { k.anchor = k.cursor; }
        else {
          commitKeyboardCut(k);
        }
        e.preventDefault();
      } else if (e.key === 'Escape') {
        state.kbCut = null;
        cancelCut();
        e.preventDefault();
      }
    });
  }

  function drawKeyboardCut(k) {
    var cut = state.cut;
    if (!cut) {
      var row = document.getElementById('final-row');
      state.cut = { row: row, rect: row.getBoundingClientRect(), anchor: k.anchor, edge: k.edge };
    } else {
      state.cut.anchor = k.anchor;
      state.cut.edge = k.edge;
    }
    drawCut(state.cut, k.edge);
  }

  function commitKeyboardCut(k) {
    var body = document.getElementById('schedule-body');
    var fromMs = new Date(body.dataset.from).getTime();
    var toMs = new Date(body.dataset.to).getTime();
    var start = new Date(fromMs + Math.min(k.anchor, k.edge) * (toMs - fromMs)).toISOString();
    var end = new Date(fromMs + Math.max(k.anchor, k.edge) * (toMs - fromMs)).toISOString();
    var person = (document.getElementById('cut-for') || {}).value || null;
    api('POST', '/api/schedules/' + body.dataset.schedule + '/overrides',
      { person_id: person, start: start, end: end }, function (err, res) {
        if (!res || res.status !== 201) {
          if (res && res.body && res.body.message) announce(res.body.message);
        } else {
          announce('Override saved.');
        }
        state.kbCut = null;
        cancelCut();
      });
  }

  // ---- Status page: polls with its ETag every 5 seconds ----
  var statusETag = null;
  function refreshStatus() {
    if (!document.body.dataset.page) return;
    var headers = {};
    if (statusETag) headers['If-None-Match'] = statusETag;
    fetch('/api/status', { headers: headers }).then(function (r) {
      if (r.status === 304) return null;
      statusETag = r.headers.get('ETag');
      return r.json();
    }).then(function (body) {
      if (!body) return;
      renderStatusBody(body);
    }).catch(function () {});
  }

  function renderStatusBody(body) {
    var headline = document.querySelector('[aria-label="Current status"]');
    if (headline) headline.textContent = body.headline;
    var list = document.getElementById('services');
    if (list) {
      list.innerHTML = (body.services || []).map(function (s) {
        return '<li>' + esc(s.name) + ' <span class="word">' + esc(s.status) + '</span></li>';
      }).join('');
    }
    var frame = document.querySelector('.plate-frame');
    if (frame) {
      var img = frame.querySelector('img');
      var want = '/static/img/plate-' + body.plate + '.png';
      var altWant = body.plate === 'night' ? 'Freight yard at night' : 'Freight yard at dusk';
      if (img && (img.getAttribute('src') !== want || img.alt !== altWant)) {
        var next = img.cloneNode();
        next.setAttribute('src', want);
        next.alt = altWant;
        next.setAttribute('aria-hidden', 'false');
        img.setAttribute('aria-hidden', 'true');
        img.after(next);
        img.hidden = true;
        frame.dataset.plate = body.plate;
      }
    }
  }

  // ---- Analytics ----
  function handleAnalyticsMessage(data) {
    var bar = document.getElementById('analytics-progress');
    if (!bar) return;
    bar.max = data.total || bar.max;
    // Progress never goes back.
    bar.value = Math.max(bar.value || 0, data.done || 0);
    if (data.state === 'done') {
      var params = new URLSearchParams(location.search);
      if (params.get('job') === data.job_id) loadAnalyticsJob(data.job_id);
    }
  }

  function loadAnalyticsJob(id) {
    api('GET', '/api/analytics/jobs/' + id, undefined, function (err, res) {
      if (err || !res || res.status !== 200) return;
      var bar = document.getElementById('analytics-progress');
      if (bar) { bar.max = res.body.total; bar.value = res.body.done; }
      var tbody = document.querySelector('#measures tbody');
      if (tbody && res.body.rows) {
        var html = '';
        res.body.rows.forEach(function (r) {
          html += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.kind) + '</td><td>' + r.incidents +
            '</td><td>' + esc(r.mtta_minutes) + '</td><td>' + esc(r.mttr_minutes) + '</td></tr>';
        });
        if (res.body.overall) {
          html += '<tr><td>All services</td><td></td><td>' + res.body.overall.incidents +
            '</td><td>' + esc(res.body.overall.mtta_minutes) + '</td><td>' + esc(res.body.overall.mttr_minutes) + '</td></tr>';
        }
        tbody.innerHTML = html;
        var fig = document.getElementById('overall-mtta');
        if (fig && res.body.overall) fig.textContent = res.body.overall.mtta_minutes;
      }
      var dl = document.getElementById('download-csv');
      if (dl) dl.setAttribute('href', '/api/analytics/jobs/' + id + '/download');
    });
  }

  // ---- Init per page ----
  document.addEventListener('DOMContentLoaded', function () {
    var path = location.pathname;
    // Sign-in.
    var form = document.getElementById('signin');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        api('POST', '/api/session', {
          email: form.querySelector('#email').value,
          password: form.querySelector('#password').value
        }, function (err, res) {
          if (res && res.status === 200) { location.href = '/oncall'; return; }
          problems('That email and password do not match.');
        });
      });
    }
    // The status page polls with its ETag every 5 seconds and opens no socket.
    if (document.body.dataset.page === 'status') {
      refreshStatus();
      setInterval(refreshStatus, 5000);
      var sub = document.getElementById('subscribe');
      if (sub) {
        sub.addEventListener('submit', function (e) {
          e.preventDefault();
          api('POST', '/api/status/subscribers', { email: sub.querySelector('#sub-email').value }, function (err, res) {
            if (res && res.status === 201) {
              var p = document.createElement('p');
              p.textContent = 'You are subscribed to status updates.';
              sub.after(p);
            } else if (res && res.body && res.body.errors) {
              problems(res.body.errors.email || '');
            }
          });
        });
      }
      return;
    }
    // Signed-in pages open exactly one socket.
    if (document.querySelector('nav.main-nav')) {
      connectSocket();
      setInterval(tickCountdowns, 250);
      setInterval(updateNotices, 5000);
    }
    if (path === '/incidents') {
      loadIncidents();
      var sf = document.getElementById('status-filter');
      if (sf) sf.addEventListener('change', function () { applyFilter(sf.value, null); });
      var vf = document.getElementById('service-filter');
      if (vf) vf.addEventListener('change', function () { applyFilter(null, vf.value); });
      var table = document.getElementById('incident-table');
      if (table) table.addEventListener('keydown', onTableKey);
      var older = document.getElementById('older');
      if (older) older.addEventListener('click', function () { /* paging in place */ });
      var newer = document.getElementById('newer');
      if (newer) newer.addEventListener('click', function () { /* paging in place */ });
      var showNew = document.getElementById('show-new');
      if (showNew) showNew.addEventListener('click', function () {
        // Its use moves to the first page with them on top.
        history.replaceState({}, '', location.pathname);
        state.newIncidents = 0;
        showNew.hidden = true;
        loadIncidents();
      });
      var save = document.getElementById('save-filter');
      if (save) save.addEventListener('click', function () {
        var params = new URLSearchParams(location.search);
        api('POST', '/api/me/saved-filters', {
          name: document.getElementById('filter-name').value,
          status: params.get('status') || 'open',
          service_id: params.get('service') || null
        }, function (err, res) {
          if (res && res.status === 201) announce('Filter saved.');
          loadSavedFilters();
        });
      });
      loadSavedFilters();
    }
    if (path.indexOf('/incidents/') === 0) {
      initIncidentPage();
    }
    if (path.indexOf('/schedules/') === 0) {
      refreshSchedule();
      attachCutKeyboard();
      var vz = document.getElementById('view-zone');
      if (vz) vz.addEventListener('change', function () {
        var params = new URLSearchParams(location.search);
        params.set('zone', vz.value);
        history.pushState({}, '', location.pathname + '?' + params.toString());
        var body = document.getElementById('schedule-body');
        body.dataset.zone = vz.value;
        refreshSchedule();
        vz.focus();
      });
      var rs = document.getElementById('range-start');
      if (rs) rs.addEventListener('change', function () {
        var params = new URLSearchParams(location.search);
        params.set('from', rs.value);
        history.pushState({}, '', location.pathname + '?' + params.toString());
        location.reload();
      });
    }
    if (path.indexOf('/policies/') === 0) initPolicyEditor();
    if (path === '/analytics') {
      var params = new URLSearchParams(location.search);
      var job = params.get('job');
      var from = params.get('from');
      var to = params.get('to');
      if (from) document.getElementById('from').value = from;
      if (to) document.getElementById('to').value = to;
      if (job) loadAnalyticsJob(job);
      else {
        api('POST', '/api/analytics/jobs', { from: from || '', to: to || '' }, function (err, res) {
          if (!res) return;
          var id = res.body.id;
          var p = new URLSearchParams(location.search);
          p.set('job', id);
          history.replaceState({}, '', location.pathname + '?' + p.toString());
          loadAnalyticsJob(id);
        });
      }
      var run = document.getElementById('run-analytics');
      if (run) run.addEventListener('click', function () {
        api('POST', '/api/analytics/jobs', {
          from: document.getElementById('from').value,
          to: document.getElementById('to').value
        }, function (err, res) {
          if (!res) return;
          var p = new URLSearchParams(location.search);
          p.set('job', res.body.id);
          p.set('from', document.getElementById('from').value);
          p.set('to', document.getElementById('to').value);
          history.replaceState({}, '', location.pathname + '?' + p.toString());
          loadAnalyticsJob(res.body.id);
        });
      });
    }
    if (path === '/integrations') initIntegrations();
    if (path.indexOf('/integrations/') === 0) initIntegrationPage();
    if (path === '/admin') initAdmin();
    if (path === '/me') initMe();
    if (path === '/maintenance') initMaintenance();
    if (path === '/status-desk') initStatusDesk();
  });

  function loadSavedFilters() {
    var ul = document.getElementById('saved-filters');
    if (!ul) return;
    api('GET', '/api/me/saved-filters', undefined, function (err, res) {
      if (err || !res || res.status !== 200) return;
      state.savedFilters = res.body.items || [];
      var html = '';
      state.savedFilters.forEach(function (f) {
        var href = '/incidents?status=' + encodeURIComponent(f.status) +
          (f.service_id ? '&service=' + encodeURIComponent(f.service_id) : '');
        html += '<li><a href="' + href + '">' + esc(f.name) + '</a> <button data-remove-filter="' + f.id + '">Remove ' + esc(f.name) + '</button></li>';
      });
      ul.innerHTML = html;
    });
  }

  // ---- Incident page ----
  function initIncidentPage() {
    var id = location.pathname.split('/')[2];
    var countdownEl = document.getElementById('incident-countdown');
    if (countdownEl) {
      registerCountdown(countdownEl, function () {
        var field = document.querySelector('.holder-field');
        var remaining = field ? parseInt(field.getAttribute('data-remaining-seconds') || '0', 10) : 0;
        return remaining;
      });
      // The remaining seconds tick down between server values.
      setInterval(function () {
        var field = document.querySelector('.holder-field');
        if (!field) return;
        var cur = parseInt(field.getAttribute('data-remaining-seconds') || '0', 10);
        if (cur > 0) field.setAttribute('data-remaining-seconds', String(cur - 1));
      }, 1000);
    }
    var ack = document.getElementById('ack-btn');
    if (ack) ack.addEventListener('click', function () {
      busy(ack, function () {
        api('POST', '/api/incidents/' + id + '/acknowledge', {}, function (err, res) {
          if (res && res.status === 200) location.reload();
          else if (res && res.body && res.body.error === 'already_decided') {
            announce('Already acknowledged by ' + res.body.decided_by + '.');
          }
        });
      });
    });
    var resolve = document.getElementById('resolve-btn');
    if (resolve) resolve.addEventListener('click', function () {
      busy(resolve, function () {
        api('POST', '/api/incidents/' + id + '/resolve', {}, function (err, res) {
          if (res && res.status === 200) location.reload();
        });
      });
    });
    var snooze = document.getElementById('snooze-btn');
    if (snooze) {
      snooze.addEventListener('click', function () {
        var dlg = document.getElementById('snooze-dialog');
        if (dlg) dlg.showModal();
      });
      var form = document.getElementById('snooze-form');
      if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        var preset = form.querySelector('input[name="preset"]:checked');
        var body = {};
        if (preset && preset.value !== 'custom') body.preset_hours = parseInt(preset.value, 10);
        else {
          var until = document.getElementById('snooze-until').value;
          body.until = until;
        }
        api('POST', '/api/incidents/' + id + '/snooze', body, function (err, res) {
          if (res && res.status === 200) location.reload();
          else if (res && res.body && res.body.errors) problems(Object.values(res.body.errors).join(' '));
        });
      });
    }
    // Note draft: saves itself about a second after typing stops.
    var note = document.getElementById('note');
    if (note) {
      var timer = null;
      note.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          api('PUT', '/api/incidents/' + id + '/note-draft', { body: note.value });
        }, 1000);
      });
      api('GET', '/api/incidents/' + id + '/note-draft', undefined, function (err, res) {
        if (res && res.status === 200 && res.body.body) note.value = res.body.body;
      });
      var add = document.getElementById('add-note');
      if (add) add.addEventListener('click', function () {
        api('POST', '/api/incidents/' + id + '/notes', { body: note.value }, function (err, res) {
          if (res && res.status === 201) {
            note.value = '';
            announce('Note added.');
            location.reload();
          }
        });
      });
    }
  }

  function busy(btn, fn) {
    if (btn.getAttribute('aria-busy') === 'true') return; // one request per double click
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    fn();
    setTimeout(function () { btn.removeAttribute('aria-busy'); btn.disabled = false; }, 400);
  }

  // ---- Policy editor by drag and keyboard ----
  function initPolicyEditor() {
    var list = document.getElementById('levels');
    if (!list) return;
    var dragged = null;
    list.addEventListener('dragstart', function (e) {
      dragged = e.target.closest('li');
    });
    list.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    list.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = e.target.closest('li');
      if (!target || !dragged || target === dragged) return;
      moveLevel(dragged, target);
    });
    // Keyboard: Space lifts, Up and Down move, Space drops, Escape restores.
    var lifted = null;
    var originalOrder = null;
    list.addEventListener('keydown', function (e) {
      var item = e.target.closest('li');
      if (!item) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (lifted === null) {
          lifted = item;
          originalOrder = listOrder();
        } else {
          lifted = null; // drop
          announce('Level moved to position ' + (Array.prototype.indexOf.call(list.children, item) + 1) + '.');
        }
      } else if (e.key === 'ArrowDown' && lifted) {
        e.preventDefault();
        var next = item.nextElementSibling;
        if (next) moveLevel(item, next);
      } else if (e.key === 'ArrowUp' && lifted) {
        e.preventDefault();
        var prev = item.previousElementSibling;
        if (prev) moveLevel(item, prev);
      } else if (e.key === 'Escape' && lifted) {
        // Escape restores the order at lift.
        e.preventDefault();
        restoreOrder(originalOrder);
        lifted = null;
      }
    });
    var save = document.getElementById('save-policy');
    if (save) save.addEventListener('click', function () {
      var levels = [];
      Array.prototype.forEach.call(list.children, function (li) {
        levels.push({
          timeout_minutes: parseInt(li.querySelector('.timeout').value, 10) || 30,
          targets: JSON.parse(li.getAttribute('data-targets') || '[]')
        });
      });
      var form = document.getElementById('policy-form');
      api('PUT', '/api/policies/' + form.dataset.policy, {
        name: form.dataset.name || '',
        repeats: parseInt(document.getElementById('repeats').value, 10) || 0,
        levels: levels
      }, function (err, res) {
        if (res && res.status === 200) announce('Saved.');
      });
    });
  }

  function listOrder() {
    var list = document.getElementById('levels');
    return Array.prototype.map.call(list.children, function (li) { return li; });
  }

  function moveLevel(from, to) {
    var list = document.getElementById('levels');
    var pos = Array.prototype.indexOf.call(list.children, to);
    list.insertBefore(from, to.nextSibling);
    // Each move announces the new position, and focus stays on the handle.
    announce('Level moved to position ' + (Array.prototype.indexOf.call(list.children, from) + 1) + '.');
    relabelLevels();
  }

  function restoreOrder(items) {
    var list = document.getElementById('levels');
    items.forEach(function (li) { list.appendChild(li); });
    relabelLevels();
  }

  function relabelLevels() {
    var list = document.getElementById('levels');
    Array.prototype.forEach.call(list.children, function (li, i) {
      li.setAttribute('data-level', String(i + 1));
      li.querySelector('.handle').setAttribute('aria-label', 'Move level ' + (i + 1));
      var t = li.querySelector('.timeout');
      if (t) t.setAttribute('aria-label', 'Timeout for level ' + (i + 1));
    });
  }

  // ---- Integration page ----
  function initIntegrationPage() {
    var id = location.pathname.split('/')[2];
    function refresh() {
      api('GET', '/api/integrations/' + id, undefined, function (err, res) {
        if (err || !res || res.status !== 200) return;
        var counter = res.body.counter || {};
        var el = document.getElementById('events-this-minute');
        if (el) {
          var count = counter.count === null || counter.count === undefined ? 'unavailable' : counter.count;
          el.textContent = count + ' / 120';
        }
        var ra = document.getElementById('retry-after');
        if (ra) {
          if (counter.retry_after !== null && counter.retry_after !== undefined) {
            ra.dataset.seconds = String(counter.retry_after);
            ra.textContent = counter.retry_after + ' s';
          } else {
            delete ra.dataset.seconds;
            ra.textContent = 'Accepting events';
          }
        }
      });
      api('GET', '/api/integrations/' + id + '/events?limit=50', undefined, function (err, res) {
        if (err || !res || res.status !== 200) return;
        var tbody = document.querySelector('#event-log tbody');
        if (tbody) {
          tbody.innerHTML = (res.body.items || []).map(function (e) {
            return '<tr><td>' + esc(localTime(e.at)) + '</td><td>' + esc(e.action) + '</td><td class="dedup">' +
              esc(e.dedup_key || '') + '</td><td>' + esc(e.outcome) + '</td><td>' + esc(e.reason || '') +
              '</td><td>' + (e.incident_number ? '#' + e.incident_number : '') + '</td></tr>';
          }).join('');
        }
      });
    }
    refresh();
    setInterval(refresh, 1000);
  }

  function initIntegrations() {
    api('GET', '/api/dead-letters', undefined, function (err, res) {
      if (err || !res || res.status !== 200) return;
      var p = document.querySelector('.empty');
      var items = res.body.items || [];
      if (items.length === 0) return;
      if (p) p.hidden = true;
    });
  }

  function initAdmin() {
    var advance = document.getElementById('advance-clock');
    if (advance) advance.addEventListener('click', function () {
      var secs = parseInt(document.getElementById('advance-seconds').value, 10) || 0;
      api('POST', '/api/operator/clock', { advance_seconds: secs }, function (err, res) {
        if (res && res.status === 200) announce('Clock moved to ' + res.body.now + '.');
      });
    });
  }

  function initMe() {
    var save = document.querySelector('#me-form button[type="submit"]');
    var form = document.getElementById('me-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var tz = document.getElementById('timezone');
      api('PATCH', '/api/me', {
        timezone: tz ? tz.value : undefined,
        quiet_start: document.getElementById('quiet-start').value || null,
        quiet_end: document.getElementById('quiet-end').value || null,
        notification_delays: document.getElementById('delays').value.split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); }),
        low_urgency_delay: parseInt(document.getElementById('low-delay').value, 10) || 0
      }, function (err, res) {
        if (res && res.status === 200) announce('Saved.');
        else if (res && res.body && res.body.errors) problems(Object.values(res.body.errors).join(' '));
      });
    });
    var create = document.getElementById('create-calendar');
    if (create) create.addEventListener('click', function () {
      api('POST', '/api/me/calendar-token', {}, function (err, res) {
        if (res && res.status === 201) {
          document.getElementById('calendar-url').textContent = res.body.url;
          document.getElementById('regen-calendar').hidden = false;
          document.getElementById('revoke-calendar').hidden = false;
          create.hidden = true;
        }
      });
    });
  }

  function initMaintenance() {
    var form = document.getElementById('window-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var zone = document.body.dataset.zone || 'America/Chicago';
      var starts = toInstant(document.getElementById('window-start').value, zone);
      var ends = toInstant(document.getElementById('window-end').value, zone);
      api('POST', '/api/maintenance-windows', {
        service_id: document.getElementById('window-service').value,
        starts_at: starts, ends_at: ends
      }, function (err, res) {
        if (res && res.status === 201) location.reload();
        else if (res && res.body && res.body.errors) problems(Object.values(res.body.errors).join(' '));
      });
    });
  }

  function toInstant(text, zone) {
    if (!text) return '';
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return '';
    // The 24-hour clock in the given zone.
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
  }

  function initStatusDesk() {
    var save = document.getElementById('save-draft');
    var publish = document.getElementById('publish-update');
    var read = function () {
      var state = document.getElementById('update-state');
      return {
        title: document.getElementById('update-title').value,
        body: document.getElementById('update-body').value,
        state: state ? state.value.toLowerCase() : 'investigating',
        service_ids: Array.prototype.map.call(document.querySelectorAll('#update-form fieldset input:checked'), function (c) { return c.value; })
      };
    };
    var existing = null;
    if (save) save.addEventListener('click', function () {
      var payload = read();
      if (existing) {
        api('PUT', '/api/status-updates/' + existing, payload, function (err, res) { if (res && res.status === 200) announce('Saved.'); });
      } else {
        api('POST', '/api/status-updates', payload, function (err, res) {
          if (res && res.status === 201) { existing = res.body.id; announce('Saved.'); }
        });
      }
    });
    if (publish) publish.addEventListener('click', function () {
      var payload = read();
      var send = function (id) {
        api('POST', '/api/status-updates/' + id + '/publish', {}, function (err, res) {
          if (res && res.status === 200) {
            announce('Published. Notices to ' + (res.body.subscribers || 0) + ' subscribers are on their way.');
            location.reload();
          }
        });
      };
      if (existing) send(existing);
      else api('POST', '/api/status-updates', payload, function (err, res) {
        if (res && res.status === 201) { existing = res.body.id; send(existing); }
      });
    });
  }

  function handleIncidentMessage(data) {
    if (data.announce) announce(data.announce);
    if (location.pathname === '/incidents') {
      // A new matching incident never shifts the rows on view.
      state.newIncidents += 1;
      var btn = document.getElementById('show-new');
      if (btn) {
        btn.hidden = false;
        document.getElementById('new-count').textContent = String(state.newIncidents);
      }
      // The total updates at every arrival within a second.
      api('GET', '/api/incidents?status=' + (new URLSearchParams(location.search).get('status') || 'open'), undefined, function (err, res) {
        if (res && res.status === 200) {
          var el = document.getElementById('incident-total');
          if (el) el.childNodes[0].textContent = String(res.body.total || 0);
        }
      });
    } else if (location.pathname.indexOf('/incidents/') === 0) {
      location.reload();
    }
  }
})();
