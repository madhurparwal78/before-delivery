import { h, icon } from './html.js';

const MENUS = [
  {
    name: 'Products',
    links: [
      { href: '/', label: 'Wallets', caption: 'Open a wallet for every account you hold.' },
      { href: '/console/policies', label: 'Policy engine', caption: 'Write the rules every transfer passes through.' },
      { href: '/console/approvals', label: 'Key quorums', caption: 'Route large payouts to named signers.' },
      { href: '/console/audit', label: 'Audit trail', caption: 'A hash-chained record of every write.' }
    ]
  },
  {
    name: 'Solutions',
    links: [
      { href: '/', label: 'Treasury teams', caption: 'Hold and move company funds under policy.' },
      { href: '/', label: 'Trading desks', caption: 'Settle fills and rebalance in seconds.' },
      { href: '/', label: 'Neobanks', caption: 'Offer dollar balances with bank controls.' },
      { href: '/', label: 'Payroll', caption: 'Pay contractors in one reviewed batch.' }
    ]
  },
  {
    name: 'Developer',
    links: [
      { href: '/pricing', label: 'Quickstart', caption: 'Open a wallet and move a payout today.' },
      { href: '/console/intents', label: 'Intents API', caption: 'Create, approve and read every movement.' },
      { href: '/console/settings', label: 'API keys', caption: 'Operator and auditor keys you control.' },
      { href: '/console/audit', label: 'Signed events', caption: 'Verify every event with your secret.' }
    ]
  },
  {
    name: 'Resources',
    links: [
      { href: '/pricing', label: 'Pricing', caption: 'Plans that grow with your wallets.' },
      { href: '/contact', label: 'Contact sales', caption: 'Talk to our team about your flows.' },
      { href: '/', label: 'Why Corvo', caption: 'Money moves when the right people agree.' },
      { href: '/console', label: 'Console tour', caption: 'See the treasury desk in action.' }
    ]
  }
];

function headerMenu(menu, index) {
  const panelId = `menu-panel-${index}`;
  return `
    <div class="menu-holder">
      <button type="button" class="menu-button" id="menu-button-${index}" aria-expanded="false" aria-controls="${panelId}" data-menu-button>
        ${h(menu.name)}${icon('chevron')}
      </button>
      <div class="menu-panel" id="${panelId}" hidden data-menu-panel>
        ${menu.links.map((link) => `<a href="${h(link.href)}">${h(link.label)}<span class="caption">${h(link.caption)}</span></a>`).join('')}
      </div>
    </div>`;
}

function publicHeader() {
  return `
  <header class="site-header">
    <div class="shell bar">
      <a class="wordmark" href="/">${icon('brand')}Corvo</a>
      <div class="menu-row">${MENUS.map(headerMenu).join('')}</div>
      <div class="header-actions">
        <a class="menu-button desktop-only" href="/pricing">Pricing</a>
        <a class="capsule capsule-light desktop-only" href="/login">Log in</a>
        <a class="capsule capsule-dark desktop-only" href="/login">Get started${icon('arrow')}</a>
        <button type="button" class="capsule capsule-light mobile-only" data-sheet-button aria-expanded="false" aria-controls="menu-sheet">Menu</button>
      </div>
    </div>
    <div class="menu-sheet" id="menu-sheet" data-sheet>
      <div class="shell">
        <nav aria-label="Site">
          ${MENUS.flatMap((menu) => menu.links.map((link) => `<a href="${h(link.href)}">${h(link.label)}</a>`)).join('')}
          <a href="/pricing">Pricing</a>
          <a href="/login">Log in</a>
          <a class="capsule capsule-dark" href="/login">Get started</a>
        </nav>
      </div>
    </div>
  </header>`;
}

function publicFooter() {
  const columns = [
    { title: 'Product', links: [['/', 'Wallets'], ['/console/policies', 'Policies'], ['/console/approvals', 'Approvals'], ['/pricing', 'Pricing']] },
    { title: 'Solutions', links: [['/', 'Treasury'], ['/', 'Payroll'], ['/', 'Trading desks'], ['/', 'Neobanks']] },
    { title: 'Developer', links: [['/console/intents', 'Intents'], ['/console/settings', 'API keys'], ['/console/audit', 'Signed events']] },
    { title: 'Resources', links: [['/contact', 'Contact'], ['/pricing', 'Pricing'], ['/login', 'Log in']] }
  ];
  return `
  <footer class="site-footer">
    <div class="shell footer-grid">
      <div>
        <a class="wordmark" href="/">${icon('brand')}Corvo</a>
        <p class="footer-note">Money moves when the right people agree.</p>
      </div>
      ${columns.map((column) => `
        <div>
          <h4>${h(column.title)}</h4>
          <ul>${column.links.map(([href, label]) => `<li><a href="${h(href)}">${h(label)}</a></li>`).join('')}</ul>
        </div>`).join('')}
    </div>
    <div class="shell"><p class="footer-note">© 2026 Corvo Labs, Inc</p></div>
  </footer>`;
}

export function notificationsRegion(toasts = []) {
  return `<div class="toast-region" role="status" aria-label="Notifications" aria-live="polite" id="notifications">${
    toasts.map((toast) => `<p class="toast">${h(toast)}</p>`).join('')
  }</div>`;
}

export function htmlDocument({ title, description, main, scripts = [], bodyClass = '', toasts = [] }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
<meta name="description" content="${h(description)}">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="${h(bodyClass)}">
<a class="skip-link" href="#main">Skip to main content</a>
${main}
${notificationsRegion(toasts)}
${scripts.map((src) => `<script src="/assets/${h(src)}" defer></script>`).join('')}
</body>
</html>`;
}

export function publicPage({ title, description, content, scripts = [], toasts = [] }) {
  return htmlDocument({
    title,
    description,
    toasts,
    scripts: ['public.js', ...scripts],
    main: `${publicHeader()}<main id="main">${content}</main>${publicFooter()}`
  });
}

const RAIL_ITEMS = [
  ['/console', 'Overview', 'bars'],
  ['/console/approvals', 'Approvals', 'ticks'],
  ['/console/intents', 'Intents', 'swap'],
  ['/console/policies', 'Policies', 'shield'],
  ['/console/quorums', 'Quorums', 'layers'],
  ['/console/audit', 'Audit', 'lock'],
  ['/console/settings', 'Settings', 'card']
];

export function consolePage({ title, description = 'Corvo treasury console', session, active, content, scripts = [], toasts = [], awaiting = 0 }) {
  const items = RAIL_ITEMS.filter(([href]) => href !== '/console/audit' || ['owner', 'auditor'].includes(session.member.role));
  const rail = `
    <div class="rail" id="console-rail" data-rail>
      <a class="wordmark" href="/console">${icon('brand')}Corvo</a>
      <nav aria-label="Console">
        <ul>
          ${items.map(([href, label, iconName]) => `
            <li>
              <a href="${h(href)}"${href === active ? ' aria-current="page"' : ''}>
                ${icon(iconName)}<span class="label">${h(label)}</span>
                ${label === 'Approvals' ? `<span class="count" data-awaiting-count>${awaiting}</span>` : ''}
              </a>
            </li>`).join('')}
        </ul>
      </nav>
    </div>`;
  const topbar = `
    <div class="topbar">
      <strong>${h(session.organization.name)}</strong>
      <span class="badge badge-active">${h(session.member.role)}</span>
      <div class="who">
        <div>${h(session.member.name)}</div>
        <div>${h(session.member.email)}</div>
      </div>
      <form method="post" action="/console/signout"><button type="submit" class="capsule capsule-light">Sign out</button></form>
    </div>`;
  return htmlDocument({
    title,
    description,
    toasts,
    scripts: ['console.js', ...scripts],
    bodyClass: 'console-body',
    main: `
      <div class="rail-mobile">
        <a class="wordmark" href="/console">${icon('brand')}Corvo</a>
        <button type="button" class="capsule capsule-light" data-rail-button aria-expanded="false" aria-controls="console-rail">Menu</button>
      </div>
      <div class="console">
        ${rail}
        <main id="main" class="workspace">${topbar}${content}</main>
      </div>`
  });
}
