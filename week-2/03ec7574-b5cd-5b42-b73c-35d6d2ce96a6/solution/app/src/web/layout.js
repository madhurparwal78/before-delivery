import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attr, html } from './html.js';
import { icon } from './icons.js';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
let manifest = null;

// Fingerprinted asset names written by the build.
function asset(name) {
  manifest ||= JSON.parse(readFileSync(path.join(root, 'public', 'build', 'manifest.json'), 'utf8'));
  return `/static/${manifest[name]}`;
}

export function toastMarkup(toast) {
  if (!toast) return '';
  return html`<p class="toast toast--${toast.kind || 'success'}">${toast.kind === 'error' ? '' : icon('tick')}<span>${toast.text}</span></p>`;
}

export function documentPage({ title, description, bodyClass = '', body, toast = null }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description || 'Corvo: treasury wallets with ordered spending policies, key quorum approvals and a verifiable audit trail.'}">
<link rel="stylesheet" href="${asset('site.css')}">
<script src="${asset('head.js')}"></script>
<script src="${asset('app.js')}" defer></script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to main content</a>
${body}
<div class="toasts" id="toasts" role="status" aria-label="Notifications" aria-live="polite">${toastMarkup(toast)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- public site
const MENUS = [
  ['Products', [
    ['Wallets', 'Named wallets that each hold one asset, to the base unit', '/#products'],
    ['Policy engine', 'Ordered rules that allow or deny every transfer', '/#products'],
    ['Key quorums', 'Distinct approvers sign every large payout', '/#products']]],
  ['Solutions', [
    ['Treasury teams', 'Spend company funds under written policies', '/#products'],
    ['Payroll batches', 'Many payouts checked and approved as one', '/#products'],
    ['Agent payments', 'Agents pay inside limits people can read', '/#products']]],
  ['Developer', [
    ['JSON API', 'One envelope, exact amounts and request ids', '/#builders'],
    ['Signed event log', 'HMAC-signed payment events you can verify', '/#builders'],
    ['Audit chain', 'Hash-chained events that recompute', '/#builders']]],
  ['Resources', [
    ['Customer stories', 'How teams run their treasury on Corvo', '/#stories'],
    ['Plan comparison', 'Every feature by plan', '/pricing#matrix'],
    ['Talk to our team', 'Volume, rollout and controls', '/contact']]],
];

function header() {
  return html`<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="/">${icon('diamond')}<span>Corvo</span></a>
    <nav class="site-nav" id="site-nav" aria-label="Main">
      <ul class="site-nav__menus">
        ${MENUS.map(([name, links], i) => html`<li class="menu" data-menu>
          <button class="menu__button" type="button" aria-expanded="false" aria-controls="menu-${i + 1}">${name}${icon('chevron')}</button>
          <div class="menu__panel" id="menu-${i + 1}">
            <ul>${links.map(([title, caption, href]) => html`<li><a href="${href}"><span class="menu__title">${title}</span><span class="menu__caption">${caption}</span></a></li>`)}</ul>
          </div>
        </li>`)}
        <li><a class="site-nav__link" href="/pricing">Pricing</a></li>
      </ul>
      <div class="site-nav__actions">
        <a class="pill pill--light" href="/login">Log in</a>
        <a class="pill pill--dark" href="/login">Get started${icon('arrow')}</a>
      </div>
    </nav>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-sheet="site-nav">${icon('menu')}<span>Menu</span></button>
  </div>
</header>`;
}

const FOOTER = [
  ['Product', [['Wallets', '/#products'], ['Pricing', '/pricing'], ['Plan comparison', '/pricing#matrix']]],
  ['Solutions', [['Treasury', '/#products'], ['Payroll', '/#products'], ['Agent payments', '/#products']]],
  ['Developer', [['JSON API', '/#builders'], ['Audit chain', '/#builders'], ['Console', '/login']]],
  ['Resources', [['Customer stories', '/#stories'], ['Pricing questions', '/pricing#pricing-questions'], ['Contact', '/contact']]],
];

function footer() {
  return html`<footer class="site-footer">
  <div class="wrap site-footer__grid">
    <div>
      <a class="brand" href="/">${icon('diamond')}<span>Corvo</span></a>
      <p class="site-footer__line">Money moves when the right people agree.</p>
    </div>
    <nav class="site-footer__cols" aria-label="Footer">
      ${FOOTER.map(([heading, links]) => html`<div><h2>${heading}</h2><ul>${links.map(([label, href]) => html`<li><a href="${href}">${label}</a></li>`)}</ul></div>`)}
    </nav>
  </div>
  <div class="wrap site-footer__base"><p>© 2026 Corvo Labs, Inc</p></div>
</footer>`;
}

export function publicPage({ title, description, main, bodyClass = '', toast = null }) {
  return documentPage({ title, description, toast, bodyClass: `site ${bodyClass}`,
    body: html`${header()}<main id="main" tabindex="-1">${main}</main>${footer()}` });
}

// ---------------------------------------------------------------- console frame
const RAIL = [
  ['overview', 'Overview', '/console', 'home'],
  ['approvals', 'Approvals', '/console/approvals', 'checklist'],
  ['intents', 'Intents', '/console/intents', 'transfer'],
  ['policies', 'Policies', '/console/policies', 'policy'],
  ['quorums', 'Quorums', '/console/quorums', 'people'],
  ['audit', 'Audit', '/console/audit', 'audit'],
  ['settings', 'Settings', '/console/settings', 'gear'],
];

export function rail(frame) {
  return html`<nav class="rail" id="rail" aria-label="Console">
  <ul>
    ${RAIL.filter(([key]) => key !== 'audit' || frame.canAudit).map(([key, label, href, glyph]) => html`<li>
      <a href="${href}"${attr('aria-current', frame.active === key, 'page')}>${icon(glyph)}<span class="rail__label">${label}</span>${key === 'approvals' ? html` <span class="count${frame.inboxCount ? '' : ' count--zero'}">${frame.inboxCount}</span>` : ''}</a>
    </li>`)}
  </ul>
</nav>`;
}

export function consolePage(frame, { title, main }) {
  const { me, org } = frame;
  return documentPage({ title: `${title} | Corvo console`, bodyClass: 'console-body', toast: frame.toast, body: html`<div class="console">
  <header class="console-bar">
    <a class="brand" href="/console">${icon('diamond')}<span>Corvo</span></a>
    <p class="console-bar__org">${org.name}</p>
    <div class="console-bar__me">
      <span class="console-bar__name">${me.name}</span>
      <span class="console-bar__email">${me.email}</span>
      <span class="badge badge--role">${me.role}</span>
    </div>
    <form class="console-bar__out" method="post" action="/logout">
      <input type="hidden" name="_csrf" value="${frame.csrf}">
      <button class="pill pill--light pill--small" type="submit">Sign out</button>
    </form>
    <button class="menu-toggle menu-toggle--console" type="button" aria-expanded="false" aria-controls="rail" data-sheet="rail">${icon('menu')}<span>Menu</span></button>
  </header>
  ${rail(frame)}
  <main id="main" class="console-main" tabindex="-1">${main}</main>
</div>` });
}
