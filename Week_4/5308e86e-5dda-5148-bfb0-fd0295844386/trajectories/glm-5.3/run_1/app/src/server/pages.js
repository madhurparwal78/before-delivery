import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from './config.js';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_PAGES = new Set([
  '/', '/business-banking', '/business-payments', '/credit', '/treasury',
  '/invoicing', '/spend-management', '/payroll', '/books',
  '/venture-debt', '/working-capital-loans', '/pricing', '/contact',
  '/demo', '/login', '/signup',
]);

// Cockpit pages render an empty shell; their script builds everything.
const COCKPIT_SHELLS = {
  '/app': 'cockpit-home.js',
  '/payments': 'cockpit-payments.js',
  '/payments/new': 'cockpit-send.js',
  '/payments/recipients': 'cockpit-recipients.js',
  '/payments/recipients/new': 'cockpit-recipients-new.js',
  '/approvals': 'cockpit-approvals.js',
  '/invoices': 'cockpit-invoices.js',
  '/loans': 'cockpit-loans.js',
};

const COCKPIT_PLACEHOLDERS = {
  '/cards': 'cards',
  '/treasury-account': 'treasury-account',
  '/bill-pay': 'bill-pay',
};

export function pageExists(path) {
  if (PUBLIC_PAGES.has(path)) return true;
  if (path in COCKPIT_SHELLS) return true;
  if (path in COCKPIT_PLACEHOLDERS) return true;
  if (/^\/app\/accounts\/[^/]+$/.test(path)) return true;
  return false;
}

function shell(bodyHtml, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tallwind</title>
<link rel="stylesheet" href="/css/site.css">
<link rel="icon" href="/favicon.svg">
${extraHead}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

const pageCache = new Map();

function loadFragment(name) {
  if (pageCache.has(name)) return pageCache.get(name);
  const p = join(PUBLIC_DIR, 'pages', name);
  const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
  pageCache.set(name, text);
  return text;
}

export function servePage(req, res, url) {
  const path = url.pathname;
  if (!pageExists(path)) {
    return serveNotFound(res);
  }
  if (path in COCKPIT_SHELLS) {
    const script = COCKPIT_SHELLS[path];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(shell(`<div class="status-region" role="status" aria-live="polite"></div>
<noscript><p style="padding:40px">Tallwind needs JavaScript for the cockpit.</p></noscript>
<script type="module" src="/js/${script}"></script>`));
    return true;
  }
  if (path in COCKPIT_PLACEHOLDERS) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(shell(`<div class="status-region" role="status" aria-live="polite"></div>
<script type="module" src="/js/cockpit-placeholder.js"></script>`));
    return true;
  }
  if (/^\/app\/accounts\/[^/]+$/.test(path)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(shell(`<div class="status-region" role="status" aria-live="polite"></div>
<script type="module" src="/js/cockpit-account.js"></script>`));
    return true;
  }
  const name = path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-');
  const bodyHtml = loadFragment(`${name}.html`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(shell(bodyHtml));
  return true;
}

export function serveNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(shell(loadFragment('not-found.html')));
  return true;
}
