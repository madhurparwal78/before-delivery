// The signed in console: the table list, one table with its rows and dialogs, one saved
// view, the change log, the snapshots, the requests, the account and the administration
// console. Every page is served on the session cookie and reads its role grants from the
// store at the moment it is answered.
const {
  esc, page, statusRegion, departmentRefusalPage, stewardRefusalPage, notFoundPage,
} = require('./pages');
const { pool, businessDay } = require('./store');
const {
  now, iso, accountGrants, roleOn, roleAllows, tierGrantInForce,
  applyFilters, sortCompare, OPERATORS_BY_TYPE, kilobytes, retentionCount, encodeCursor, decodeCursor,
} = require('./helpers');

// ---------- shared pieces ----------

const EMPTY_TABLE_LINE = 'No rows match this view yet.';

function consolePage(account, { title, h1, activeHref, body, banner = '', scripts = '' }) {
  return page({
    title, h1, account, activeHref, consolePage: true, banner,
    body: `<div class="console-frame">${body}</div>`,
  });
}

// The Department element: its own element labelled Department, its visible text beside the
// value, and its accessible name carrying the same word.
function departmentElement(department) {
  return `<p class="department-line"><span class="department-label">Department</span> <span class="department-value" aria-label="Department">${esc(department)}</span></p>`;
}

function valueCell(value) {
  if (value === null || value === undefined || value === '') return '<span class="empty-value" aria-hidden="true">—</span>';
  return esc(typeof value === 'boolean' ? (value ? 'true' : 'false') : value);
}

// The allowance notice: standing, no timer, caution below the allowance and refuse at it.
function allowanceNotice(count, allowance) {
  if (count < 0.8 * allowance) return '';
  const atAllowance = count >= allowance;
  const cls = atAllowance ? 'notice-refuse' : 'notice-caution';
  return `<div class="allowance-notice ${cls}" role="status"><span class="allowance-text">Row allowance: <strong>${count.toLocaleString('en-US')}</strong> of <strong>${allowance.toLocaleString('en-US')}</strong>.</span></div>`;
}

function lockBanner(lockedPeriod) {
  if (!lockedPeriod) return '';
  return `<div class="lock-banner notice-refuse" role="status">Locked for period ${esc(lockedPeriod)}.</div>`;
}

// ---------- the table list ----------

async function tablesListPage(account) {
  const grants = await accountGrants(account.email);
  const departments = grants.map(g => g.department);
  const r = await pool.query('SELECT * FROM tables ORDER BY name');
  const rows = [];
  for (const table of r.rows) {
    if (!departments.includes(table.department)) continue;
    const countR = await pool.query('SELECT count(*) AS c FROM rows WHERE table_id = $1', [table.id]);
    const tier = await tierGrantInForce(table.department, now());
    rows.push({ table, count: Number(countR.rows[0].c), allowance: tier ? tier.row_allowance : null });
  }
  rows.sort((a, b) => a.table.name.localeCompare(b.table.name));
  const body = `
  <section class="console-section">
    <h1 class="page-title">Tables</h1>
    <p class="console-copy">Every table your roles may read.</p>
    <div class="table-panel">
      <div class="panel-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">Table</th>
              <th scope="col">Department</th>
              <th scope="col">Rows</th>
              <th scope="col">Row allowance</th>
              <th scope="col">Locked period</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ table, count, allowance }) => `<tr>
              <th scope="row" class="cell-rowtitle"><a class="table-link" href="/console/tables/${esc(table.slug)}">${esc(table.name)}</a></th>
              <td>${esc(table.department)}</td>
              <td>${count.toLocaleString('en-US')}</td>
              <td>${allowance === null ? '—' : allowance.toLocaleString('en-US')}</td>
              <td>${table.locked_period ? esc(table.locked_period) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </section>`;
  return consolePage(account, { title: 'Tables — Keystone Tables', h1: 'Tables', activeHref: '/console/tables', body });
}

// ---------- one table ----------

async function loadConsoleTable(slug, account) {
  const r = await pool.query('SELECT * FROM tables WHERE slug = $1', [slug]);
  const table = r.rows[0];
  if (!table) return { table: null, role: null };
  const role = await roleOn(account.email, table.department);
  if (!role) return { table, role: null };
  const cols = await pool.query('SELECT * FROM columns WHERE table_id = $1 ORDER BY position', [table.id]);
  table.columns = cols.rows;
  return { table, role };
}

// Integer and decimal columns render as text so the browser never swallows a wrong-type
// value before the save is sent: the write boundary refuses it, as the brief requires.
function cellInputType(column) {
  switch (column.type) {
    case 'date': return 'date';
    default: return 'text';
  }
}

function editRowDialog(table, row) {
  const controls = table.columns.map(column => `
    <div class="form-field">
      <label class="control-label" for="edit-${escAttrId(row.id)}-${escAttrId(column.id)}">${esc(column.caption)}</label>
      ${column.type === 'choice'
        ? `<select class="control" id="edit-${escAttrId(row.id)}-${escAttrId(column.id)}" data-column="${escAttrAttr(column.caption)}">
             <option value=""></option>
             ${(column.options || []).map(o => `<option value="${esc(o)}"${row.values[column.caption] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}
           </select>`
        : column.type === 'flag'
          ? `<select class="control" id="edit-${escAttrId(row.id)}-${escAttrId(column.id)}" data-column="${escAttrAttr(column.caption)}">
               <option value=""${row.values[column.caption] === null || row.values[column.caption] === undefined ? ' selected' : ''}></option>
               <option value="true"${row.values[column.caption] === true ? ' selected' : ''}>true</option>
               <option value="false"${row.values[column.caption] === false ? ' selected' : ''}>false</option>
             </select>`
          : `<input class="control" id="edit-${escAttrId(row.id)}-${escAttrId(column.id)}" data-column="${escAttrAttr(column.caption)}" type="${cellInputType(column)}" value="${escAttrAttr(row.values[column.caption])}">`}
    </div>`).join('');
  return `
  <div class="dialog-backdrop" hidden id="dialog-backdrop-${escAttrId(row.id)}">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-row-title-${escAttrId(row.id)}" id="dialog-edit-${escAttrId(row.id)}" data-dialog="Edit row">
      <h2 class="dialog-title" id="edit-row-title-${escAttrId(row.id)}">Edit row</h2>
      <form class="dialog-form" novalidate data-row="${escAttrAttr(row.id)}" data-version="${row.version}" data-reference="${escAttrAttr(row.values[table.columns[0] ? table.columns[0].caption : ''] || '')}">
        ${controls}
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-dialog-cancel="true" data-control="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" data-control="Save row">Save row</button>
        </div>
      </form>
    </div>
  </div>`;
}

const escAttrId = (id) => esc(String(id).replace(/[^A-Za-z0-9_-]/g, 'x'));
const escAttrAttr = (v) => esc(v === null || v === undefined ? '' : v);

async function tablePage(account, slug, { view: viewName, sort: sortColumn, page: pageNumber, flash = null } = {}) {
  const { table, role } = await loadConsoleTable(slug, account);
  if (!table) return { status: 404, html: notFoundPage() };
  if (!role) return { status: 403, html: departmentRefusalPage(table.department) };

  const tier = await tierGrantInForce(table.department, now());
  const countR = await pool.query('SELECT count(*) AS c FROM rows WHERE table_id = $1', [table.id]);
  const count = Number(countR.rows[0].c);

  const viewsR = await pool.query('SELECT * FROM views WHERE table_id = $1 ORDER BY name', [table.id]);
  const views = viewsR.rows.filter(v => v.visibility === 'shared' || v.owner === account.email);
  const selectedView = viewName ? views.find(v => v.name === viewName) : null;
  const appliedSort = sortColumn && table.columns.some(c => c.caption === sortColumn)
    ? { column: sortColumn, direction: 'asc' } : null;
  const page_ = Math.max(1, Number(pageNumber || 1) || 1);
  const perPage = 100;

  const rowsR = await pool.query('SELECT * FROM rows WHERE table_id = $1 ORDER BY inserted_at ASC, id ASC', [table.id]);
  let rows = rowsR.rows.map(r => ({ id: r.id, values: r.values, version: r.version, inserted_at: r.inserted_at }));
  const filters = selectedView ? (selectedView.filters || []) : [];
  rows = rows.filter(row => applyFilters(table.columns, filters, row.values));
  const total = rows.length;
  const sorts = appliedSort ? [appliedSort] : (selectedView ? (selectedView.sorts || []) : []);
  if (sorts.length > 0) {
    rows = rows.slice().sort((a, b) => sortCompare(table.columns, sorts, a, b));
  }
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page_, totalPages);
  const slice = rows.slice((safePage - 1) * perPage, safePage * perPage);

  const canAmend = roleAllows('amend_rows', role);
  const canManageViews = roleAllows('manage_views', role);

  const rowTitleColumn = table.columns[0];
  const valueColumns = table.columns.slice(1);

  const viewOptions = views.map(v => `<option value="${esc(v.name)}"${selectedView && selectedView.name === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  const sortOptions = table.columns.map(c => `<option value="${esc(c.caption)}"${appliedSort && appliedSort.column === c.caption ? ' selected' : ''}>${esc(c.caption)}</option>`).join('');

  const filterGroups = [];
  const sortGroups = [];
  if (canManageViews || canAmend) {
    // The view builder reads its operator options from the same table the server checks.
    const columnOptions = table.columns.map(c => `<option value="${esc(c.caption)}">${esc(c.caption)}</option>`).join('');
    filterGroups.push(`
      <div class="view-filter-group" data-template="filter" hidden>
        <p class="group-label">Filter</p>
        <label class="control-label" for="filter-column-tpl">Column</label>
        <select class="control filter-column" id="filter-column-tpl">${columnOptions}</select>
        <label class="control-label" for="filter-operator-tpl">Operator</label>
        <select class="control filter-operator" id="filter-operator-tpl"></select>
        <label class="control-label" for="filter-value-tpl">Value</label>
        <input class="control filter-value" id="filter-value-tpl" type="text">
        <button type="button" class="btn btn-secondary btn-small" data-remove-filter="true" data-control="Remove filter">Remove</button>
      </div>`);
    sortGroups.push(`
      <div class="view-sort-group" data-template="sort" hidden>
        <p class="group-label">Sort</p>
        <label class="control-label" for="sort-column-tpl">Column</label>
        <select class="control sort-column" id="sort-column-tpl">${columnOptions}</select>
        <label class="control-label" for="sort-direction-tpl">Direction</label>
        <select class="control sort-direction" id="sort-direction-tpl">
          <option value="asc">asc</option>
          <option value="desc">desc</option>
        </select>
        <button type="button" class="btn btn-secondary btn-small" data-remove-sort="true" data-control="Remove sort">Remove</button>
      </div>`);
  }

  const body = `
  <section class="console-section table-with-toolbar">
    <div class="table-heading">
      <h1 class="page-title">${esc(table.name)}</h1>
      ${departmentElement(table.department)}
    </div>
    ${lockBanner(table.locked_period)}
    ${allowanceNotice(count, tier ? tier.row_allowance : 0)}
    <div class="table-toolbar">
      <div class="toolbar-controls">
        <label class="control-label" for="view-picker">View</label>
        <select class="control" id="view-picker" data-table="${esc(table.slug)}">
          <option value="">All rows</option>
          ${viewOptions}
        </select>
        <label class="control-label" for="sort-picker">Sort</label>
        <select class="control" id="sort-picker" data-table="${esc(table.slug)}">
          <option value="">Insertion order</option>
          ${sortOptions}
        </select>
      </div>
      <div class="toolbar-actions">
        ${canManageViews || canAmend ? `<button type="button" class="btn btn-secondary" id="new-view-button" data-control="New view" data-table="${esc(table.slug)}">New view</button>` : ''}
        <a class="btn btn-secondary" href="/console/tables/${esc(table.slug)}/log" data-control="Change log">Change log</a>
      </div>
    </div>
    <div class="table-panel" id="table-panel">
      <div class="panel-scroll" id="panel-scroll">
        <table class="data-table row-table" id="rows-table" data-table="${esc(table.slug)}" data-page="${safePage}" data-total="${total}">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">${esc(rowTitleColumn ? rowTitleColumn.caption : 'Row')}</th>
              ${valueColumns.map(c => `<th scope="col" data-column-type="${esc(c.type)}">${esc(c.caption)}</th>`).join('')}
              ${canAmend ? '<th scope="col" class="cell-actions"><span class="visually-hidden">Actions</span></th>' : ''}
            </tr>
          </thead>
          <tbody id="rows-body">
            ${slice.map((row, index) => `<tr class="table-row" data-row="${escAttrAttr(row.id)}" data-version="${row.version}" data-stagger="${index}">
              <th scope="row" class="cell-rowtitle">${valueCell(row.values[rowTitleColumn ? rowTitleColumn.caption : ''])}</th>
              ${valueColumns.map(c => `<td>${valueCell(row.values[c.caption])}</td>`).join('')}
              ${canAmend ? `<td class="cell-actions"><button type="button" class="btn btn-secondary btn-small edit-row-button" data-row="${escAttrAttr(row.id)}" data-control="Edit row">Edit row</button></td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
        ${total === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
      </div>
    </div>
    <div class="pager" id="table-pager" data-page="${safePage}" data-total-pages="${totalPages}">
      <button type="button" class="btn btn-secondary btn-small" id="prev-page" data-control="Previous page"${safePage <= 1 ? ' disabled' : ''}>Previous page</button>
      <span class="pager-status" id="pager-status">Page ${safePage} of ${totalPages}</span>
      <button type="button" class="btn btn-secondary btn-small" id="next-page" data-control="Next page"${safePage >= totalPages ? ' disabled' : ''}>Next page</button>
    </div>
  </section>
  ${canAmend ? `<div class="dialog-host">${slice.map(row => editRowDialog(table, row)).join('')}</div>` : ''}
  ${(canManageViews || canAmend) ? `
  <div class="dialog-backdrop" hidden id="dialog-backdrop-new-view">
    <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="new-view-title" id="dialog-new-view" data-dialog="New view">
      <h2 class="dialog-title" id="new-view-title">New view</h2>
      <form class="dialog-form" id="new-view-form" data-table="${esc(table.slug)}">
        <div class="form-field">
          <label class="control-label" for="new-view-name">Name</label>
          <input class="control" id="new-view-name" name="name" type="text" required>
        </div>
        <fieldset class="form-field">
          <legend class="control-label">Visibility</legend>
          <div class="radio-row">
            <label class="radio-option"><input type="radio" name="visibility" value="private" checked> private</label>
            <label class="radio-option"><input type="radio" name="visibility" value="shared"> shared</label>
          </div>
        </fieldset>
        <div class="view-groups" id="view-filters">${filterGroups.join('')}</div>
        <button type="button" class="btn btn-secondary btn-small" id="add-filter" data-control="Add filter">Add filter</button>
        <div class="view-groups" id="view-sorts">${sortGroups.join('')}</div>
        <button type="button" class="btn btn-secondary btn-small" id="add-sort" data-control="Add sort">Add sort</button>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-dialog-cancel="true" data-control="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" data-control="Save view">Save view</button>
        </div>
      </form>
    </div>
  </div>` : ''}
  <script>window.__TABLE__ = ${JSON.stringify({
    slug: table.slug,
    name: table.name,
    department: table.department,
    columns: table.columns.map(c => ({ id: c.id, caption: c.caption, type: c.type, options: c.options })),
    operators: Object.fromEntries(table.columns.map(c => [c.caption, OPERATORS_BY_TYPE[c.type]])),
    canAmend, canManageViews,
    count, allowance: tier ? tier.row_allowance : null,
  })};</script>`;

  return {
    status: 200,
    html: consolePage(account, {
      title: `${table.name} — Keystone Tables`, h1: table.name, activeHref: '/console/tables', body,
    }),
  };
}

// ---------- one saved view ----------

async function viewPage(account, slug, viewId) {
  const { table, role } = await loadConsoleTable(slug, account);
  if (!table) return { status: 404, html: notFoundPage() };
  if (!role) return { status: 403, html: departmentRefusalPage(table.department) };
  const vR = await pool.query('SELECT * FROM views WHERE id = $1 AND table_id = $2', [viewId, table.id]);
  const view = vR.rows[0];
  if (!view) return { status: 404, html: notFoundPage() };
  if (view.visibility === 'private' && view.owner !== account.email) {
    return { status: 403, html: departmentRefusalPage(table.department) };
  }
  const rowsR = await pool.query('SELECT * FROM rows WHERE table_id = $1 ORDER BY inserted_at ASC, id ASC', [table.id]);
  let rows = rowsR.rows.map(r => ({ id: r.id, values: r.values, version: r.version }));
  rows = rows.filter(row => applyFilters(table.columns, view.filters || [], row.values));
  if ((view.sorts || []).length > 0) {
    rows = rows.slice().sort((a, b) => sortCompare(table.columns, view.sorts, a, b));
  }
  const rowTitleColumn = table.columns[0];
  const valueColumns = table.columns.slice(1);
  const body = `
  <section class="console-section">
    <div class="table-heading">
      <h1 class="page-title">${esc(view.name)}</h1>
      ${departmentElement(table.department)}
    </div>
    <p class="console-copy">A saved view of <a href="/console/tables/${esc(table.slug)}">${esc(table.name)}</a>.</p>
    <div class="table-panel">
      <div class="panel-scroll">
        <table class="data-table row-table">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">${esc(rowTitleColumn ? rowTitleColumn.caption : 'Row')}</th>
              ${valueColumns.map(c => `<th scope="col" data-column-type="${esc(c.type)}">${esc(c.caption)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `<tr class="table-row" data-row="${escAttrAttr(row.id)}">
              <th scope="row" class="cell-rowtitle">${valueCell(row.values[rowTitleColumn ? rowTitleColumn.caption : ''])}</th>
              ${valueColumns.map(c => `<td>${valueCell(row.values[c.caption])}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
        ${rows.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
      </div>
    </div>
  </section>`;
  return {
    status: 200,
    html: consolePage(account, { title: `${view.name} — Keystone Tables`, h1: view.name, activeHref: '/console/tables', body }),
  };
}

// ---------- the change log page ----------

async function logPage(account, slug, { page: pageNumber = 1, action = null, accountFilter = null } = {}) {
  const { table, role } = await loadConsoleTable(slug, account);
  if (!table) return { status: 404, html: notFoundPage() };
  if (!role) return { status: 403, html: departmentRefusalPage(table.department) };
  const perPage = 20;
  const page_ = Math.max(1, Number(pageNumber || 1) || 1);
  const params = [table.slug];
  let where = 'table_slug = $1';
  if (action) {
    params.push(action);
    where += ` AND action = $${params.length}`;
  }
  if (accountFilter) {
    params.push(accountFilter);
    where += ` AND account = $${params.length}`;
  }
  const totalR = await pool.query(`SELECT count(*) AS c FROM log_entries WHERE ${where}`, params);
  const total = Number(totalR.rows[0].c);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page_, totalPages);
  const r = await pool.query(
    `SELECT * FROM log_entries WHERE ${where} ORDER BY ordinal DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, (safePage - 1) * perPage]);
  const entryRow = (row) => {
    let before = row.before;
    let after = row.after;
    try {
      const column = table.columns.find(c => c.caption === row.column_caption);
      if (column && column.type === 'flag') {
        if (typeof before === 'string') before = before === 'true';
        if (typeof after === 'string') after = after === 'true';
      }
    } catch {}
    return `<tr>
      <th scope="row" class="cell-rowtitle">#${row.ordinal}</th>
      <td>${esc(row.action)}</td>
      <td>${esc(row.account)}</td>
      <td>${row.column_caption === null ? '—' : esc(row.column_caption)}</td>
      <td class="cell-nowrap">${before === null ? '—' : esc(typeof before === 'object' ? JSON.stringify(before) : before)}</td>
      <td class="cell-nowrap">${after === null ? '—' : esc(typeof after === 'object' ? JSON.stringify(after) : after)}</td>
      <td>${esc(row.recorded_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
    </tr>`;
  };
  const body = `
  <section class="console-section">
    <div class="table-heading">
      <h1 class="page-title">Change log — ${esc(table.name)}</h1>
      ${departmentElement(table.department)}
    </div>
    <p class="console-copy">The append-only log. Newest first, twenty entries at a time.</p>
    <div class="table-panel">
      <div class="panel-scroll">
        <table class="data-table log-table">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">Ordinal</th>
              <th scope="col">Action</th>
              <th scope="col">Account</th>
              <th scope="col">Column</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Recorded at</th>
            </tr>
          </thead>
          <tbody>
            ${r.rows.map(entryRow).join('')}
          </tbody>
        </table>
        ${total === 0 ? '<p class="empty-table-line">No rows match this view yet.</p>' : ''}
      </div>
    </div>
    <div class="pager" data-page="${safePage}" data-total-pages="${totalPages}">
      <a class="btn btn-secondary btn-small" href="?page=${safePage - 1}${action ? '&action=' + esc(action) : ''}" ${safePage <= 1 ? ' aria-disabled="true"' : ''} data-control="Previous page">Previous page</a>
      <span class="pager-status">Page ${safePage} of ${totalPages}</span>
      <a class="btn btn-secondary btn-small" href="?page=${safePage + 1}${action ? '&action=' + esc(action) : ''}" ${safePage >= totalPages ? ' aria-disabled="true"' : ''} data-control="Next page">Next page</a>
    </div>
  </section>`;
  return {
    status: 200,
    html: consolePage(account, { title: `Change log — ${table.name} — Keystone Tables`, h1: 'Change log', activeHref: '/console/tables', body }),
  };
}

// ---------- the snapshots page ----------

async function snapshotsPage(account) {
  const grants = await accountGrants(account.email);
  const departments = grants.map(g => g.department);
  const snapR = await pool.query('SELECT * FROM snapshots ORDER BY published_at DESC');
  const visible = [];
  for (const row of snapR.rows) {
    const tableR = await pool.query('SELECT * FROM tables WHERE slug = $1', [row.table_slug]);
    const table = tableR.rows[0];
    if (!table || !departments.includes(table.department)) continue;
    const tier = await pool.query('SELECT * FROM tiers WHERE name = $1', [row.tier]);
    const retained = retentionCount(tier.rows[0] ? tier.rows[0].retention : row.retention);
    const rankR = await pool.query(
      'SELECT count(*) + 1 AS rank FROM snapshots WHERE table_slug = $1 AND published_at > $2', [row.table_slug, row.published_at]);
    const rank = Number(rankR.rows[0].rank);
    visible.push({ row, table, retained: rank <= retained, rank, tier: tier.rows[0] });
  }
  const stewardOf = grants.filter(g => g.role === 'steward').map(g => g.department);
  const publishableTables = [];
  const tablesR = await pool.query('SELECT * FROM tables ORDER BY name');
  for (const table of tablesR.rows) {
    if (stewardOf.includes(table.department)) publishableTables.push(table);
  }
  const snapshotRow = ({ row, table, retained }) => `<tr class="table-row snapshot-row" ${retained ? '' : 'aria-disabled="true"'}>
    <th scope="row" class="cell-rowtitle">${esc(row.period)}</th>
    <td>${esc(table.name)}</td>
    <td>${esc(row.tier)}</td>
    <td>${row.row_count.toLocaleString('en-US')}</td>
    <td>${esc(row.published_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
    <td>${esc(row.business_day)}</td>
    <td>${retained ? `<a class="table-link" href="/api/snapshots/${esc(row.id)}" data-snapshot="${esc(row.id)}">Read</a>` : 'Unavailable'}</td>
  </tr>`;
  const body = `
  <section class="console-section">
    <h1 class="page-title">Snapshots</h1>
    <p class="console-copy">Published snapshots keep the rows they held at publication.</p>
    ${publishableTables.length > 0 ? `
    <div class="snapshots-toolbar">
      <button type="button" class="btn btn-primary" id="publish-snapshot-button" data-control="Publish snapshot">Publish snapshot</button>
    </div>` : ''}
    <div class="snapshots-layout">
      <section class="console-panel" aria-label="Published snapshots">
        <h2 class="panel-title">Published snapshots</h2>
        <div class="table-panel">
          <div class="panel-scroll">
            <table class="data-table snapshot-table">
              <thead>
                <tr>
                  <th scope="col" class="cell-rowtitle">Period</th>
                  <th scope="col">Table</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Published at</th>
                  <th scope="col">Business day</th>
                  <th scope="col">Availability</th>
                </tr>
              </thead>
              <tbody>
                ${visible.map(snapshotRow).join('')}
              </tbody>
            </table>
            ${visible.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
          </div>
        </div>
      </section>
      <section class="console-panel" aria-label="Retention summary">
        <h2 class="panel-title">Retention summary</h2>
        ${retentionSummaryRows(visible)}
      </section>
    </div>
  </section>
  ${publishableTables.length > 0 ? `
  <div class="dialog-backdrop" hidden id="dialog-backdrop-publish">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title" id="dialog-publish" data-dialog="Publish snapshot">
      <h2 class="dialog-title" id="publish-title">Publish snapshot</h2>
      <form class="dialog-form" id="publish-form">
        <div class="form-field">
          <label class="control-label" for="publish-table">Table</label>
          <select class="control" id="publish-table" name="table">
            ${publishableTables.map(t => `<option value="${esc(t.slug)}">${esc(t.name)} (${esc(t.department)})</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="control-label" for="publish-period">Period</label>
          <input class="control" id="publish-period" name="period" type="text" required>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-dialog-cancel="true" data-control="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" data-control="Publish">Publish</button>
        </div>
      </form>
    </div>
  </div>` : ''}`;
  return {
    status: 200,
    html: consolePage(account, { title: 'Snapshots — Keystone Tables', h1: 'Snapshots', activeHref: '/console/snapshots', body }),
  };
}

function retentionSummaryRows(visible) {
  const byTier = {};
  for (const v of visible) {
    if (!byTier[v.row.tier]) byTier[v.row.tier] = { retention: v.row.retention, retained: 0, expired: 0 };
    if (v.retained) byTier[v.row.tier].retained += 1;
    else byTier[v.row.tier].expired += 1;
  }
  const lines = Object.entries(byTier).map(([tier, s]) =>
    `<p class="retention-line"><strong>${esc(tier)}</strong> retains <strong>${esc(s.retention)}</strong>: ${s.retained} retained${s.retention === 'every period' ? '' : `, ${s.expired} past it`}.</p>`);
  return `<div class="retention-summary">${lines.join('') || '<p class="retention-line">No snapshot is published for your departments yet.</p>'}</div>`;
}

// ---------- the requests page ----------

async function requestsPage(account) {
  const grants = await accountGrants(account.email);
  const departments = grants.map(g => g.department);
  const stewardOf = grants.filter(g => g.role === 'steward').map(g => g.department);
  const r = await pool.query('SELECT * FROM requests ORDER BY raised_at DESC');
  const mine = r.rows.filter(row => row.account === account.email);
  const theirs = r.rows.filter(row => departments.includes(row.department));
  const requestRow = (row, decidable) => `<tr>
    <th scope="row" class="cell-rowtitle">${esc(row.account)}</th>
    <td>${esc(row.department)}</td>
    <td>${esc(row.role)}</td>
    <td>${esc(row.state)}</td>
    <td>${row.reason === null ? '—' : esc(row.reason)}</td>
    <td class="cell-actions">${decidable && row.state === 'open' ? `<button type="button" class="btn btn-secondary btn-small decide-request-button" data-request="${esc(row.id)}" data-department="${esc(row.department)}" data-control="Decide request">Decide request</button>` : '—'}</td>
  </tr>`;
  const body = `
  <section class="console-section">
    <h1 class="page-title">Access requests</h1>
    <p class="console-copy">A steward of the requested department decides every request.</p>
    <div class="table-panel">
      <div class="panel-scroll">
        <table class="data-table request-table">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">Account</th>
              <th scope="col">Department</th>
              <th scope="col">Role</th>
              <th scope="col">State</th>
              <th scope="col">Reason</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            ${theirs.map(row => requestRow(row, row.account !== account.email && stewardOf.includes(row.department))).join('')}
          </tbody>
        </table>
        ${theirs.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
      </div>
    </div>
    <section class="console-panel" aria-label="Raise a request">
      <h2 class="panel-title">Raise a request</h2>
      <form class="inline-form" id="raise-request-form">
        <div class="form-field">
          <label class="control-label" for="request-department">Department</label>
          <select class="control" id="request-department" name="department">
            ${['claims', 'underwriting', 'actuarial'].filter(d => !departments.includes(d)).map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="control-label" for="request-role">Role</label>
          <select class="control" id="request-role" name="role">
            ${['viewer', 'analyst', 'editor', 'steward'].map(role => `<option value="${role}">${role}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" type="submit" data-control="Raise request">Raise request</button>
      </form>
    </section>
  </section>
  <div class="dialog-backdrop" hidden id="dialog-backdrop-decide">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="decide-title" id="dialog-decide" data-dialog="Decide request">
      <h2 class="dialog-title" id="decide-title">Decide request</h2>
      <form class="dialog-form" id="decide-form">
        <fieldset class="form-field">
          <legend class="control-label">Decision</legend>
          <div class="radio-row">
            <label class="radio-option"><input type="radio" name="decision" value="approved" checked> approved</label>
            <label class="radio-option"><input type="radio" name="decision" value="declined"> declined</label>
          </div>
        </fieldset>
        <div class="form-field">
          <label class="control-label" for="decide-reason">Reason</label>
          <input class="control" id="decide-reason" name="reason" type="text">
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-dialog-cancel="true" data-control="Cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" data-control="Record decision">Record decision</button>
        </div>
      </form>
    </div>
  </div>`;
  return {
    status: 200,
    html: consolePage(account, { title: 'Access requests — Keystone Tables', h1: 'Access requests', activeHref: '/console/requests', body }),
  };
}

// ---------- the account page ----------

async function accountPage(account) {
  const grants = await accountGrants(account.email);
  const body = `
  <section class="console-section">
    <h1 class="page-title">Account</h1>
    <dl class="account-facts">
      <div class="account-fact"><dt>Display name</dt><dd>${esc(account.display_name)}</dd></div>
      <div class="account-fact"><dt>Work email</dt><dd>${esc(account.email)}</dd></div>
      <div class="account-fact"><dt>Department</dt><dd>${esc(account.department)}</dd></div>
      <div class="account-fact"><dt>Tier</dt><dd>${esc(account.tier)}</dd></div>
    </dl>
    <h2 class="section-heading">Role grants</h2>
    <div class="table-panel">
      <div class="panel-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col" class="cell-rowtitle">Department</th>
              <th scope="col">Role</th>
              <th scope="col">Authorises from</th>
            </tr>
          </thead>
          <tbody>
            ${grants.map(g => `<tr>
              <th scope="row" class="cell-rowtitle">${esc(g.department)}</th>
              <td>${esc(g.role)}</td>
              <td>${esc(g.authorises_from.replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${grants.length === 0 ? `<p class="empty-table-line">No rows match this view yet.</p>` : ''}
      </div>
    </div>
  </section>`;
  return {
    status: 200,
    html: consolePage(account, { title: 'Account — Keystone Tables', h1: 'Account', activeHref: '/console/account', body }),
  };
}

// ---------- the administration console ----------

async function administrationPage(account) {
  const grants = await accountGrants(account.email);
  const stewardGrant = grants.find(g => g.role === 'steward');
  if (!stewardGrant) {
    return { status: account ? 403 : 401, html: stewardRefusalPage(403) };
  }
  const department = stewardGrant.department;
  const grantsR = await pool.query(
    'SELECT * FROM role_grants WHERE department = $1 ORDER BY account', [department]);
  const at = now().getTime();
  const queueR = await pool.query(
    `SELECT * FROM requests WHERE department = $1 ORDER BY (state = 'open') DESC, raised_at ASC, id ASC LIMIT 20`,
    [department]);
  const attemptsR = await pool.query(
    'SELECT * FROM login_attempts ORDER BY attempted_at DESC, id DESC LIMIT 20');
  const logR = await pool.query(
    'SELECT * FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT 20',
    ['admin-' + department]);
  const grantRow = (g) => `<tr data-grant="${esc(g.id)}">
    <th scope="row" class="cell-rowtitle">${esc(g.account)}</th>
    <td>${esc(g.role)}</td>
    <td>${esc(new Date(g.authorises_from).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
    <td>${at >= new Date(g.authorises_from).getTime() ? 'yes' : 'no'}</td>
    <td class="cell-actions"><input type="checkbox" class="grant-check" value="${esc(g.id)}" aria-label="Select ${esc(g.account)}"></td>
  </tr>`;
  const body = `
  <section class="console-section">
    <h1 class="page-title">Administration</h1>
    <p class="console-copy">You govern <strong>${esc(department)}</strong> and no other department.</p>
    <div class="admin-layout">
      <section class="console-panel admin-panel" aria-label="Grant administration">
        <h2 class="panel-title">Grant administration</h2>
        <form class="stacked-form" id="create-grant-form">
          <div class="form-field">
            <label class="control-label" for="grant-account">Account</label>
            <input class="control" id="grant-account" name="account" type="text" list="grant-accounts" required>
            <datalist id="grant-accounts">
              ${(await pool.query('SELECT email FROM accounts ORDER BY email')).rows.map(a => `<option value="${esc(a.email)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="form-field">
            <label class="control-label" for="grant-role">Role</label>
            <select class="control" id="grant-role" name="role">
              ${['viewer', 'analyst', 'editor', 'steward'].map(r => `<option value="${r}">${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="control-label" for="grant-from">Authorises from</label>
            <input class="control" id="grant-from" name="authorises_from" type="datetime-local">
          </div>
          <button class="btn btn-primary" type="submit" data-control="Create grant">Create grant</button>
        </form>
        <div class="table-panel">
          <div class="panel-scroll">
            <table class="data-table admin-grants-table">
              <thead>
                <tr>
                  <th scope="col" class="cell-rowtitle">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Authorises from</th>
                  <th scope="col">Authorising</th>
                  <th scope="col">Select</th>
                </tr>
              </thead>
              <tbody id="admin-grants-body">${grantsR.rows.map(grantRow).join('')}</tbody>
            </table>
          </div>
        </div>
        <button type="button" class="btn btn-refuse" id="revoke-grants-button" data-control="Revoke grants">Revoke grants</button>
      </section>
      <section class="console-panel admin-panel" aria-label="Access request queue">
        <h2 class="panel-title">Access request queue</h2>
        <div class="table-panel">
          <div class="panel-scroll">
            <table class="data-table admin-queue-table">
              <thead>
                <tr>
                  <th scope="col" class="cell-rowtitle">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">State</th>
                  <th scope="col">Raised at</th>
                </tr>
              </thead>
              <tbody>
                ${queueR.rows.map(row => `<tr>
                  <th scope="row" class="cell-rowtitle">${esc(row.account)}</th>
                  <td>${esc(row.role)}</td>
                  <td>${esc(row.state)}</td>
                  <td>${esc(row.raised_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            ${queueR.rows.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
          </div>
        </div>
      </section>
      <section class="console-panel admin-panel" aria-label="Sign-in attempt record">
        <h2 class="panel-title">Sign-in attempt record</h2>
        <div class="table-panel">
          <div class="panel-scroll">
            <table class="data-table admin-attempts-table">
              <thead>
                <tr>
                  <th scope="col" class="cell-rowtitle">Email</th>
                  <th scope="col">Attempted at</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                ${attemptsR.rows.map(row => `<tr>
                  <th scope="row" class="cell-rowtitle">${esc(row.email)}</th>
                  <td>${esc(row.attempted_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
                  <td>${esc(row.outcome)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            ${attemptsR.rows.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
          </div>
        </div>
      </section>
    </div>
    <section class="console-panel" aria-label="Administration log">
      <h2 class="panel-title">Administration log</h2>
      <div class="table-panel">
        <div class="panel-scroll">
          <table class="data-table admin-log-table">
            <thead>
              <tr>
                <th scope="col" class="cell-rowtitle">Ordinal</th>
                <th scope="col">Action</th>
                <th scope="col">Acting steward</th>
                <th scope="col">Subject</th>
                <th scope="col">Recorded at</th>
              </tr>
            </thead>
            <tbody>
              ${logR.rows.map(row => `<tr>
                <th scope="row" class="cell-rowtitle">#${row.ordinal}</th>
                <td>${esc(row.action)}</td>
                <td>${esc(row.account)}</td>
                <td>${esc(row.subject || '—')}</td>
                <td>${esc(row.recorded_at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          ${logR.rows.length === 0 ? `<p class="empty-table-line">${EMPTY_TABLE_LINE}</p>` : ''}
        </div>
      </div>
    </section>
  </section>
  <div class="dialog-backdrop" hidden id="dialog-backdrop-revoke">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-title" id="dialog-revoke" data-dialog="Confirm bulk revoke">
      <h2 class="dialog-title" id="revoke-title">Confirm bulk revoke</h2>
      <form class="dialog-form" id="revoke-form">
        <div class="form-field">
          <label class="control-label" for="revoke-phrase">Confirmation phrase</label>
          <input class="control" id="revoke-phrase" name="confirmation" type="text" autocomplete="off">
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-dialog-cancel="true" data-control="Cancel">Cancel</button>
          <button type="submit" class="btn btn-refuse" data-control="Revoke">Revoke</button>
        </div>
      </form>
    </div>
  </div>
  <script>window.__ADMIN__ = ${JSON.stringify({ department })};</script>`;
  return {
    status: 200,
    html: consolePage(account, { title: 'Administration — Keystone Tables', h1: 'Administration', activeHref: '/console/administration', body }),
  };
}

module.exports = {
  tablesListPage, tablePage, viewPage, logPage, snapshotsPage, requestsPage,
  accountPage, administrationPage, EMPTY_TABLE_LINE,
};
