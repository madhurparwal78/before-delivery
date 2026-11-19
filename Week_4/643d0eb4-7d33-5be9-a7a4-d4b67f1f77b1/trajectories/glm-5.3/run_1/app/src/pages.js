// The server-rendered pages: the six public addresses, the console workspace, the refusal
// pages and the custom not-found page. Every address carries the same chrome.
const express = require('express');
const crypto = require('crypto');
const { pool, uid, TIERS, DEPARTMENTS, businessDay } = require('./store');
const {
  now, iso, accountGrants, roleOn, tierGrantInForce, readSession,
  applyFilters, sortCompare, encodeCursor, decodeCursor, OPERATORS_BY_TYPE,
  SESSION_COOKIE, kilobytes,
} = require('./helpers');

const router = express.Router();

// ---------- escaping ----------

function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const JSON_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
function escAttrKey(key) {
  return JSON_KEY_RE.test(key) ? key : 'data-key';
}

// ---------- issued form tokens ----------

async function issueFormToken() {
  const value = crypto.randomBytes(24).toString('hex');
  await pool.query('INSERT INTO form_tokens (id, value, issued_at) VALUES ($1,$2,$3)', [uid('ft'), value, now()]);
  return value;
}

// ---------- chrome ----------

const ROUTE_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/plans', label: 'Plans' },
  { href: '/enquiry', label: 'Enquiry' },
  { href: '/community', label: 'Community' },
  { href: '/developers', label: 'Developers' },
];

const CONSOLE_LINKS = [
  { href: '/console/tables', label: 'Tables' },
  { href: '/console/snapshots', label: 'Snapshots' },
  { href: '/console/requests', label: 'Requests' },
  { href: '/console/account', label: 'Account' },
];

const PALETTE = {
  surface: '#fbfcfd',
  ink: '#141922',
  muted: '#5f6b7a',
  hairline: '#e7ecf1',
  action: '#1d63d8',
  actionDeep: '#174a9e',
  affirm: '#157f3d',
  refuse: '#c73223',
  caution: '#c2660a',
  focus: '#1d63d8',
};

// The one status region every console address carries. It announces politely and holds one
// sentence at a time.
function statusRegion() {
  return `<div id="workspace-updates" class="status-region" role="status" aria-label="Workspace updates"></div>`;
}

function headerChrome(account, activeHref) {
  const linkHtml = (links) => links.map(l =>
    `<a class="nav-link${l.href === activeHref ? ' is-active' : ''}" href="${l.href}">${esc(l.label)}</a>`).join('');
  const consoleLinks = account ? linkHtml(CONSOLE_LINKS) : '';
  const accountControl = account
    ? `<div class="account-control">
         <a class="account-name" href="/console/account">${esc(account.display_name)}</a>
         <button type="button" class="btn btn-secondary btn-small" id="signout-button" data-control="Sign out">Sign out</button>
       </div>`
    : `<div class="account-control"><a class="btn btn-primary btn-small" href="/login" data-control="Sign in">Sign in</a></div>`;
  return `
  <header class="site-header" id="site-header">
    <div class="header-inner">
      <a class="product-mark" href="/" aria-label="Keystone Tables home">
        <span class="mark-block" aria-hidden="true"></span>
        <span class="mark-word">Keystone Tables</span>
      </a>
      <nav class="site-nav-desktop" aria-label="Site">
        ${linkHtml(ROUTE_LINKS)}
        ${account ? linkHtml(CONSOLE_LINKS) : ''}
      </nav>
      ${accountControl}
      <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav-drawer" data-control="Menu">
        <span class="nav-toggle-bars" aria-hidden="true"></span>
        <span class="nav-toggle-label">Menu</span>
      </button>
    </div>
  </header>
  <div class="nav-drawer" id="nav-drawer" hidden>
    <nav class="drawer-nav" aria-label="Site">
      ${linkHtml(ROUTE_LINKS)}
      ${consoleLinks}
    </nav>
  </div>`;
}

function footerChrome() {
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-links">
        ${ROUTE_LINKS.map(l => `<a href="${l.href}">${esc(l.label)}</a>`).join('')}
      </div>
      <div class="footer-departments">
        <span class="footer-heading">Departments</span>
        <span>${DEPARTMENTS.map(d => esc(d.slug)).join(', ')}</span>
      </div>
      <p class="footer-legal">Northbank Mutual runs Keystone Tables for its insurance operations group.</p>
    </div>
  </footer>`;
}

function page({ title, h1, account, activeHref, body, consolePage = false, extraScripts = '', banner = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/css/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/js/app.js" defer></script>
</head>
<body data-console="${consolePage ? 'true' : 'false'}">
${headerChrome(account, activeHref)}
<div class="nav-scrim" id="nav-scrim" hidden></div>
<main class="page-frame" id="main">
${banner}
${consolePage ? statusRegion() : ''}
${body}
</main>
${footerChrome()}
${extraScripts}
</body>
</html>`;
}

// ---------- the public pages ----------

const LANDING_CLAIMS = [
  { title: 'Governed by role', body: 'A reader reaches only the department they hold a role in, and a steward decides every request.' },
  { title: 'Typed at the boundary', body: 'Every write passes one boundary that checks role, lock, allowance and type before anything is written.' },
  { title: 'Frozen in time', body: 'A published snapshot keeps the rows it held at publication, whatever the live table does next.' },
  { title: 'Audited end to end', body: 'Every amendment appends to a hash-chained log nobody edits, and the ordinals never restart.' },
];

const LANDING_ROLES = [
  { name: 'viewer', reads: 'yes', amends: 'no', views: 'no', decides: 'no' },
  { name: 'analyst', reads: 'yes', amends: 'no', views: 'yes', decides: 'no' },
  { name: 'editor', reads: 'yes', amends: 'yes', views: 'yes', decides: 'no' },
  { name: 'steward', reads: 'yes', amends: 'yes', views: 'yes', decides: 'yes' },
];

function landingPage(account) {
  const body = `
  <div class="band band-hero">
    <div class="band-inner">
      <h1 class="page-title">Keystone Tables</h1>
      <p class="hero-description">A governed reporting workspace for the tables Northbank Mutual reports from.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/login?signup=1" data-control="Create an account">Create an account</a>
        <a class="btn btn-secondary" href="/plans" data-control="See the plans">See the plans</a>
      </div>
    </div>
  </div>
  <div class="band band-proof">
    <div class="band-inner">
      <h2 class="section-heading">Four claims hold the whole product</h2>
      <ul class="proof-list">
        ${LANDING_CLAIMS.map(c => `<li class="proof-card"><h3 class="proof-title">${esc(c.title)}</h3><p class="proof-body">${esc(c.body)}</p></li>`).join('')}
      </ul>
    </div>
  </div>
  <div class="band band-roles">
    <div class="band-inner">
      <h2 class="section-heading">Four roles, granted per department</h2>
      <div class="table-panel roles-panel">
        <div class="panel-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" class="cell-rowtitle">Role</th>
                <th scope="col">Reads rows</th>
                <th scope="col">Amends rows</th>
                <th scope="col">Manages views</th>
                <th scope="col">Decides requests</th>
              </tr>
            </thead>
            <tbody>
              ${LANDING_ROLES.map(r => `<tr>
                <th scope="row" class="cell-rowtitle">${esc(r.name)}</th>
                <td>${esc(r.reads)}</td><td>${esc(r.amends)}</td><td>${esc(r.views)}</td><td>${esc(r.decides)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  <div class="band band-close">
    <div class="band-inner">
      <h2 class="section-heading">Close your period with the rows you trust</h2>
      <p class="band-copy">Lock a table, publish its snapshot, and read it back exactly as it stood.</p>
      <a class="btn btn-primary" href="/login?signup=1" data-control="Create an account">Create an account</a>
    </div>
  </div>`;
  return page({ title: 'Keystone Tables', h1: 'Keystone Tables', account, activeHref: '/', body });
}

// The plan matrix: the four tiers as cards in grant order, then the same tiers again in a
// comparison table. Every figure comes from the stored grant rows.
async function plansPage(account) {
  const r = await pool.query('SELECT * FROM tiers ORDER BY position');
  const tiers = r.rows;
  const mostChosen = 'team';
  const card = (t) => `
    <article class="tier-card${t.name === mostChosen ? ' is-most-chosen' : ''}">
      ${t.name === mostChosen ? '<p class="tier-badge">Most chosen</p>' : ''}
      <h3 class="tier-name">${esc(t.name)}</h3>
      <p class="tier-audience">${esc(tierAudience(t.name))}</p>
      <dl class="tier-figures">
        <div class="tier-figure"><dt>Row allowance per table</dt><dd data-figure="row_allowance" data-value="${t.row_allowance}">${t.row_allowance.toLocaleString('en-US')} rows</dd></div>
        <div class="tier-figure"><dt>Stored megabytes per department</dt><dd>${t.stored_megabytes.toLocaleString('en-US')} MB</dd></div>
        <div class="tier-figure"><dt>Content kilobytes per table</dt><dd>${t.content_allowance_kilobytes.toLocaleString('en-US')} KB</dd></div>
        <div class="tier-figure"><dt>Shared views per table</dt><dd>${t.view_allowance.toLocaleString('en-US')}</dd></div>
        <div class="tier-figure"><dt>Snapshot retention</dt><dd>${esc(t.retention)}</dd></div>
      </dl>
      <a class="btn btn-primary tier-cta" href="/login?signup=1&tier=${esc(t.name)}" data-control="Choose ${esc(t.name)}" data-tier="${esc(t.name)}">Choose ${esc(t.name)}</a>
    </article>`;
  const compareRow = (label, pick) => `
    <tr><th scope="row" class="cell-rowtitle">${esc(label)}</th>${tiers.map(pick).map(v => `<td>${v}</td>`).join('')}</tr>`;
  const body = `
  <div class="band band-plans">
    <div class="band-inner">
      <h1 class="page-title">Plan matrix</h1>
      <p class="band-copy">Four tiers carry the product. Every figure below is the same grant row the console refuses from.</p>
      <div class="plan-toggle" role="group" aria-label="Billing period">
        <button type="button" class="toggle-option is-active" id="toggle-yearly" aria-pressed="true">yearly</button>
        <button type="button" class="toggle-option" id="toggle-monthly" aria-pressed="false">monthly</button>
      </div>
      <div class="tier-cards" id="tier-cards">
        ${tiers.map(card).join('')}
      </div>
    </div>
  </div>
  <div class="band band-compare">
    <div class="band-inner">
      <h2 class="section-heading">The same allowances, compared</h2>
      <div class="table-panel">
        <div class="panel-scroll">
          <table class="data-table plan-table">
            <thead>
              <tr>
                <th scope="col" class="cell-rowtitle">Allowance</th>
                ${tiers.map(t => `<th scope="col">${esc(t.name)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${compareRow('Row allowance per table', t => `${t.row_allowance.toLocaleString('en-US')} rows`)}
              ${compareRow('Stored megabytes per department', t => `${t.stored_megabytes.toLocaleString('en-US')} MB`)}
              ${compareRow('Content kilobytes per table', t => `${t.content_allowance_kilobytes.toLocaleString('en-US')} KB`)}
              ${compareRow('Shared views per table', t => t.view_allowance)}
              ${compareRow('Snapshot retention', t => esc(t.retention))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
  return page({ title: 'Plan matrix — Keystone Tables', h1: 'Plan matrix', account, activeHref: '/plans', body });
}

function tierAudience(name) {
  switch (name) {
    case 'starter': return 'A single reporting desk closing its first periods.';
    case 'team': return 'A department running its own book of tables.';
    case 'scale': return 'High-volume exposure tables and long histories.';
    case 'regulated': return 'Departments answering to a regulator, with every period retained.';
    default: return '';
  }
}

// The qualified sales enquiry. Four mandatory controls are marked required; a malformed work
// email is refused inline with the typed value kept.
async function enquiryPage(account, { error = null, errorField = null, submitted = null, values = {} } = {}) {
  const token = await issueFormToken();
  const fieldError = (name) => error && errorField === name
    ? `<p class="field-error" id="${name}-error">${esc(error)}</p>` : '';
  const invalidAttr = (name) => error && errorField === name ? ' aria-invalid="true" aria-describedby="' + name + '-error"' : '';
  const val = (name) => esc(values[name] || '');
  const body = `
  <div class="band band-enquiry">
    <div class="band-inner form-band">
      <h1 class="page-title">Talk to us</h1>
      <p class="band-copy">A qualified sales enquiry reaches the team behind Keystone Tables.</p>
      ${submitted ? `<p class="confirm-note" role="status">Enquiry recorded against ${esc(submitted)}.</p>` : ''}
      <form class="stacked-form" method="post" action="/enquiry" novalidate>
        <input type="hidden" name="form_token" value="${token}">
        <div class="form-field">
          <label class="control-label" for="full_name">Full name <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">required</span></label>
          <input class="control" id="full_name" name="full_name" type="text" value="${val('full_name')}" required aria-required="true"${invalidAttr('full_name')}>
          ${fieldError('full_name')}
        </div>
        <div class="form-field">
          <label class="control-label" for="work_email">Work email <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">required</span></label>
          <input class="control" id="work_email" name="work_email" type="text" value="${val('work_email')}" required aria-required="true"${invalidAttr('work_email')}>
          ${fieldError('work_email')}
        </div>
        <div class="form-field">
          <label class="control-label" for="phone">Phone number</label>
          <input class="control" id="phone" name="phone" type="text" value="${val('phone')}">
        </div>
        <div class="form-field">
          <label class="control-label" for="company">Company name <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">required</span></label>
          <input class="control" id="company" name="company" type="text" value="${val('company')}" required aria-required="true"${invalidAttr('company')}>
          ${fieldError('company')}
        </div>
        <div class="form-field">
          <label class="control-label" for="role">Role</label>
          <input class="control" id="role" name="role" type="text" value="${val('role')}">
        </div>
        <div class="form-field">
          <label class="control-label" for="message">Message <span class="required-mark" aria-hidden="true">*</span><span class="visually-hidden">required</span></label>
          <textarea class="control" id="message" name="message" rows="5" required aria-required="true" maxlength="1000"${invalidAttr('message')}>${val('message')}</textarea>
          ${fieldError('message')}
        </div>
        <button class="btn btn-primary" type="submit" data-control="Send enquiry">Send enquiry</button>
      </form>
    </div>
  </div>`;
  return page({ title: 'Enquiry — Keystone Tables', h1: 'Talk to us', account, activeHref: '/enquiry', body });
}

async function communityPage(account, { subscribedEmail = null } = {}) {
  const token = await issueFormToken();
  const body = `
  <div class="band band-community">
    <div class="band-inner form-band">
      <h1 class="page-title">Community</h1>
      <p class="band-copy">The people who report from tables, sharing what they learn.</p>
    </div>
  </div>
  <div class="band band-founder">
    <div class="band-inner">
      <blockquote class="founder-note">
        <p>Every number this product answers is one a steward signed off. That is the whole idea, and it is the only idea that survives an audit.</p>
        <footer class="founder-attrib">Marta Ellison, founder</footer>
      </blockquote>
    </div>
  </div>
  <div class="band band-newsletter">
    <div class="band-inner form-band">
      <h2 class="section-heading">The newsletter</h2>
      <p class="band-copy">One address, recorded once, thanked every time.</p>
      ${subscribedEmail ? `<p class="confirm-note" role="status">Thank you. ${esc(subscribedEmail)} is subscribed.</p>` : ''}
      <form class="inline-form" method="post" action="/community" novalidate>
        <input type="hidden" name="form_token" value="${token}">
        <div class="form-field">
          <label class="control-label" for="newsletter_email">Email</label>
          <input class="control" id="newsletter_email" name="email" type="text" required aria-required="true">
        </div>
        <button class="btn btn-primary" type="submit" data-control="Subscribe">Subscribe</button>
      </form>
    </div>
  </div>`;
  return page({ title: 'Community — Keystone Tables', h1: 'Community', account, activeHref: '/community', body });
}

const API_REFERENCE = [
  { method: 'GET', address: '/api/health', role: 'no session', shape: '{ "status": "ok" }', refusal: '—' },
  { method: 'POST', address: '/api/auth/login', role: 'no session', shape: 'the bearer token under token and the account role grants', refusal: '401 with Email or password is wrong.' },
  { method: 'POST', address: '/api/auth/signup', role: 'no session', shape: 'the created account with email, display_name, department and tier', refusal: '422 naming email, password, department or tier' },
  { method: 'POST', address: '/api/auth/logout', role: 'any session', shape: 'no content', refusal: '401 without a session' },
  { method: 'GET', address: '/api/tiers', role: 'no session', shape: 'the four tiers in grant order with every allowance', refusal: '—' },
  { method: 'GET', address: '/api/tables', role: 'any role on the department', shape: 'the tables the caller may read, in name order', refusal: '401 without a session' },
  { method: 'GET', address: '/api/tables/{slug}', role: 'any role on the department', shape: 'columns in position order, tier, row_allowance, count, stored_kilobytes, content_bytes, content_kilobytes, log_high_ordinal, read_at', refusal: '404 for a table that does not exist; 403 holding no role on the department' },
  { method: 'GET', address: '/api/tables/{slug}/rows', role: 'any role on the department', shape: 'one page of rows; X-Total-Count carries the total, X-Next-Cursor the next page', refusal: '403 holding no role; 422 for per_page above 500 or a foreign cursor' },
  { method: 'POST', address: '/api/tables/{slug}/rows', role: 'editor or steward', shape: 'the created row with id and version 1', refusal: '403 for viewer and analyst; 409 locked; 422 allowance or type' },
  { method: 'PATCH', address: '/api/tables/{slug}/rows/{id}', role: 'editor or steward', shape: 'the updated row with its raised version', refusal: '409 for a stale If-Match-Version or a lock; 422 allowance or type' },
  { method: 'DELETE', address: '/api/tables/{slug}/rows/{id}', role: 'editor or steward', shape: 'no content', refusal: '403, 409 or 422 by the same boundary' },
  { method: 'GET', address: '/api/tables/{slug}/log', role: 'any role on the department', shape: 'change log entries newest first, twenty at a time', refusal: '403 holding no role; no role amends it' },
  { method: 'POST', address: '/api/tables/{slug}/lock', role: 'steward', shape: 'the table with its locked period', refusal: '403 for every other role' },
  { method: 'DELETE', address: '/api/tables/{slug}/lock', role: 'steward', shape: 'the table with no locked period', refusal: '403 for every other role' },
  { method: 'GET', address: '/api/snapshots', role: 'any role on the department', shape: 'the retained snapshots the caller may read', refusal: '401 without a session' },
  { method: 'GET', address: '/api/snapshots/{id}', role: 'any role on the department', shape: 'one snapshot with its frozen rows', refusal: '410 once past its retention; 403 holding no role' },
  { method: 'POST', address: '/api/snapshots', role: 'steward', shape: 'the published snapshot', refusal: '409 for a repeat period; 403 for every other role' },
  { method: 'GET', address: '/api/departments/{slug}/grants', role: 'any role on the department', shape: 'the department tier grants oldest first with in_force', refusal: '403 holding no role' },
  { method: 'GET', address: '/api/requests', role: 'a session', shape: 'the requests the caller may read', refusal: '401 without a session' },
  { method: 'POST', address: '/api/requests', role: 'a session holding no role on the department', shape: 'the created request at open', refusal: '409 for a repeat while one is open' },
  { method: 'POST', address: '/api/requests/{id}/decision', role: 'a steward of the requested department', shape: 'the decided request', refusal: '403 deciding your own; 409 already decided' },
];

function developersPage(account) {
  const rows = API_REFERENCE.map(r => `<tr>
    <th scope="row" class="cell-rowtitle"><code>${esc(r.method)}</code> ${esc(r.address)}</th>
    <td>${esc(r.role)}</td>
    <td>${esc(r.shape)}</td>
    <td>${esc(r.refusal)}</td>
  </tr>`).join('');
  const body = `
  <div class="band band-developers">
    <div class="band-inner">
      <h1 class="page-title">Developer interface reference</h1>
      <p class="band-copy">The read interface over tables and rows. Every closed address answers 401 without a session.</p>
      <p class="band-copy"><a class="btn btn-primary" href="/login" data-control="Sign in">Sign in</a></p>
      <div class="table-panel">
        <div class="panel-scroll">
          <table class="data-table api-table">
            <thead>
              <tr>
                <th scope="col" class="cell-rowtitle">Address</th>
                <th scope="col">Role a caller needs</th>
                <th scope="col">Shape a caller receives</th>
                <th scope="col">Refusal without the role</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
  return page({ title: 'Developer interface reference — Keystone Tables', h1: 'Developer interface reference', account, activeHref: '/developers', body });
}

// Sign in and sign up on one page. The plan tier control carries its tier into the form.
function loginPage(account, { signup = false, tier = null, error = null, values = {}, preselectTier = null } = {}) {
  const initialTier = tier || preselectTier || 'starter';
  const body = `
  <div class="band band-login">
    <div class="band-inner form-band">
      <h1 class="page-title">${signup ? 'Create an account' : 'Sign in'}</h1>
      <p class="band-copy">${signup ? 'A sign up records your account and grants no role until a steward approves one.' : 'Sign in with your work email and password.'}</p>
      <div class="auth-tabs" role="tablist" aria-label="Authentication">
        <button type="button" role="tab" class="auth-tab${signup ? '' : ' is-active'}" id="tab-signin" aria-selected="${signup ? 'false' : 'true'}" data-panel="signin-panel" data-control="Sign in">Sign in</button>
        <button type="button" role="tab" class="auth-tab${signup ? ' is-active' : ''}" id="tab-signup" aria-selected="${signup ? 'true' : 'false'}" data-panel="signup-panel" data-control="Create an account">Create an account</button>
      </div>
      <div class="auth-panel" id="signin-panel" ${signup ? 'hidden' : ''}>
        <form class="stacked-form" id="signin-form" novalidate>
          <div class="form-field">
            <label class="control-label" for="signin_email">Work email</label>
            <input class="control" id="signin_email" name="email" type="text" autocomplete="username" value="${esc(values.email || '')}">
            <p class="field-error" id="signin-error" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
          </div>
          <div class="form-field">
            <label class="control-label" for="signin_password">Password</label>
            <input class="control" id="signin_password" name="password" type="password" autocomplete="current-password">
          </div>
          <button class="btn btn-primary" type="submit" data-control="Sign in">Sign in</button>
        </form>
      </div>
      <div class="auth-panel" id="signup-panel" ${signup ? '' : 'hidden'}>
        <form class="stacked-form" id="signup-form" novalidate>
          <div class="form-field">
            <label class="control-label" for="signup_display_name">Display name</label>
            <input class="control" id="signup_display_name" name="display_name" type="text" value="${esc(values.display_name || '')}">
          </div>
          <div class="form-field">
            <label class="control-label" for="signup_email">Work email</label>
            <input class="control" id="signup_email" name="email" type="text" autocomplete="username" value="${esc(values.email || '')}">
          </div>
          <div class="form-field">
            <label class="control-label" for="signup_department">Department</label>
            <select class="control" id="signup_department" name="department">
              ${DEPARTMENTS.map(d => `<option value="${esc(d.slug)}"${values.department === d.slug ? ' selected' : ''}>${esc(d.slug)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label class="control-label" for="signup_password">Password</label>
            <input class="control" id="signup_password" name="password" type="password" autocomplete="new-password">
            <p class="field-hint">At least 12 characters, and none of the four obvious passwords.</p>
          </div>
          <div class="form-field">
            <label class="control-label" for="signup_tier">Tier</label>
            <select class="control" id="signup_tier" name="tier">
              ${['starter', 'team', 'scale', 'regulated'].map(t => `<option value="${t}"${initialTier === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" type="submit" data-control="Create an account">Create an account</button>
        </form>
      </div>
    </div>
  </div>`;
  return page({ title: 'Sign in — Keystone Tables', h1: 'Sign in', account, activeHref: '/login', body });
}

// The landing page a reader arrives at after signing out.
function signedOutPage() {
  const body = `
  <div class="band band-hero">
    <div class="band-inner">
      <h1 class="page-title">You are signed out of Keystone Tables.</h1>
      <p class="hero-description">Your session has ended. Sign in again to reach your tables.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/login" data-control="Sign in">Sign in</a>
        <a class="btn btn-secondary" href="/plans" data-control="See the plans">See the plans</a>
      </div>
    </div>
  </div>`;
  return page({ title: 'Signed out — Keystone Tables', h1: 'You are signed out of Keystone Tables.', account: null, activeHref: '/', body });
}

// The department refusal page: a client-error status, never a redirect, naming the department.
function departmentRefusalPage(department, status = 403) {
  const body = `
  <div class="band band-refusal">
    <div class="band-inner">
      <h1 class="page-title">This department is closed to you.</h1>
      <p class="refusal-department">You hold no role on <span class="department-name">${esc(department)}</span>, so nothing in it reaches you.</p>
      <p class="band-copy">A steward of that department decides every access request, and an approval reaches you on your next read.</p>
    </div>
  </div>`;
  return page({ title: 'This department is closed to you. — Keystone Tables', h1: 'This department is closed to you.', account: null, activeHref: '', body });
}

// The steward administration refusal page.
function stewardRefusalPage(status) {
  const body = `
  <div class="band band-refusal">
    <div class="band-inner">
      <h1 class="page-title">This console is for stewards only.</h1>
      <p class="band-copy">Only a steward reaches the administration console.</p>
    </div>
  </div>`;
  return page({ title: 'This console is for stewards only. — Keystone Tables', h1: 'This console is for stewards only.', account: null, activeHref: '', body });
}

// The custom not-found page: text/html, exactly one first-level heading, a link to /.
function notFoundPage() {
  const body = `
  <div class="band band-notfound">
    <div class="band-inner">
      <h1 class="page-title">That address is not part of Keystone Tables.</h1>
      <p class="band-copy"><a class="btn btn-primary" href="/" data-control="Back to the landing page">Back to the landing page</a></p>
    </div>
  </div>`;
  return page({ title: 'Not found — Keystone Tables', h1: 'That address is not part of Keystone Tables.', account: null, activeHref: '', body });
}

module.exports = {
  router, esc, issueFormToken, page, headerChrome, footerChrome, statusRegion,
  landingPage, plansPage, enquiryPage, communityPage, developersPage, loginPage,
  signedOutPage, departmentRefusalPage, stewardRefusalPage, notFoundPage,
  ROUTE_LINKS, CONSOLE_LINKS,
};

// ---------- route wiring ----------

const consolePages = require('./console');

// Reads the session for a page render. The session row alone decides; the role grants are
// read from the store per request.
async function pageSession(req) {
  const session = await readSession(req);
  if (!session) return { session: null, account: null };
  const r = await pool.query('SELECT * FROM accounts WHERE email = $1', [session.account]);
  return { session, account: r.rows[0] || null };
}

// A console page needs a session; a reader without one gets the department refusal page with
// a client-error status, never a redirect.
async function consoleGuard(req, res) {
  const { session, account } = await pageSession(req);
  if (!session || !account) {
    const body = `
    <div class="band band-refusal">
      <div class="band-inner">
        <h1 class="page-title">This department is closed to you.</h1>
        <p class="refusal-department">You are not signed in, so no department reaches you.</p>
        <p class="band-copy"><a class="btn btn-primary" href="/login" data-control="Sign in">Sign in</a></p>
      </div>
    </div>`;
    res.status(401).type('text/html').send(page({ title: 'This department is closed to you. — Keystone Tables', h1: '', account: null, activeHref: '', body }));
    return null;
  }
  return { session, account };
}

router.get('/', async (req, res) => {
  const { account } = await pageSession(req);
  res.type('text/html').send(landingPage(account));
});

router.get('/plans', async (req, res) => {
  const { account } = await pageSession(req);
  res.type('text/html').send(await plansPage(account));
});

router.get('/enquiry', async (req, res) => {
  const { account } = await pageSession(req);
  res.type('text/html').send(await enquiryPage(account));
});

// A form-encoded enquiry post is validated server-side and answered by the same page with
// the refusal inline beside its control, the typed value kept.
router.post('/enquiry', async (req, res) => {
  const { account } = await pageSession(req);
  const values = {};
  for (const key of ['full_name', 'work_email', 'phone', 'company', 'role', 'message']) {
    values[key] = typeof req.body[key] === 'string' ? req.body[key] : '';
  }
  const token = req.body.form_token;
  if (!token || (await pool.query('SELECT id FROM form_tokens WHERE value = $1', [token])).rows.length === 0) {
    return res.status(403).type('text/html').send(await enquiryPage(account, { error: 'A form post carries its form token.', errorField: 'form_token', values }));
  }
  let error = null, errorField = null;
  if (!values.full_name.trim()) { error = 'A full name is required.'; errorField = 'full_name'; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.work_email.trim())) { error = 'A work email is required and must be a valid address.'; errorField = 'work_email'; }
  else if (!values.company.trim()) { error = 'A company name is required.'; errorField = 'company'; }
  else if (!values.message.trim()) { error = 'A message is required.'; errorField = 'message'; }
  else if (values.message.length > 1000) { error = 'A message holds at most 1000 characters.'; errorField = 'message'; }
  if (error) {
    return res.status(422).type('text/html').send(await enquiryPage(account, { error, errorField, values }));
  }
  await pool.query(
    'INSERT INTO enquiries (id, full_name, work_email, phone, company, role, message, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [uid('enq'), values.full_name.trim(), values.work_email.trim().toLowerCase(), values.phone.trim(), values.company.trim(), values.role.trim() || null, values.message, now()]);
  res.redirect(303, '/enquiry?recorded=' + encodeURIComponent(values.work_email.trim().toLowerCase()));
});

router.get('/community', async (req, res) => {
  const { account } = await pageSession(req);
  res.type('text/html').send(await communityPage(account, { subscribedEmail: req.query.recorded || null }));
});

router.post('/community', async (req, res) => {
  const { account } = await pageSession(req);
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const token = req.body.form_token;
  if (!token || (await pool.query('SELECT id FROM form_tokens WHERE value = $1', [token])).rows.length === 0) {
    return res.status(403).type('text/html').send(await communityPage(account));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(422).type('text/html').send(await communityPage(account));
  }
  const existing = await pool.query('SELECT id FROM subscribers WHERE email = $1', [email]);
  if (existing.rows.length === 0) {
    await pool.query('INSERT INTO subscribers (id, email) VALUES ($1,$2)', [uid('sub'), email]);
  }
  res.redirect(303, '/community?recorded=' + encodeURIComponent(email));
});

router.get('/developers', async (req, res) => {
  const { account } = await pageSession(req);
  res.type('text/html').send(developersPage(account));
});

router.get('/login', async (req, res) => {
  const { account } = await pageSession(req);
  if (account) return res.redirect('/console/tables');
  res.type('text/html').send(loginPage(account, {
    signup: req.query.signup === '1',
    tier: typeof req.query.tier === 'string' ? req.query.tier : null,
  }));
});

router.get('/signed-out', (req, res) => {
  res.type('text/html').send(signedOutPage());
});

// ---------- the console pages ----------

router.get('/console', (req, res) => res.redirect('/console/tables'));
router.get('/console/tables', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  res.type('text/html').send(await consolePages.tablesListPage(guard.account));
});

router.get('/console/tables/:slug', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.tablePage(guard.account, req.params.slug, {
    view: typeof req.query.view === 'string' ? req.query.view : null,
    sort: typeof req.query.sort === 'string' ? req.query.sort : null,
    page: req.query.page,
  });
  res.status(result.status).type('text/html').send(result.html);
});

router.get('/console/tables/:slug/views/:viewId', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.viewPage(guard.account, req.params.slug, req.params.viewId);
  res.status(result.status).type('text/html').send(result.html);
});

router.get('/console/tables/:slug/log', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.logPage(guard.account, req.params.slug, {
    page: req.query.page,
    action: typeof req.query.action === 'string' ? req.query.action : null,
    accountFilter: typeof req.query.account === 'string' ? req.query.account : null,
  });
  res.status(result.status).type('text/html').send(result.html);
});

router.get('/console/snapshots', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.snapshotsPage(guard.account);
  res.status(result.status).type('text/html').send(result.html);
});

router.get('/console/requests', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.requestsPage(guard.account);
  res.status(result.status).type('text/html').send(result.html);
});

router.get('/console/account', async (req, res) => {
  const guard = await consoleGuard(req, res);
  if (!guard) return;
  const result = await consolePages.accountPage(guard.account);
  res.status(result.status).type('text/html').send(result.html);
});

// The steward administration console: stewards only, and a reader with no session gets the
// same refusal page answered 401 rather than a redirect.
router.get('/console/administration', async (req, res) => {
  const { session, account } = await pageSession(req);
  if (!session || !account) {
    const body = `
    <div class="band band-refusal">
      <div class="band-inner">
        <h1 class="page-title">This console is for stewards only.</h1>
        <p class="band-copy">Only a steward reaches the administration console.</p>
        <p class="band-copy"><a class="btn btn-primary" href="/login" data-control="Sign in">Sign in</a></p>
      </div>
    </div>`;
    return res.status(401).type('text/html').send(page({ title: 'This console is for stewards only. — Keystone Tables', h1: '', account: null, activeHref: '', body }));
  }
  const grants = await accountGrants(account.email);
  if (!grants.some(g => g.role === 'steward')) {
    const body = `
    <div class="band band-refusal">
      <div class="band-inner">
        <h1 class="page-title">This console is for stewards only.</h1>
        <p class="band-copy">Only a steward reaches the administration console.</p>
      </div>
    </div>`;
    return res.status(403).type('text/html').send(page({ title: 'This console is for stewards only. — Keystone Tables', h1: '', account: account, activeHref: '', body }));
  }
  const result = await consolePages.administrationPage(account);
  res.status(result.status).type('text/html').send(result.html);
});
