'use strict';
const { e, page, departmentField, workspaceUpdates } = require('./html');
const dialogs = require('./dialogs');

function cellText(col, value) {
  if (value === null || value === undefined) return '';
  if (col.type === 'flag') return value === true ? 'true' : 'false';
  return String(value);
}

function rowsMarkup(cols, rows) {
  if (!rows.length) return '';
  return rows
    .map((row, i) => {
      const title = cellText(cols[0], row.values[cols[0].caption]);
      const cells = cols
        .slice(1)
        .map((c) => `<td class="value-cell" data-column="${e(c.caption)}">${e(cellText(c, row.values[c.caption]))}</td>`)
        .join('');
      return `<tr class="data-row" data-row-id="${e(row.id)}" data-version="${row.version}" style="animation-delay:${i * 36}ms">
  <th scope="row" class="row-title-cell" data-column="${e(cols[0].caption)}">${e(title)}</th>
  ${cells}
  <td class="amend-cell"><button type="button" class="button button-quiet edit-row-control" data-open-dialog="edit-row" data-edit-row="${e(row.id)}">Edit row</button></td>
</tr>`;
    })
    .join('');
}

/** The placeholder a row shows while its values are still loading. */
function loadingTemplate(cols) {
  const cells = cols
    .map(
      (c, i) =>
        `${i === 0 ? '<th scope="row" class="row-title-cell">' : '<td>'}<span class="placeholder"></span>${
          i === 0 ? '</th>' : '</td>'
        }`
    )
    .join('');
  return `<template id="loading-row-template"><tr class="loading-row" data-loading-row aria-hidden="true">${cells}<td><span class="placeholder"></span></td></tr></template>`;
}

function allowanceNotice(table) {
  const count = table.count;
  const allowance = table.row_allowance;
  if (!allowance) return '';
  if (count >= allowance) {
    return `<p class="allowance-notice is-refuse" id="allowance-notice" role="status" data-count="${count}" data-allowance="${allowance}">This table holds ${count} rows of the ${allowance} the ${e(
      table.tier
    )} tier allows.</p>`;
  }
  if (count >= 0.8 * allowance) {
    return `<p class="allowance-notice is-caution" id="allowance-notice" role="status" data-count="${count}" data-allowance="${allowance}">This table holds ${count} rows of the ${allowance} the ${e(
      table.tier
    )} tier allows.</p>`;
  }
  return '';
}

function lockBanner(table) {
  if (!table.locked_period) return '';
  return `<p class="lock-banner is-refuse" id="lock-banner" role="status" data-period="${e(
    table.locked_period
  )}">This table is locked for the ${e(table.locked_period)} reporting period.</p>`;
}

/* ------------------------------------------------------------------ */

function consoleHome(ctx) {
  const body = `
<section class="band">
  <h1 class="page-title">Workspace</h1>
  ${workspaceUpdates()}
  <p class="band-sentence">You reach the departments you hold a role on and no other. Every request reads your role grants from the store as they stand at the moment it is answered.</p>
</section>
<section class="band" aria-labelledby="grants-heading">
  <h2 class="section-heading" id="grants-heading">Your role grants</h2>
  <ul class="grant-list">
    ${
      ctx.grants.length
        ? ctx.grants
            .map(
              (g) => `<li class="grant-item">
  ${departmentField(g.department)}
  <span class="grant-role">${e(g.role)}</span>
</li>`
            )
            .join('')
        : '<li class="grant-item">You hold no role grant yet.</li>'
    }
  </ul>
</section>
<section class="band" aria-labelledby="console-routes-heading">
  <h2 class="section-heading" id="console-routes-heading">Workspace addresses</h2>
  <ul class="console-route-list">
    <li><a class="route-card" href="/console/tables">Tables</a></li>
    <li><a class="route-card" href="/console/snapshots">Snapshots</a></li>
    <li><a class="route-card" href="/console/requests">Requests</a></li>
    <li><a class="route-card" href="/console/account">Account</a></li>
    ${ctx.isSteward ? '<li><a class="route-card" href="/console/administration">Administration</a></li>' : ''}
  </ul>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Workspace', route: 'console-home' }), body);
}

function tableList(ctx) {
  const body = `
<section class="band">
  <h1 class="page-title">Tables</h1>
  ${workspaceUpdates()}
  <p class="band-sentence">Every table you may read, in name order. A table you hold no role for is absent from this list and from its counts.</p>
</section>
<section class="band" aria-labelledby="table-list-heading">
  <h2 class="section-heading" id="table-list-heading">Readable tables</h2>
  ${
    ctx.tables.length
      ? `<ul class="table-list">${ctx.tables
          .map(
            (t) => `<li class="panel table-list-item">
  <h3 class="panel-title"><a class="table-link" href="/console/tables/${e(t.slug)}">${e(t.name)}</a></h3>
  ${departmentField(t.department)}
  <dl class="table-figures">
    <div class="figure-row"><dt>Slug</dt><dd>${e(t.slug)}</dd></div>
    <div class="figure-row"><dt>Tier</dt><dd>${e(t.tier)}</dd></div>
    <div class="figure-row"><dt>Rows</dt><dd>${t.count} of ${t.row_allowance}</dd></div>
    <div class="figure-row"><dt>Stored kilobytes</dt><dd>${t.stored_kilobytes}</dd></div>
    <div class="figure-row"><dt>Locked period</dt><dd>${t.locked_period ? e(t.locked_period) : 'not locked'}</dd></div>
  </dl>
  <p class="table-list-links"><a class="quiet-link" href="/console/tables/${e(t.slug)}/log">Change log</a></p>
</li>`
          )
          .join('')}</ul>`
      : '<p class="empty-line">No rows match this view yet.</p>'
  }
</section>`;
  return page(Object.assign({}, ctx, { title: 'Tables', route: 'table-list' }), body);
}

function tablePage(ctx) {
  const { table, cols, rows, viewsList, total, pageNumber, perPage, appliedView, sortColumn } = ctx;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const body = `
<section class="band">
  <h1 class="page-title">${e(table.name)}</h1>
  ${departmentField(table.department)}
  ${workspaceUpdates()}
  ${lockBanner(table)}
  ${allowanceNotice(table)}
</section>
<section class="band" aria-labelledby="rows-heading">
  <h2 class="section-heading" id="rows-heading">Rows</h2>
  <div class="table-layout" id="table-layout">
    <div class="table-controls" id="table-controls">
      <div class="field">
        <label class="control-label" for="view-picker">View</label>
        <select class="control" id="view-picker">
          ${viewsList
            .map(
              (v) =>
                `<option value="${e(v.name)}"${appliedView && appliedView.name === v.name ? ' selected' : ''}>${e(
                  v.name
                )}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label class="control-label" for="sort-picker">Sort</label>
        <select class="control" id="sort-picker">
          ${cols
            .map(
              (c) =>
                `<option value="${e(c.caption)}"${sortColumn === c.caption ? ' selected' : ''}>${e(c.caption)}</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="pager">
        <button type="button" class="button button-quiet" id="previous-page" data-previous-page${
          pageNumber <= 1 ? ' disabled' : ''
        }>Previous page</button>
        <button type="button" class="button button-quiet" id="next-page" data-next-page${
          pageNumber >= totalPages ? ' disabled' : ''
        }>Next page</button>
        <p class="pager-state" id="pager-state" aria-live="polite">Page <span data-page-number>${pageNumber}</span> of <span data-page-total>${totalPages}</span>, <span data-row-total>${total}</span> rows</p>
      </div>
      <div class="control-actions">
        <button type="button" class="button button-primary" id="new-view" data-open-dialog="new-view">New view</button>
        <a class="button button-quiet" href="/console/tables/${e(table.slug)}/log">Change log</a>
      </div>
    </div>
    <div class="table-panel-wrap">
      <div class="table-panel" tabindex="0" id="table-panel">
        <table class="data-table console-table" id="rows-table">
          <caption class="table-caption">${e(table.name)} rows</caption>
          <thead>
            <tr>
              <th scope="col" class="row-title-cell">${e(cols[0].caption)}</th>
              ${cols.slice(1).map((c) => `<th scope="col">${e(c.caption)}</th>`).join('')}
              <th scope="col">Amend</th>
            </tr>
          </thead>
          <tbody id="rows-body">${rowsMarkup(cols, rows)}</tbody>
        </table>
      </div>
      ${loadingTemplate(cols)}
      <p class="empty-line" id="empty-line"${rows.length ? ' hidden' : ''}>No rows match this view yet.</p>
    </div>
  </div>
</section>
${dialogs.newView(cols)}
${dialogs.editRow(cols)}`;
  return page(
    Object.assign({}, ctx, {
      title: table.name,
      route: 'table',
      bootstrap: {
        slug: table.slug,
        department: table.department,
        columns: cols,
        locked_period: table.locked_period,
        count: table.count,
        allowance: table.row_allowance,
        tier: table.tier,
        per_page: perPage,
        page: pageNumber,
        total,
        view: appliedView ? appliedView.name : null,
        sort: sortColumn || null,
        views: viewsList,
      },
    }),
    body
  );
}

function logPage(ctx) {
  const { table, entries, pageNumber, total } = ctx;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const body = `
<section class="band">
  <h1 class="page-title">Change log</h1>
  ${departmentField(table.department)}
  ${workspaceUpdates()}
  <p class="band-sentence">The append-only change log of ${e(
    table.name
  )}. An entry is never updated and never removed, and the ordinals are contiguous from one.</p>
</section>
<section class="band" aria-labelledby="log-heading">
  <h2 class="section-heading" id="log-heading">Entries, newest first</h2>
  <div class="table-panel" tabindex="0">
    <table class="data-table">
      <caption class="table-caption">Change log of ${e(table.name)}</caption>
      <thead><tr>
        <th scope="col" class="row-title-cell">Ordinal</th>
        <th scope="col">Action</th>
        <th scope="col">Account</th>
        <th scope="col">Column</th>
        <th scope="col">Recorded at</th>
        <th scope="col">Business day</th>
        <th scope="col">Before</th>
        <th scope="col">After</th>
      </tr></thead>
      <tbody>
        ${
          entries.length
            ? entries
                .map(
                  (x) => `<tr class="data-row">
  <th scope="row" class="row-title-cell">${x.ordinal}</th>
  <td>${e(x.action)}</td>
  <td>${e(x.account)}</td>
  <td>${x.column === null ? '' : e(x.column)}</td>
  <td>${e(x.recorded_at)}</td>
  <td>${e(x.business_day)}</td>
  <td>${e(JSON.stringify(x.before === null ? null : x.before))}</td>
  <td>${e(JSON.stringify(x.after === null ? null : x.after))}</td>
</tr>`
                )
                .join('')
            : ''
        }
      </tbody>
    </table>
  </div>
  ${entries.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
  <div class="pager">
    <a class="button button-quiet${pageNumber <= 1 ? ' is-disabled' : ''}" href="/console/tables/${e(
    table.slug
  )}/log?page=${Math.max(1, pageNumber - 1)}">Previous page</a>
    <a class="button button-quiet${pageNumber >= totalPages ? ' is-disabled' : ''}" href="/console/tables/${e(
    table.slug
  )}/log?page=${Math.min(totalPages, pageNumber + 1)}">Next page</a>
    <p class="pager-state">Page ${pageNumber} of ${totalPages}, ${total} entries</p>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Change log', route: 'log' }), body);
}

function snapshotsPage(ctx) {
  const { snapshots, retentionRows, publishable, isSteward } = ctx;
  const body = `
<section class="band">
  <h1 class="page-title">Snapshots</h1>
  ${workspaceUpdates()}
  <div class="retention-banner-slot" id="retention-banner-slot"></div>
</section>
<section class="band">
  <h2 class="section-heading" id="snapshots-heading">Published snapshots and retention</h2>
  <div class="snapshots-layout" id="snapshots-layout">
    <div class="snapshots-actions" id="snapshots-actions">
      ${
        isSteward
          ? '<button type="button" class="button button-primary" id="publish-snapshot" data-open-dialog="publish-snapshot">Publish snapshot</button>'
          : '<p class="band-sentence">A steward of the department publishes a snapshot.</p>'
      }
    </div>
    <div class="snapshots-panels" id="snapshots-panels">
      <section class="panel" aria-labelledby="published-snapshots-heading">
        <h3 class="panel-title" id="published-snapshots-heading">Published snapshots</h3>
        <div class="table-panel" tabindex="0">
          <table class="data-table" id="snapshots-table">
            <caption class="table-caption">Every snapshot of your departments</caption>
            <thead><tr>
              <th scope="col" class="row-title-cell">Period</th>
              <th scope="col">Table</th>
              <th scope="col">Department</th>
              <th scope="col">Sequence</th>
              <th scope="col">Tier</th>
              <th scope="col">Rows</th>
              <th scope="col">Published at</th>
              <th scope="col">Business day</th>
              <th scope="col">Availability</th>
            </tr></thead>
            <tbody id="snapshots-body">
              ${snapshots
                .map(
                  (s, i) => `<tr class="data-row snapshot-row"${
                    s.retained ? '' : ' aria-disabled="true"'
                  } data-retained="${s.retained}" style="animation-delay:${i * 36}ms">
  <th scope="row" class="row-title-cell">${e(s.period)}</th>
  <td>${e(s.table)}</td>
  <td>${e(s.department)}</td>
  <td>${s.sequence}</td>
  <td>${e(s.tier)}</td>
  <td>${s.row_count}</td>
  <td>${e(s.published_at)}</td>
  <td>${e(s.business_day)}</td>
  <td class="availability-cell">${s.retained ? 'Available' : 'Unavailable'}</td>
</tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
        ${snapshots.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
      </section>
      <section class="panel" aria-labelledby="retention-summary-heading">
        <h3 class="panel-title" id="retention-summary-heading">Retention summary</h3>
        <dl class="retention-list">
          ${retentionRows
            .map(
              (r) => `<div class="figure-row">
  <dt>${e(r.department)} on ${e(r.tier)}</dt>
  <dd>retains <span class="retention-words">${e(r.retention)}</span>, holding ${r.retained} of ${r.held} published</dd>
</div>`
            )
            .join('')}
        </dl>
      </section>
    </div>
  </div>
</section>
${isSteward ? dialogs.publishSnapshot(publishable) : ''}`;
  return page(
    Object.assign({}, ctx, {
      title: 'Snapshots',
      route: 'snapshots',
      bootstrap: { snapshots, retention: retentionRows },
    }),
    body
  );
}

function requestsPage(ctx) {
  const { requests, isSteward, departments, account } = ctx;
  const body = `
<section class="band">
  <h1 class="page-title">Access requests</h1>
  ${workspaceUpdates()}
  <p class="band-sentence">An account raises a request for a role on a department it holds no role in. A steward of that department decides it, and nobody decides their own.</p>
</section>
<section class="band" aria-labelledby="raise-heading">
  <h2 class="section-heading" id="raise-heading">Raise a request</h2>
  <form class="panel form-panel" id="request-form" novalidate>
    <div class="field">
      <label class="control-label" for="request-department">Department</label>
      <select class="control" id="request-department" name="department">
        ${departments.map((d) => `<option value="${e(d)}">${e(d)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label class="control-label" for="request-role">Role</label>
      <select class="control" id="request-role" name="role">
        ${['viewer', 'analyst', 'editor', 'steward'].map((r) => `<option value="${r}">${r}</option>`).join('')}
      </select>
    </div>
    <button type="submit" class="button button-primary" id="raise-request">Raise request</button>
    <p class="form-result" id="request-result" role="status" aria-live="polite"></p>
  </form>
</section>
<section class="band" aria-labelledby="requests-heading">
  <h2 class="section-heading" id="requests-heading">Requests you may read</h2>
  <div class="table-panel" tabindex="0">
    <table class="data-table" id="requests-table">
      <caption class="table-caption">Open requests ahead of decided ones</caption>
      <thead><tr>
        <th scope="col" class="row-title-cell">Account</th>
        <th scope="col">Department</th>
        <th scope="col">Role</th>
        <th scope="col">State</th>
        <th scope="col">Raised at</th>
        <th scope="col">Reason</th>
        <th scope="col">Decide</th>
      </tr></thead>
      <tbody id="requests-body">
        ${requests
          .map(
            (r) => `<tr class="data-row request-row" data-request-id="${e(r.id)}" data-state="${e(r.state)}">
  <th scope="row" class="row-title-cell">${e(r.account)}</th>
  <td>${e(r.department)}</td>
  <td>${e(r.role)}</td>
  <td>${e(r.state)}</td>
  <td>${e(r.raised_at)}</td>
  <td>${r.reason ? e(r.reason) : ''}</td>
  <td>${
    r.state === 'open' && isSteward && r.account !== account.email && ctx.stewardOf.includes(r.department)
      ? `<button type="button" class="button button-quiet decide-request-control" data-open-dialog="decide-request" data-request-id="${e(
          r.id
        )}" data-request-department="${e(r.department)}" data-request-account="${e(r.account)}">Decide request</button>`
      : ''
  }</td>
</tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
  ${requests.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
</section>
${dialogs.decideRequest()}`;
  return page(Object.assign({}, ctx, { title: 'Access requests', route: 'requests' }), body);
}

function accountPage(ctx) {
  const { account, grants } = ctx;
  const body = `
<section class="band">
  <h1 class="page-title">Account</h1>
  ${workspaceUpdates()}
</section>
<section class="band" aria-labelledby="account-heading">
  <h2 class="section-heading" id="account-heading">What the store holds for you</h2>
  <dl class="panel account-facts">
    <div class="figure-row"><dt>Display name</dt><dd id="account-display-name">${e(account.display_name)}</dd></div>
    <div class="figure-row"><dt>Work email</dt><dd id="account-email">${e(account.email)}</dd></div>
    <div class="figure-row"><dt>Department</dt><dd id="account-department">${e(account.department)}</dd></div>
    <div class="figure-row"><dt>Tier</dt><dd id="account-tier">${e(account.tier)}</dd></div>
  </dl>
</section>
<section class="band" aria-labelledby="account-grants-heading">
  <h2 class="section-heading" id="account-grants-heading">Every role grant you hold</h2>
  <div class="table-panel" tabindex="0">
    <table class="data-table" id="account-grants">
      <caption class="table-caption">One role per account per department</caption>
      <thead><tr>
        <th scope="col" class="row-title-cell">Department</th>
        <th scope="col">Role</th>
        <th scope="col">Authorises from</th>
      </tr></thead>
      <tbody>
        ${grants
          .map(
            (g) => `<tr class="data-row">
  <th scope="row" class="row-title-cell">${e(g.department)}</th>
  <td>${e(g.role)}</td>
  <td>${e(g.authorises_from)}</td>
</tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
  ${grants.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
</section>`;
  return page(Object.assign({}, ctx, { title: 'Account', route: 'account' }), body);
}

function administrationPage(ctx) {
  const { department, grants, queue, attempts, counts } = ctx;
  const body = `
<section class="band">
  <h1 class="page-title">Steward administration</h1>
  ${departmentField(department)}
  ${workspaceUpdates()}
  <p class="band-sentence">Your writ runs over ${e(
    department
  )} and over no other department. ${counts.grants} role grants and ${counts.open_requests} open requests stand here now.</p>
</section>
<section class="band">
  <h2 class="section-heading" id="administration-heading">Three panels</h2>
  <div class="admin-layout" id="admin-layout">
    <section class="panel admin-panel" aria-labelledby="grant-administration-heading">
      <h3 class="panel-title" id="grant-administration-heading">Grant administration</h3>
      <form class="admin-form" id="grant-form" novalidate>
        <div class="field">
          <label class="control-label" for="grant-account">Account</label>
          <input class="control" id="grant-account" name="account" type="text" autocomplete="off">
        </div>
        <div class="field">
          <label class="control-label" for="grant-role">Role</label>
          <select class="control" id="grant-role" name="role">
            ${['viewer', 'analyst', 'editor', 'steward'].map((r) => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="button button-primary" id="create-grant">Create grant</button>
      </form>
      <div class="table-panel" tabindex="0">
        <table class="data-table" id="grants-table">
          <caption class="table-caption">Role grants of ${e(department)}</caption>
          <thead><tr>
            <th scope="col" class="row-title-cell">Account</th>
            <th scope="col">Role</th>
            <th scope="col">Authorises from</th>
            <th scope="col">Authorising</th>
            <th scope="col">Name</th>
          </tr></thead>
          <tbody id="grants-body">
            ${grants
              .map(
                (g) => `<tr class="data-row grant-row" data-grant-id="${e(g.id)}">
  <th scope="row" class="row-title-cell">${e(g.account)}</th>
  <td>${e(g.role)}</td>
  <td>${e(g.authorises_from)}</td>
  <td>${g.authorising ? 'true' : 'false'}</td>
  <td><label class="revoke-choice"><input type="checkbox" class="revoke-box" data-revoke-id="${e(
    g.id
  )}"><span>Name for revoke</span></label></td>
</tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <button type="button" class="button button-quiet" id="revoke-grants" data-open-dialog="confirm-bulk-revoke">Revoke grants</button>
    </section>
    <section class="panel admin-panel" aria-labelledby="access-request-queue-heading">
      <h3 class="panel-title" id="access-request-queue-heading">Access request queue</h3>
      <div class="table-panel" tabindex="0">
        <table class="data-table" id="queue-table">
          <caption class="table-caption">Open requests ahead of decided ones</caption>
          <thead><tr>
            <th scope="col" class="row-title-cell">Account</th>
            <th scope="col">Role</th>
            <th scope="col">State</th>
            <th scope="col">Raised at</th>
          </tr></thead>
          <tbody id="queue-body">
            ${queue
              .map(
                (r) => `<tr class="data-row queue-row" data-request-id="${e(r.id)}">
  <th scope="row" class="row-title-cell">${e(r.account)}</th>
  <td>${e(r.role)}</td>
  <td>${e(r.state)}</td>
  <td>${e(r.raised_at)}</td>
</tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${queue.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
    </section>
    <section class="panel admin-panel" aria-labelledby="sign-in-attempt-record-heading">
      <h3 class="panel-title" id="sign-in-attempt-record-heading">Sign-in attempt record</h3>
      <div class="table-panel" tabindex="0">
        <table class="data-table" id="attempts-table">
          <caption class="table-caption">Sign-in attempts, newest first</caption>
          <thead><tr>
            <th scope="col" class="row-title-cell">Email</th>
            <th scope="col">Attempted at</th>
            <th scope="col">Outcome</th>
          </tr></thead>
          <tbody id="attempts-body">
            ${attempts
              .map(
                (a) => `<tr class="data-row attempt-row">
  <th scope="row" class="row-title-cell">${e(a.email)}</th>
  <td>${e(a.attempted_at)}</td>
  <td>${e(a.outcome)}</td>
</tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${attempts.length ? '' : '<p class="empty-line">No rows match this view yet.</p>'}
    </section>
  </div>
</section>
${dialogs.confirmBulkRevoke()}`;
  return page(
    Object.assign({}, ctx, {
      title: 'Steward administration',
      route: 'administration',
      bootstrap: { department },
    }),
    body
  );
}

module.exports = {
  consoleHome,
  tableList,
  tablePage,
  logPage,
  snapshotsPage,
  requestsPage,
  accountPage,
  administrationPage,
  cellText,
};
