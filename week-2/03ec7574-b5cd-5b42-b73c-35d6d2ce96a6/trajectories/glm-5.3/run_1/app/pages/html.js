// Shared HTML shell and partials for every page.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function page({ title, body, active = '', viewer = null, publicHeader = true, scripts = [], bodyAttrs = '' }) {
  const nav = publicHeader ? publicNav() : '';
  const footer = publicHeader ? publicFooter() : '';
  const scriptTags = scripts.map((s) => `<script src="${s}" defer></script>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body data-page="${esc(active)}" ${bodyAttrs}>
<a class="skip-link" href="#main">Skip to main content</a>
<div id="notifications" class="notifications" role="status" aria-label="Notifications" aria-live="polite"></div>
${nav}
<main id="main" tabindex="-1">
${body}
</main>
${footer}
${scriptTags}
</body>
</html>`;
}

const MENU_LINKS = {
  Products: [
    ['Wallets', 'Named wallets for every asset you hold', '/#product-cards'],
    ['Approvals', 'Payouts that wait for the right people', '/#product-cards'],
    ['Policy engine', 'Written rules decide every transfer', '/#product-cards'],
    ['Audit trail', 'A chain you can verify yourself', '/#product-cards'],
  ],
  Solutions: [
    ['Treasury', 'Move company funds under guardrails', '/#product-cards'],
    ['Payroll', 'Batch payouts in one request', '/#cases'],
    ['Trading desks', 'Settle and rebalance in seconds', '/#cases'],
    ['Neobanks', 'Dollar balances with bank-grade controls', '/#cases'],
  ],
  Developer: [
    ['REST API', 'Every console action is an endpoint', '/#builders'],
    ['Signed events', 'An HMAC-signed log of every movement', '/#builders'],
    ['Idempotency', 'Retries that can never pay twice', '/#builders'],
    ['Ledger', 'Every movement booked in pairs', '/#builders'],
  ],
  Resources: [
    ['Pricing', 'Plans that grow with you', '/pricing'],
    ['Contact sales', 'Talk to our team', '/contact'],
    ['Sign in', 'Open your console', '/login'],
    ['Get started', 'Create your first wallet', '/login'],
  ],
};

function publicNav() {
  const menus = Object.entries(MENU_LINKS).map(([name, links]) => `
  <div class="menu">
    <button type="button" class="menu-btn" aria-expanded="false" aria-controls="menu-${name.toLowerCase()}">
      <span>${name}</span><svg class="chev" aria-hidden="true" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <div class="menu-panel" id="menu-${name.toLowerCase()}" hidden>
      ${links.map(([label, caption, href]) => `
      <a class="menu-link" href="${href}"><strong>${label}</strong><span>${caption}</span></a>`).join('')}
    </div>
  </div>`).join('');
  return `
<header class="site-header">
  <div class="header-inner">
    <a class="wordmark" href="/" aria-label="Corvo home">
      <svg class="brand-mark" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2l9 10-9 10L3 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span>Corvo</span>
    </a>
    <nav class="header-nav" aria-label="Main">
      ${menus}
      <a class="nav-link" href="/pricing">Pricing</a>
      <a class="nav-link" href="/login">Log in</a>
      <a class="capsule capsule-dark nav-cta" href="/login">Get started<svg class="cta-arrow" aria-hidden="true" viewBox="0 0 12 12"><path d="M1 6h9M7 2.5L10.5 6 7 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></a>
    </nav>
    <button type="button" class="menu-btn phone-menu-btn" aria-expanded="false" aria-controls="phone-sheet">Menu</button>
  </div>
  <div class="phone-sheet" id="phone-sheet" hidden>
    <nav aria-label="Mobile">
      <a href="/#product-cards">Products</a>
      <a href="/#product-cards">Solutions</a>
      <a href="/#builders">Developer</a>
      <a href="/pricing">Pricing</a>
      <a href="/contact">Resources</a>
      <a href="/login">Log in</a>
      <a class="capsule capsule-dark" href="/login">Get started</a>
    </nav>
  </div>
</header>`;
}

function publicFooter() {
  return `
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="wordmark"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2l9 10-9 10L3 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Corvo</span></span>
      <p class="footer-line">Money moves when the right people agree.</p>
    </div>
    <div class="footer-cols">
      <div><h2>Product</h2><a href="/#product-cards">Wallets</a><a href="/pricing">Pricing</a><a href="/#builders">Policies</a></div>
      <div><h2>Solutions</h2><a href="/#cases">Treasury</a><a href="/#cases">Payroll</a><a href="/#cases">Trading desks</a></div>
      <div><h2>Developer</h2><a href="/#builders">REST API</a><a href="/#builders">Signed events</a><a href="/#builders">Idempotency</a></div>
      <div><h2>Resources</h2><a href="/contact">Contact</a><a href="/pricing">Pricing</a><a href="/login">Log in</a></div>
    </div>
  </div>
  <p class="copyright">© 2026 Corvo Labs, Inc</p>
</footer>`;
}

export function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;
}
