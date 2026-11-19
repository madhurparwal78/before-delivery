/* The console table page: rows load in place, the address carries the view, the sort and the page, the later change
   wins, an amendment shows at once and rolls back when refused. */
(function () {
  'use strict';
  var K = window.Keystone;
  var boot = JSON.parse(document.getElementById('boot').textContent);
  var slug = boot.slug;
  var columns = boot.columns;
  var PER_PAGE = 100;
  var panel = document.getElementById('table-panel');
  var pickView = document.getElementById('pick-view');
  var pickSort = document.getElementById('pick-sort');
  var prev = document.getElementById('prev-page');
  var next = document.getElementById('next-page');
  var summary = document.getElementById('row-summary');
  var where = document.getElementById('page-where');
  var SKELETON = '<div class="skeleton" id="skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  var EMPTY = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M9.5 5v14"/></svg><p>No rows match this view yet.</p></div>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
  var ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>';

  var state = { view: '', sort: '', page: 1, views: [], rows: new Map(), total: 0, seq: 0 };
  var live = { count: boot.count, allowance: boot.allowance, tier: boot.tier, locked: boot.lockedPeriod };
  var refusalHolds = false;

  /* ---- the address carries the table's state --------------------------------------------------------------- */
  function readAddress() {
    var q = new URLSearchParams(window.location.search);
    return { view: q.get('view') || '', sort: q.get('sort') || '', page: Math.max(1, parseInt(q.get('page') || '1', 10) || 1) };
  }
  function writeAddress() {
    var q = new URLSearchParams();
    if (state.view) { q.set('view', state.view); }
    if (state.sort) { q.set('sort', state.sort); }
    if (state.page > 1) { q.set('page', String(state.page)); }
    var text = q.toString();
    window.history.pushState({}, '', window.location.pathname + (text ? '?' + text : ''));
  }

  /* ---- banners: the lock banner, the allowance notice; a refusal notice makes both stand aside --------------------- */
  var lockBanner = document.getElementById('lock-banner');
  var allowanceNotice = document.getElementById('allowance-notice');
  function renderBanners() {
    var locked = !!live.locked;
    var near = live.count * 5 >= live.allowance * 4;
    var full = live.count >= live.allowance;
    lockBanner.hidden = refusalHolds || !locked;
    if (locked) {
      lockBanner.innerHTML = '<div class="row">' + ICON_LOCK + '<p>Locked for ' + K.escape(live.locked) + '. Amendments are refused until a steward unlocks it.</p></div>';
    }
    allowanceNotice.hidden = refusalHolds || locked || !near;
    allowanceNotice.className = 'notice ' + (full ? 'refuse' : 'caution');
    if (near) {
      var text = full
        ? live.count + ' of ' + live.allowance + ' rows used. New rows are refused on the ' + live.tier + ' tier.'
        : live.count + ' of ' + live.allowance + ' rows used on the ' + live.tier + ' tier';
      var existing = allowanceNotice.querySelector('p');
      if (!existing || existing.textContent !== text) {
        allowanceNotice.innerHTML = '<div class="row">' + ICON_ALERT + '<p>' + K.escape(text) + '</p></div>';
      }
    }
  }
  K.onRefusal = function (on) { refusalHolds = on; renderBanners(); };
  function refreshMeta() {
    return K.api('/api/tables/' + encodeURIComponent(slug)).then(function (res) {
      if (!res.ok) { return; }
      live.count = res.data.count;
      live.allowance = res.data.row_allowance;
      live.tier = res.data.tier;
      live.locked = res.data.locked_period;
      renderBanners();
    });
  }

  /* ---- cells and rows ----------------------------------------------------------------------------------------- */
  function format(col, value) {
    if (value === null || value === undefined || value === '') { return ''; }
    if (col.type === 'flag') { return value ? 'Yes' : 'No'; }
    if (col.type === 'decimal') { return Number(value).toFixed(2); }
    return String(value);
  }
  function numeric(col) { return col.type === 'integer' || col.type === 'decimal'; }
  function cellsHtml(values) {
    return columns.map(function (col, index) {
      var text = K.escape(format(col, values[col.caption]));
      if (index === 0) { return '<th scope="row">' + text + '</th>'; }
      return '<td' + (numeric(col) ? ' class="num"' : '') + '>' + text + '</td>';
    }).join('');
  }
  function rowHtml(row, index) {
    var actions = boot.canEdit ? '<td class="actions"><button type="button" class="btn btn-small" data-edit="' + row.id + '">Edit row</button></td>' : '';
    return '<tr data-id="' + row.id + '" data-staged style="--i:' + index + '">' + cellsHtml(row.values) + actions + '</tr>';
  }
  function tableHtml(rows) {
    var head = columns.map(function (col, index) {
      return '<th scope="col"' + (numeric(col) && index > 0 ? ' class="num"' : '') + '>' + K.escape(col.caption) + '</th>';
    }).join('') + (boot.canEdit ? '<th scope="col"><span class="visually-hidden">Actions</span></th>' : '');
    return '<table class="data"><caption class="visually-hidden">' + K.escape(boot.name) + '</caption><thead><tr>' + head +
      '</tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>';
  }
  function rowElement(id) { return panel.querySelector('tr[data-id="' + id + '"]'); }
  function paintCells(tr, values) {
    var holder = document.createElement('table');
    holder.innerHTML = '<tbody><tr>' + cellsHtml(values) + '</tr></tbody>';
    var fresh = holder.querySelectorAll('tr > *');
    for (var i = 0; i < fresh.length; i += 1) { tr.children[i].textContent = fresh[i].textContent; }
  }
  function mark(tr, name) {
    tr.classList.remove('is-flash', 'is-return');
    void tr.offsetWidth;
    tr.classList.add(name);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.setTimeout(function () { tr.classList.remove(name); }, 480);
    }
  }
  function referenceOf(row) {
    var col = columns.find(function (c) { return c.caption === 'Reference'; }) || columns[0];
    return row.values[col.caption];
  }

  /* ---- loading rows: the later change wins ------------------------------------------------------------------------ */
  function showLoading() {
    panel.setAttribute('aria-busy', 'true');
    panel.innerHTML = SKELETON;
  }
  function load(after) {
    var mine = ++state.seq;
    showLoading();
    var params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('per_page', String(PER_PAGE));
    var view = state.views.find(function (v) { return v.name === state.view; });
    if (view) { params.set('view', String(view.id)); }
    if (state.sort) { params.set('sort', state.sort); }
    return K.api('/api/tables/' + encodeURIComponent(slug) + '/rows?' + params.toString()).then(function (res) {
      if (mine !== state.seq) { return; }
      panel.setAttribute('aria-busy', 'false');
      if (!res.ok) {
        panel.innerHTML = '<div class="empty"><p>The rows could not be loaded: ' + K.escape(K.reason(res)) + '.</p></div>';
        return;
      }
      state.total = parseInt(res.headers.get('X-Total-Count') || '0', 10) || 0;
      state.rows = new Map(res.data.map(function (row) { return [String(row.id), row]; }));
      panel.innerHTML = res.data.length ? tableHtml(res.data) : EMPTY;
      panel.style.removeProperty('--reserve');
      var pages = Math.max(1, Math.ceil(state.total / PER_PAGE));
      var first = res.data.length ? (state.page - 1) * PER_PAGE + 1 : 0;
      summary.textContent = res.data.length ? 'Showing ' + first + ' to ' + (first + res.data.length - 1) + ' of ' + state.total + ' rows' : '0 rows';
      where.textContent = 'Page ' + state.page + ' of ' + pages;
      prev.disabled = state.page <= 1;
      next.disabled = state.page >= pages;
      if (after) { after(); }
    });
  }

  function syncPickers() {
    pickView.value = state.views.some(function (v) { return v.name === state.view; }) ? state.view : '';
    pickSort.value = state.sort;
  }
  function addViewOption(view) {
    pickView.appendChild(new Option(view.name, view.name));
  }

  pickView.addEventListener('change', function () {
    state.view = pickView.value;
    state.page = 1;
    writeAddress();
    var name = state.view || 'All rows';
    load(function () { K.announce('View applied: ' + name + '.', { kind: 'info' }); });
  });
  pickSort.addEventListener('change', function () {
    state.sort = pickSort.value;
    state.page = 1;
    writeAddress();
    load();
  });
  prev.addEventListener('click', function () { if (state.page > 1) { state.page -= 1; writeAddress(); load(); } });
  next.addEventListener('click', function () { state.page += 1; writeAddress(); load(); });
  window.addEventListener('popstate', function () {
    var address = readAddress();
    state.view = address.view; state.sort = address.sort; state.page = address.page;
    syncPickers();
    load();
  });

  /* ---- amending a row ----------------------------------------------------------------------------------------------- */
  function controlFor(col, value) {
    if (col.type === 'flag') {
      var box = K.input('checkbox');
      box.className = '';
      box.checked = value === true;
      return box;
    }
    if (col.type === 'choice') { return K.select(col.options || [], value || '', '—'); }
    if (col.type === 'integer') { return K.input('number', { step: '1', inputmode: 'numeric' }); }
    if (col.type === 'decimal') { return K.input('number', { step: '0.01', inputmode: 'decimal' }); }
    if (col.type === 'date') { return K.input('date'); }
    return K.input('text', { maxlength: '500' });
  }
  function fillControl(col, el, value) {
    if (col.type === 'flag' || col.type === 'choice') { return; }
    el.value = value === null || value === undefined ? '' : String(value);
  }
  function buildFields(values, touched) {
    return function (fields) {
      columns.forEach(function (col) {
        var value = values ? values[col.caption] : null;
        var control = controlFor(col, value);
        fillControl(col, control, value);
        if (col.type === 'flag') {
          var wrap = document.createElement('div');
          wrap.className = 'check';
          var lab = document.createElement('label');
          lab.textContent = col.caption;
          var id = 'flag-' + col.id;
          control.id = id;
          lab.setAttribute('for', id);
          wrap.appendChild(control);
          wrap.appendChild(lab);
          fields.appendChild(wrap);
        } else {
          fields.appendChild(K.field(col.caption, control));
        }
        control.setAttribute('data-caption', col.caption);
        ['input', 'change'].forEach(function (name) {
          control.addEventListener(name, function () { touched[col.caption] = true; });
        });
      });
    };
  }
  function readControls(form) {
    var out = {};
    columns.forEach(function (col) {
      var el = form.querySelector('[data-caption="' + col.caption.replace(/"/g, '\\"') + '"]');
      var raw = col.type === 'flag' ? el.checked : el.value;
      if (col.type === 'flag') { out[col.caption] = raw; }
      else if (raw === '') { out[col.caption] = null; }
      else if (col.type === 'integer' || col.type === 'decimal') { out[col.caption] = Number(raw); }
      else { out[col.caption] = raw; }
    });
    return out;
  }

  function openEdit(button) {
    var row = state.rows.get(button.getAttribute('data-edit'));
    if (!row) { return; }
    var version = row.version;
    var touched = {};
    K.openDialog({
      title: 'Edit row', opener: button, submitLabel: 'Save row', build: buildFields(row.values, touched),
      onSubmit: function (form, dialog) {
        var all = readControls(form);
        var changes = {};
        columns.forEach(function (col) { if (touched[col.caption]) { changes[col.caption] = all[col.caption]; } });
        dialog.close();
        if (!Object.keys(changes).length) { return; }
        return saveRow(row, changes, version);
      }
    });
  }
  function saveRow(row, changes, version) {
    var tr = rowElement(row.id);
    var previous = Object.assign({}, row.values);
    if (tr) { paintCells(tr, Object.assign({}, previous, changes)); }
    return K.api('/api/tables/' + encodeURIComponent(slug) + '/rows/' + row.id, {
      method: 'PATCH', body: { values: changes }, headers: { 'If-Match-Version': String(version) }
    }).then(function (res) {
      var live_tr = rowElement(row.id);
      if (res.ok) {
        row.values = res.data.values;
        row.version = res.data.version;
        if (live_tr) { paintCells(live_tr, row.values); mark(live_tr, 'is-flash'); }
        K.announce('Row saved: ' + referenceOf(row) + '.', { kind: 'affirm', ms: 4000 });
        return refreshMeta();
      }
      if (live_tr) { paintCells(live_tr, previous); mark(live_tr, 'is-return'); }
      K.announce('Amendment refused: ' + K.reason(res, 'The amendment was refused') + '.', { kind: 'refuse', ms: 8000 });
      if (res.status === 409 && res.data && res.data.current_version !== undefined) { return resync(row); }
    });
  }
  function resync(row) {
    return K.api('/api/tables/' + encodeURIComponent(slug) + '/rows/' + row.id).then(function (res) {
      if (!res.ok) { return; }
      row.values = res.data.values;
      row.version = res.data.version;
      var tr = rowElement(row.id);
      if (tr) { paintCells(tr, row.values); }
    });
  }

  panel.addEventListener('click', function (event) {
    var button = event.target.closest('[data-edit]');
    if (button) { openEdit(button); }
  });

  var addButton = document.getElementById('open-add-row');
  if (addButton) {
    addButton.addEventListener('click', function () {
      K.openDialog({
        title: 'Add row', opener: addButton, submitLabel: 'Save row', build: buildFields(null, {}),
        onSubmit: function (form, dialog) {
          var key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
          return K.api('/api/tables/' + encodeURIComponent(slug) + '/rows', {
            method: 'POST', body: { values: readControls(form) }, headers: { 'Idempotency-Key': key }
          }).then(function (res) {
            if (!res.ok) {
              dialog.fail(K.reason(res) + '.');
              if (res.status === 422 && res.data && /allowance/.test(res.data.field || '')) { refreshMeta(); }
              return;
            }
            dialog.close();
            K.announce('Row saved: ' + referenceOf(res.data) + '.', { kind: 'affirm', ms: 4000 });
            return refreshMeta().then(function () { return load(); });
          });
        }
      });
    });
  }

  /* ---- saved views --------------------------------------------------------------------------------------------------- */
  var OPERATORS = {
    text: ['equals', 'not equals', 'contains', 'greater than', 'less than', 'is empty'],
    integer: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
    decimal: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
    date: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
    choice: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
    flag: ['equals', 'not equals', 'is empty']
  };
  function captions() { return columns.map(function (c) { return c.caption; }); }
  function colOf(caption) { return columns.find(function (c) { return c.caption === caption; }); }

  function valueControl(col, operator) {
    if (operator === 'is empty') { return null; }
    if (col.type === 'flag') { return K.select(['true', 'false'], 'true'); }
    if (col.type === 'choice') { return K.select(col.options || [], (col.options || [])[0]); }
    if (col.type === 'integer' || col.type === 'decimal') { return K.input('number', { step: col.type === 'integer' ? '1' : '0.01' }); }
    if (col.type === 'date') { return K.input('date'); }
    return K.input('text');
  }
  function filterGroup(container) {
    var group = document.createElement('div');
    group.className = 'group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Filter');
    var row = document.createElement('div');
    row.className = 'group-row';
    var column = K.select(captions(), captions()[0]);
    var operator = document.createElement('select');
    operator.className = 'select';
    var valueSlot = document.createElement('div');
    row.appendChild(K.field('Column', column));
    row.appendChild(K.field('Operator', operator));
    row.appendChild(valueSlot);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small';
    remove.textContent = 'Remove filter';
    remove.addEventListener('click', function () { group.remove(); });
    group.appendChild(row);
    group.appendChild(remove);
    function rebuildOperators() {
      var col = colOf(column.value);
      var kept = operator.value;
      operator.innerHTML = '';
      OPERATORS[col.type].forEach(function (name) { operator.appendChild(new Option(name, name, false, name === kept)); });
      rebuildValue();
    }
    function rebuildValue() {
      var col = colOf(column.value);
      valueSlot.innerHTML = '';
      var control = valueControl(col, operator.value);
      if (control) { valueSlot.appendChild(K.field('Value', control)); }
    }
    column.addEventListener('change', rebuildOperators);
    operator.addEventListener('change', rebuildValue);
    rebuildOperators();
    container.appendChild(group);
    group.read = function () {
      var col = colOf(column.value);
      var control = valueSlot.querySelector('input, select');
      var value = null;
      if (control) {
        value = control.value;
        if (col.type === 'integer' || col.type === 'decimal') { value = value === '' ? null : Number(value); }
        if (col.type === 'flag') { value = control.value === 'true'; }
      }
      return { column: column.value, operator: operator.value, value: value };
    };
    return group;
  }
  function sortGroup(container) {
    var group = document.createElement('div');
    group.className = 'group sortg';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Sort');
    var row = document.createElement('div');
    row.className = 'group-row';
    var column = K.select(captions(), captions()[0]);
    var direction = K.select(['asc', 'desc'], 'asc');
    row.appendChild(K.field('Column', column));
    row.appendChild(K.field('Direction', direction));
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small';
    remove.textContent = 'Remove sort';
    remove.addEventListener('click', function () { group.remove(); });
    group.appendChild(row);
    group.appendChild(remove);
    container.appendChild(group);
    group.read = function () { return { column: column.value, direction: direction.value }; };
    return group;
  }

  var newView = document.getElementById('open-new-view');
  if (newView) {
    newView.addEventListener('click', function () {
      var filters = document.createElement('div');
      var sorts = document.createElement('div');
      filters.style.display = sorts.style.display = 'grid';
      filters.style.gap = sorts.style.gap = '8px';
      var name = K.input('text', { maxlength: '80' });
      var visibility = K.select(['private', 'shared'], 'private');
      K.openDialog({
        title: 'New view', opener: newView, submitLabel: 'Save view',
        build: function (fields) {
          fields.appendChild(K.field('Name', name));
          fields.appendChild(K.field('Visibility', visibility));
          fields.appendChild(filters);
          fields.appendChild(sorts);
          var buttons = document.createElement('div');
          buttons.className = 'btn-row';
          var addFilter = document.createElement('button');
          addFilter.type = 'button'; addFilter.className = 'btn'; addFilter.textContent = 'Add filter';
          addFilter.addEventListener('click', function () { filterGroup(filters); });
          var addSort = document.createElement('button');
          addSort.type = 'button'; addSort.className = 'btn'; addSort.textContent = 'Add sort';
          addSort.addEventListener('click', function () { sortGroup(sorts); });
          buttons.appendChild(addFilter);
          buttons.appendChild(addSort);
          fields.insertBefore(buttons, filters);
        },
        onSubmit: function (form, dialog) {
          var body = {
            name: name.value, visibility: visibility.value,
            filters: Array.prototype.map.call(filters.children, function (g) { return g.read(); }),
            sorts: Array.prototype.map.call(sorts.children, function (g) { return g.read(); })
          };
          return K.api('/api/tables/' + encodeURIComponent(slug) + '/views', { method: 'POST', body: body }).then(function (res) {
            if (!res.ok) { dialog.fail(K.reason(res) + '.'); return; }
            state.views.push(res.data);
            addViewOption(res.data);
            state.view = res.data.name;
            state.page = 1;
            syncPickers();
            writeAddress();
            dialog.close();
            return load(function () { K.announce('View applied: ' + res.data.name + '.', { kind: 'info' }); });
          });
        }
      });
    });
  }

  /* ---- locking a table (stewards) ---------------------------------------------------------------------------------- */
  var lockForm = document.getElementById('lock-form');
  if (lockForm) {
    var period = document.getElementById('lock-period');
    var lockError = document.getElementById('err-lock');
    var unlock = document.getElementById('unlock-send');
    var lockSend = document.getElementById('lock-send');
    var applyLock = function (table, sentence) {
      live.locked = table.locked_period;
      unlock.hidden = !table.locked_period;
      renderBanners();
      K.announce(sentence, { kind: 'info' });
    };
    lockForm.addEventListener('submit', function (event) {
      event.preventDefault();
      lockError.hidden = true;
      K.busy(lockSend, true);
      K.api('/api/tables/' + encodeURIComponent(slug) + '/lock', { method: 'POST', body: { period: period.value } }).then(function (res) {
        K.busy(lockSend, false);
        if (!res.ok) { lockError.textContent = K.reason(res) + '.'; lockError.hidden = false; return; }
        period.value = '';
        applyLock(res.data, 'Table locked for ' + res.data.locked_period + '.');
      });
    });
    unlock.addEventListener('click', function () {
      K.api('/api/tables/' + encodeURIComponent(slug) + '/lock', { method: 'DELETE' }).then(function (res) {
        if (res.ok) { applyLock(res.data, 'Table unlocked.'); }
      });
    });
  }

  /* ---- start ----------------------------------------------------------------------------------------------------------- */
  renderBanners();
  var start = readAddress();
  state.view = start.view || boot.initialView || '';
  state.sort = start.sort;
  state.page = start.page;
  K.api('/api/tables/' + encodeURIComponent(slug) + '/views').then(function (res) {
    state.views = res.ok ? res.data : [];
    state.views.forEach(addViewOption);
    syncPickers();
    return load();
  });
})();
