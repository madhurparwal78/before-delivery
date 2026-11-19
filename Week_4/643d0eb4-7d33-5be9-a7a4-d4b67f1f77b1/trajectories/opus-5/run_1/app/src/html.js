'use strict';
const { escapeHtml } = require('./util');

const e = escapeHtml;

const PUBLIC_LINKS = [
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

const DEPARTMENTS = ['claims', 'underwriting', 'actuarial'];

function navMarkup(ctx) {
  const links = PUBLIC_LINKS.slice();
  if (ctx.auth) {
    links.push(...CONSOLE_LINKS);
    if (ctx.isSteward) links.push({ href: '/console/administration', label: 'Administration' });
  }
  const items = links
    .map(
      (l) =>
        `<li><a class="route-link${ctx.path === l.href ? ' is-current' : ''}" href="${e(l.href)}"${
          ctx.path === l.href ? ' aria-current="page"' : ''
        }>${e(l.label)}</a></li>`
    )
    .join('');
  return `<nav id="route-nav" class="route-nav" aria-label="Routes"><ul class="route-list">${items}</ul></nav>`;
}

function accountControl(ctx) {
  if (!ctx.auth) {
    return `<div class="account-control"><a class="button button-quiet" href="/login">Sign in</a></div>`;
  }
  return `<div class="account-control">
    <a class="account-name button button-quiet" href="/console/account">${e(ctx.auth.account.display_name)}</a>
    <button type="button" class="button button-quiet" id="sign-out" data-sign-out>Sign out</button>
  </div>`;
}

function header(ctx) {
  return `<header class="chrome-header" id="chrome-header">
  <div class="chrome-inner">
    <a class="product-mark" href="/">Keystone Tables</a>
    <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="route-nav">
      <span class="nav-toggle-text">Menu</span>
    </button>
    ${navMarkup(ctx)}
    ${accountControl(ctx)}
  </div>
</header>`;
}

function footer() {
  const links = PUBLIC_LINKS.map((l) => `<li><a class="footer-link" href="${e(l.href)}">${e(l.label)}</a></li>`).join('');
  const departments = DEPARTMENTS.map((d) => `<li><span class="footer-department">${e(d)}</span></li>`).join('');
  return `<footer class="chrome-footer">
  <div class="chrome-inner footer-inner">
    <div class="footer-band">
      <h2 class="footer-title">Routes</h2>
      <ul class="footer-list">${links}</ul>
    </div>
    <div class="footer-band">
      <h2 class="footer-title">Departments</h2>
      <ul class="footer-list">${departments}</ul>
    </div>
    <p class="legal-line">Keystone Tables is the governed reporting workspace of Northbank Mutual. Allowances are stated, never priced.</p>
  </div>
</footer>`;
}

function departmentField(department) {
  return `<div class="department-field" role="group" aria-label="Department" data-department="${e(department)}">
  <span class="department-label">Department</span>
  <span class="department-value">${e(department)}</span>
</div>`;
}

function workspaceUpdates() {
  return `<div class="workspace-updates" id="workspace-updates" role="status" aria-live="polite" aria-atomic="true" aria-label="Workspace updates">
  <p class="notice-strip" id="notice-strip" data-kind="" hidden></p>
</div>`;
}

/** The whole document. Every address carries the same chrome. */
function page(ctx, body) {
  const bootstrap = ctx.bootstrap ? JSON.stringify(ctx.bootstrap) : '{}';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(ctx.title)} — Keystone Tables</title>
<meta name="description" content="${e(ctx.description || 'The governed reporting workspace of Northbank Mutual.')}">
<link rel="stylesheet" href="/static/app.css">
</head>
<body data-route="${e(ctx.route || '')}"${ctx.auth ? ` data-account="${e(ctx.auth.account.email)}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
${header(ctx)}
<script>(function(){var n=document.getElementById('route-nav');if(window.innerWidth<800&&n){n.hidden=true;}else{var t=document.getElementById('nav-toggle');if(t)t.hidden=true;}})();</script>
<main id="main" class="chrome-main">
<div class="chrome-inner main-inner">
${body}
</div>
</main>
${footer()}
<div id="dialog-root" class="dialog-root"></div>
<script id="bootstrap" type="application/json">${bootstrap.replace(/</g, '\\u003c')}</script>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

module.exports = {
  e,
  page,
  header,
  footer,
  navMarkup,
  departmentField,
  workspaceUpdates,
  PUBLIC_LINKS,
  CONSOLE_LINKS,
  DEPARTMENTS,
};
