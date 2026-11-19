'use strict';
const { e, page } = require('./html');

const CLAIMS = [
  {
    title: 'A reader never reaches a foreign row',
    body: 'A role is granted per account per department. A reader with no role on a department is refused its rows, its views, its change log and its snapshots at every address.',
  },
  {
    title: 'An amendment is recorded or refused',
    body: 'One write boundary checks role, then lock, then allowance, then column type. A success writes one change log entry per amended column. A refusal writes none.',
  },
  {
    title: 'A locked table names the period',
    body: 'A steward closes a table for a reporting period. Every further amendment is refused and the refusal names the period that locked it.',
  },
  {
    title: 'A published snapshot keeps its rows',
    body: 'A snapshot freezes the rows the table held at publication, together with the tier rules it was published under. A later amendment changes no snapshot row.',
  },
];

const ROLES = [
  { name: 'viewer', body: 'Reads rows, saved views, the change log and the published snapshots of its department, and changes nothing.' },
  { name: 'analyst', body: 'Also creates, amends and deletes saved views, including shared ones, and still amends no row.' },
  { name: 'editor', body: 'Also amends rows: creates them, updates them and deletes them.' },
  { name: 'steward', body: 'Also locks a table for a reporting period, publishes a snapshot, and decides an access request raised against its own department.' },
];

function landing(ctx) {
  const signedOut = ctx.signedOut
    ? `<p class="signed-out-line" role="status">You are signed out of Keystone Tables.</p>`
    : '';
  const body = `
<section class="band band-hero">
  <h1 class="page-title">Keystone Tables</h1>
  ${signedOut}
  <p class="hero-sentence">Northbank Mutual reports from tables, not from documents: three departments, one governed workspace, and controls that hold.</p>
  <div class="band-actions">
    <a class="button button-primary" href="/login#signup">Create an account</a>
    <a class="button button-quiet" href="/plans">Read the plan matrix</a>
  </div>
</section>
<section class="band band-proof" aria-labelledby="proof-heading">
  <h2 class="section-heading" id="proof-heading">What the workspace guarantees</h2>
  <ul class="claim-list">
    ${CLAIMS.map(
      (c) => `<li class="claim"><h3 class="panel-title">${e(c.title)}</h3><p class="claim-body">${e(c.body)}</p></li>`
    ).join('')}
  </ul>
</section>
<section class="band band-roles" aria-labelledby="roles-heading">
  <h2 class="section-heading" id="roles-heading">Four roles, granted per department</h2>
  <ul class="role-list">
    ${ROLES.map(
      (r) => `<li class="role"><h3 class="panel-title">${e(r.name)}</h3><p class="role-body">${e(r.body)}</p></li>`
    ).join('')}
  </ul>
</section>
<section class="band band-close" aria-labelledby="close-heading">
  <h2 class="section-heading" id="close-heading">Start with the department you report for</h2>
  <p class="band-sentence">A sign up grants no role. You reach a department through an approved access request, decided by a steward of that department.</p>
  <div class="band-actions">
    <a class="button button-primary" href="/login#signup">Create an account</a>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Keystone Tables', route: 'landing' }), body);
}

function plans(ctx) {
  const tiers = ctx.tiers;
  const cards = tiers
    .map(
      (t) => `<li class="tier-card">
  <div class="tier-card-head">
    <h3 class="panel-title tier-name">${e(t.name)}</h3>
    ${t.most_chosen ? '<span class="badge badge-most-chosen">Most chosen</span>' : ''}
  </div>
  <p class="tier-audience">${e(t.audience)}</p>
  <dl class="tier-allowances">
    <div class="allowance-row"><dt>Rows a table</dt><dd><span class="figure" data-figure="row_allowance" data-tier="${e(t.name)}">${t.row_allowance}</span> <span class="period-word" data-period>a year</span></dd></div>
    <div class="allowance-row"><dt>Stored megabytes a department</dt><dd><span class="figure" data-figure="stored_megabytes" data-tier="${e(t.name)}">${t.stored_megabytes}</span> <span class="period-word" data-period>a year</span></dd></div>
    <div class="allowance-row"><dt>Content kilobytes a table</dt><dd><span class="figure" data-figure="content_allowance_kilobytes" data-tier="${e(t.name)}">${t.content_allowance_kilobytes}</span> <span class="period-word" data-period>a year</span></dd></div>
    <div class="allowance-row"><dt>Shared views a table</dt><dd><span class="figure" data-figure="view_allowance" data-tier="${e(t.name)}">${t.view_allowance}</span> <span class="period-word" data-period>a year</span></dd></div>
    <div class="allowance-row"><dt>Snapshot retention</dt><dd><span class="figure" data-figure="retention" data-tier="${e(t.name)}">${e(t.retention)}</span></dd></div>
  </dl>
  <a class="button button-quiet tier-control" href="/login?tier=${e(t.name)}#signup" data-tier-control="${e(t.name)}">Choose ${e(t.name)}</a>
</li>`
    )
    .join('');

  const rowsFor = (label, key, isText) =>
    `<tr><th scope="row">${e(label)}</th>${tiers
      .map(
        (t) =>
          `<td><span class="figure" data-figure="${key}" data-tier="${e(t.name)}">${
            isText ? e(t[key]) : t[key]
          }</span></td>`
      )
      .join('')}</tr>`;

  const body = `
<section class="band">
  <h1 class="page-title">Plan matrix</h1>
  <p class="band-sentence">Four entitlement tiers carry the workspace. Every figure below is the stored grant row the console refuses from, so the page and the refusal can never quote different numbers.</p>
  <div class="plan-toggle" role="group" aria-label="Billing period">
    <button type="button" class="button button-quiet toggle-option is-selected" id="toggle-yearly" data-period-word="a year" aria-pressed="true">Yearly</button>
    <button type="button" class="button button-quiet toggle-option" id="toggle-monthly" data-period-word="a month" aria-pressed="false">Monthly</button>
  </div>
</section>
<section class="band" aria-labelledby="tier-cards-heading">
  <h2 class="section-heading" id="tier-cards-heading">The four tiers in grant order</h2>
  <ul class="tier-cards" id="tier-cards">${cards}</ul>
</section>
<section class="band" aria-labelledby="tier-table-heading">
  <h2 class="section-heading" id="tier-table-heading">The same four tiers, compared</h2>
  <div class="table-panel" tabindex="0">
    <table class="data-table comparison-table">
      <caption class="table-caption">Every allowance, one row each</caption>
      <thead>
        <tr><th scope="col">Allowance</th>${tiers.map((t) => `<th scope="col">${e(t.name)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rowsFor('Rows a table', 'row_allowance', false)}
        ${rowsFor('Stored megabytes a department', 'stored_megabytes', false)}
        ${rowsFor('Content kilobytes a table', 'content_allowance_kilobytes', false)}
        ${rowsFor('Shared views a table', 'view_allowance', false)}
        ${rowsFor('Snapshot retention', 'retention', true)}
      </tbody>
    </table>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Plan matrix', route: 'plans' }), body);
}

function field(opts) {
  const id = opts.id;
  const required = opts.required
    ? ' required aria-required="true"'
    : '';
  const mark = opts.required ? ' <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">(required)</span>' : '';
  const control = opts.textarea
    ? `<textarea class="control" id="${id}" name="${id}" rows="4"${required} maxlength="4000" aria-describedby="${id}-error"></textarea>`
    : `<input class="control" id="${id}" name="${id}" type="${opts.type || 'text'}"${required} aria-describedby="${id}-error"${
        opts.autocomplete ? ` autocomplete="${opts.autocomplete}"` : ''
      }>`;
  return `<div class="field">
  <label class="control-label" for="${id}">${e(opts.label)}${mark}</label>
  ${control}
  <p class="field-error" id="${id}-error" data-error-for="${id}" hidden></p>
</div>`;
}

function enquiry(ctx) {
  const body = `
<section class="band">
  <h1 class="page-title">Qualified sales enquiry</h1>
  <p class="band-sentence">Tell us which department reports from tables today and we will answer against your work email. Nothing is emailed by this build; a recorded enquiry is confirmed on screen.</p>
</section>
<section class="band" aria-labelledby="enquiry-heading">
  <h2 class="section-heading" id="enquiry-heading">Your enquiry</h2>
  <form class="panel form-panel" id="enquiry-form" method="post" action="/api/enquiries" novalidate>
    <input type="hidden" name="form_token" id="form_token" value="${e(ctx.formToken)}">
    ${field({ id: 'full_name', label: 'Full name', required: true, autocomplete: 'name' })}
    ${field({ id: 'work_email', label: 'Work email', required: true, autocomplete: 'email' })}
    ${field({ id: 'phone', label: 'Phone number', required: false, autocomplete: 'tel' })}
    ${field({ id: 'company', label: 'Company name', required: true, autocomplete: 'organization' })}
    ${field({ id: 'role', label: 'Role', required: false, autocomplete: 'organization-title' })}
    ${field({ id: 'message', label: 'Message', required: true, textarea: true })}
    <p class="field-hint">A message carries at most 1000 characters.</p>
    <button type="submit" class="button button-primary" id="send-enquiry">Send enquiry</button>
    <p class="form-result" id="enquiry-result" role="status" aria-live="polite"></p>
  </form>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Sales enquiry', route: 'enquiry' }), body);
}

function community(ctx) {
  const body = `
<section class="band">
  <h1 class="page-title">Community</h1>
  <p class="band-sentence">Stewards, analysts and editors across insurance operations groups compare how they close a period. Read the founder note and take the occasional letter.</p>
</section>
<section class="band" aria-labelledby="founder-heading">
  <h2 class="section-heading" id="founder-heading">A note from the founder</h2>
  <figure class="panel founder-note">
    <blockquote class="founder-quote">
      <p>We built Keystone Tables because a reporting pack assembled out of documents cannot be audited. A table can. Every amendment in this workspace is either in the change log or it was refused, and the refusal says which control stopped it. That is the whole product.</p>
    </blockquote>
    <figcaption class="founder-attribution">Asha Varghese, founder, Keystone Tables</figcaption>
  </figure>
</section>
<section class="band" aria-labelledby="newsletter-heading">
  <h2 class="section-heading" id="newsletter-heading">The occasional letter</h2>
  <form class="panel form-panel" id="subscribe-form" method="post" action="/api/subscribers" novalidate>
    <input type="hidden" name="form_token" id="subscribe_form_token" value="${e(ctx.formToken)}">
    ${field({ id: 'email', label: 'Email address', required: true, autocomplete: 'email' })}
    <button type="submit" class="button button-primary" id="subscribe">Subscribe</button>
    <p class="form-result" id="subscribe-result" role="status" aria-live="polite"></p>
  </form>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Community', route: 'community' }), body);
}

const INTERFACE_ROWS = [
  ['GET /api/health', 'none', 'readiness', '—'],
  ['GET /api/tiers', 'none', 'the four tiers in grant order with every allowance', '—'],
  ['GET /api/tables', 'any role on the department', 'the tables the caller may read, in name order', '401 without a session'],
  ['GET /api/tables/{slug}', 'any role on the department', 'one table with its columns, tier, allowances, count and read_at', '403 naming the department'],
  ['GET /api/tables/{slug}/rows', 'any role on the department', 'one page of rows, with X-Total-Count and X-Next-Cursor', '403 naming the department'],
  ['POST /api/tables/{slug}/rows', 'editor or steward', 'the created row with its version', '403 for a viewer or an analyst'],
  ['PATCH /api/tables/{slug}/rows/{id}', 'editor or steward', 'the updated row with its raised version', '409 for a lock or a stale version'],
  ['DELETE /api/tables/{slug}/rows/{id}', 'editor or steward', 'no content', '409 naming the locking period'],
  ['GET /api/tables/{slug}/log', 'any role on the department', 'change log entries, newest first, twenty a page', '403 for no role; no role amends it'],
  ['GET /api/tables/{slug}/views', 'any role on the department', 'the views the caller may read', '403 naming the department'],
  ['POST /api/tables/{slug}/views', 'analyst, editor or steward', 'the created view', '403 for a viewer'],
  ['POST /api/tables/{slug}/lock', 'steward', 'the table with its locked period', '403 for every other role'],
  ['GET /api/snapshots', 'any role on the department', 'the retained snapshots the caller may read', '403 naming the department'],
  ['POST /api/snapshots', 'steward', 'the published snapshot', '409 for a repeat period'],
  ['GET /api/requests', 'any signed in account', 'the requests the caller may read', '401 without a session'],
  ['POST /api/requests/{id}/decision', 'steward of the requested department', 'the decided request', '403 for its own requester'],
  ['GET /api/login-attempts', 'steward', 'the recorded sign-in attempts, newest first', '403 for every other role'],
  ['GET /api/admin/grants', 'steward', "the role grants of the caller's own department", '403 for every other role'],
];

function developers(ctx) {
  const body = `
<section class="band">
  <h1 class="page-title">Developer interface reference</h1>
  <p class="band-sentence">The read interface over tables and rows is served on the app's own origin under the <code>/api</code> prefix. Bearer auth is required on every address below except health and the tier grant table.</p>
  <div class="band-actions">
    <a class="button button-quiet" href="/login">Sign in</a>
  </div>
</section>
<section class="band" aria-labelledby="interface-heading">
  <h2 class="section-heading" id="interface-heading">Addresses, roles, shapes and refusals</h2>
  <div class="table-panel" tabindex="0">
    <table class="data-table">
      <caption class="table-caption">Which role each address needs</caption>
      <thead><tr>
        <th scope="col">Address</th><th scope="col">Role needed</th><th scope="col">Shape received</th><th scope="col">Refusal without a role</th>
      </tr></thead>
      <tbody>
        ${INTERFACE_ROWS.map(
          (r) =>
            `<tr><th scope="row"><code>${e(r[0])}</code></th><td>${e(r[1])}</td><td>${e(r[2])}</td><td>${e(r[3])}</td></tr>`
        ).join('')}
      </tbody>
    </table>
  </div>
</section>
<section class="band" aria-labelledby="refusal-heading">
  <h2 class="section-heading" id="refusal-heading">One refusal shape</h2>
  <p class="band-sentence">Every refusal carries a <code>reason</code> string and the <code>field</code> it concerns. A refusal is never a server error and never a silent success. A type refusal answers <code>422</code>, a department refusal <code>403</code>, a locked table <code>409</code> naming its period, and an address with no session <code>401</code>.</p>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Developer interface reference', route: 'developers' }), body);
}

function login(ctx) {
  const tier = ctx.tier || 'starter';
  const body = `
<section class="band">
  <h1 class="page-title">Sign in</h1>
  <p class="band-sentence">A session carries the account it belongs to and nothing a grant decides, so every request reads its role grants from the store.</p>
</section>
<section class="band" aria-labelledby="signin-heading">
  <h2 class="section-heading" id="signin-heading">Sign in to the console</h2>
  <form class="panel form-panel" id="login-form" method="post" action="/api/auth/login" novalidate>
    ${field({ id: 'email', label: 'Work email', required: true, autocomplete: 'email' })}
    ${field({ id: 'password', label: 'Password', required: true, type: 'password', autocomplete: 'current-password' })}
    <button type="submit" class="button button-primary" id="sign-in">Sign in</button>
    <p class="form-result" id="login-result" role="status" aria-live="polite"></p>
  </form>
</section>
<section class="band" id="signup" aria-labelledby="signup-heading">
  <h2 class="section-heading" id="signup-heading">Create an account</h2>
  <p class="band-sentence">A sign up creates no role grant and opens no session. You sign in afterwards and reach a department through an approved access request.</p>
  <form class="panel form-panel" id="signup-form" method="post" action="/api/auth/signup" novalidate>
    ${field({ id: 'signup_email', label: 'Work email', required: true, autocomplete: 'email' })}
    ${field({ id: 'signup_display_name', label: 'Display name', required: true, autocomplete: 'name' })}
    <div class="field">
      <label class="control-label" for="signup_department">Department <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">(required)</span></label>
      <select class="control" id="signup_department" name="signup_department" required aria-required="true" aria-describedby="signup_department-error">
        <option value="claims">claims</option>
        <option value="underwriting">underwriting</option>
        <option value="actuarial">actuarial</option>
      </select>
      <p class="field-error" id="signup_department-error" data-error-for="signup_department" hidden></p>
    </div>
    <div class="field">
      <label class="control-label" for="signup_tier">Tier <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">(required)</span></label>
      <select class="control" id="signup_tier" name="signup_tier" required aria-required="true" aria-describedby="signup_tier-error">
        ${['starter', 'team', 'scale', 'regulated']
          .map((t) => `<option value="${t}"${t === tier ? ' selected' : ''}>${t}</option>`)
          .join('')}
      </select>
      <p class="field-error" id="signup_tier-error" data-error-for="signup_tier" hidden></p>
    </div>
    ${field({ id: 'signup_password', label: 'Password', required: true, type: 'password', autocomplete: 'new-password' })}
    <p class="field-hint">A password is at least 12 characters long and is none of the four published obvious passwords.</p>
    <button type="submit" class="button button-quiet" id="create-account">Create account</button>
    <p class="form-result" id="signup-result" role="status" aria-live="polite"></p>
  </form>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Sign in', route: 'login' }), body);
}

function notFound(ctx) {
  const body = `
<section class="band band-refusal">
  <h1 class="page-title">Address not found</h1>
  <p class="refusal-sentence">That address is not part of Keystone Tables.</p>
  <div class="band-actions">
    <a class="button button-quiet" href="/">Back to the landing page</a>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Address not found', route: 'not-found' }), body);
}

function departmentRefusal(ctx) {
  const body = `
<section class="band band-refusal">
  <h1 class="page-title refusal-heading">This department is closed to you.</h1>
  <div class="department-field refusal-department" role="group" aria-label="Department" data-department="${e(ctx.department)}">
    <span class="department-label">Department</span>
    <span class="department-value">${e(ctx.department)}</span>
  </div>
  <p class="refusal-sentence">You hold no role on ${e(ctx.department)}. A steward of ${e(
    ctx.department
  )} decides the access request that opens it to you.</p>
  <div class="band-actions">
    <a class="button button-quiet" href="/console/requests">Raise an access request</a>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Department closed', route: 'refusal' }), body);
}

function sessionRefusal(ctx) {
  const body = `
<section class="band band-refusal">
  <h1 class="page-title refusal-heading">This console needs a session.</h1>
  <p class="refusal-sentence">Sign in to reach the workspace. This address exists; it is closed until a session opens it.</p>
  <div class="band-actions">
    <a class="button button-quiet" href="/login">Sign in</a>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Session needed', route: 'refusal' }), body);
}

function stewardRefusal(ctx) {
  const body = `
<section class="band band-refusal">
  <h1 class="page-title refusal-heading">This console is for stewards only.</h1>
  <p class="refusal-sentence">This console is for stewards only.</p>
  <div class="band-actions">
    <a class="button button-quiet" href="/console/tables">Back to the tables</a>
  </div>
</section>`;
  return page(Object.assign({}, ctx, { title: 'Stewards only', route: 'refusal' }), body);
}

module.exports = {
  landing,
  plans,
  enquiry,
  community,
  developers,
  login,
  notFound,
  departmentRefusal,
  sessionRefusal,
  stewardRefusal,
  field,
};
