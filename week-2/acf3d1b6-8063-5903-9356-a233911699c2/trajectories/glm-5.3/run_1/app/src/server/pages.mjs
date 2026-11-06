import fs from 'node:fs';
import path from 'node:path';
import { h } from 'preact';
import { prerender } from 'preact-iso';
import { locationStub } from 'preact-iso/prerender';
import { App } from '../../dist/ssr/app.mjs';
import { PUBLIC_ROUTES } from '../content.mjs';

// Shared by the bundled server and the build-time renderer; resolved from the
// app root so both find the same build output.
export const browserDir = path.resolve(process.cwd(), 'dist/browser');

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function titleFor(pathname) {
  const known = PUBLIC_ROUTES.find(r => r.path === pathname);
  if (known) return known.title;
  if (pathname.startsWith('/studio')) return 'Kinora Studio';
  if (pathname.startsWith('/invite/')) return 'Join a team on Kinora';
  if (pathname.startsWith('/studio/projects/')) return 'Project \u2014 Kinora Studio';
  return 'Kinora';
}

/**
 * Server-side render the app for a path into a full HTML document.
 * The public pages carry their headings and copy in this first response.
 */
export async function renderPage(pathname, query = '') {
  locationStub(pathname + (query ? `?${query}` : ''));
  const { html } = await prerender(h(App, { url: pathname + (query ? `?${query}` : '') }));
  const title = escape(titleFor(pathname));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/entry.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5b4fd6"/><circle cx="16" cy="16" r="7" fill="none" stroke="white" stroke-width="2.5"/></svg>'
  )}">
</head>
<body>
<div id="app">${html}</div>
<script type="module" src="/assets/entry.mjs"></script>
</body>
</html>`;
}

/** Try to serve a static build file; returns null when there is none. */
export function staticFile(urlPath) {
  const clean = urlPath.split('?')[0].replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return null;
  const file = path.join(browserDir, clean);
  if (!file.startsWith(browserDir)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}
