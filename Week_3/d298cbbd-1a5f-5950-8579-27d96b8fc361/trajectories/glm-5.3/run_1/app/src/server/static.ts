import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Static assets and the single-page HTML every route serves.
// Never serves source, env files, manifests, lockfiles or source maps.

const BLOCKED = /\.(ts|tsx|js\.map|map|env|pem|key|md|lock)$/i;

export interface PageOptions {
  typistName: string | null;
  typistVerified: boolean | null;
  sessionToken: string | null;
}

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pageHtml(options: PageOptions): string {
  const initial = JSON.stringify({
    typist: options.typistName === null ? null : { name: options.typistName, verified: options.typistVerified === true },
    signedIn: options.sessionToken !== null && options.typistName !== null,
  });
  return `<!doctype html>
<html lang="en" data-theme="sand">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strikeproof</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<div id="app"></div>
<script>window.__INITIAL__ = ${initial};</script>
<script src="/app.js" defer></script>
</body>
</html>`;
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en" data-theme="sand">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strikeproof</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script>window.__PAGE_NOT_FOUND__ = true;</script>
<script src="/app.js" defer></script>
</body>
</html>`;

export async function serveStatic(res: ServerResponse, urlPath: string, publicDir: string, options: PageOptions): Promise<void> {
  const clean = urlPath.split('?')[0];
  if (clean === '/' || clean === '' || /^\/(history|boards|race|settings|signup|signin|reset|verify|account|runs)(\/|$)/.test(clean)) {
    const html = pageHtml(options);
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(html);
    return;
  }

  if (BLOCKED.test(clean) || clean.includes('..') || clean.includes('/src/') || clean.includes('/dist/')) {
    notFound(res);
    return;
  }

  const relative = clean.replace(/^\/+/, '');
  const filePath = path.join(publicDir, relative);
  if (!filePath.startsWith(publicDir)) {
    notFound(res);
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    notFound(res);
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
  res.end(NOT_FOUND_HTML);
}

export function notFoundPage(res: ServerResponse): void {
  notFound(res);
}
