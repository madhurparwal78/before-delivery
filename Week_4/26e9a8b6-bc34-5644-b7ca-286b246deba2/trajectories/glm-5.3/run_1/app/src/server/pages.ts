// The app shell pages: one HTML document per route, rendered on the server.

import type { Config } from './config';
import { COPY } from '../shared/copy';

export interface PageResult {
  status: number;
  body: string;
}

const NOT_FOUND = COPY.fixed.notFound;

interface PageSpec {
  title: string;
  bodyClass: string;
  main: string;
}

const HOME: PageSpec = {
  title: 'Pennywasher',
  bodyClass: 'page-home',
  main: '',
};

/** Renders the shell; the client script builds each screen's content. */
export function renderPage(config: Config, path: string, embed: boolean): PageResult {
  const assetBase = '/assets';
  const head = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle(path))}</title>
<link rel="stylesheet" href="${assetBase}/app.css">
<script src="${assetBase}/client.js" defer></script>
</head>
<body data-route="${escapeHtml(path)}" data-embed="${embed ? 'true' : 'false'}" data-public-url="${escapeHtml(config.publicUrl)}">
<a class="wordmark" href="/">Pennywasher</a>
<main id="app">${escapeHtml(loadingShell(path))}</main>
</body>
</html>`;
  return { status: 200, body: head };
}

function pageTitle(path: string): string {
  if (path === '/') return 'Pennywasher';
  if (path.startsWith('/g/')) return 'Guide - Pennywasher';
  if (path.startsWith('/edit/')) return 'Editor - Pennywasher';
  if (path.startsWith('/embed/')) return 'Embed - Pennywasher';
  if (path === '/dashboard') return 'Dashboard - Pennywasher';
  if (path === '/search') return 'Search - Pennywasher';
  if (path === '/signin') return 'Sign in - Pennywasher';
  if (path === '/signup') return 'Sign up - Pennywasher';
  if (path === '/confirm') return 'Confirm - Pennywasher';
  if (path.startsWith('/c/')) return 'Collection - Pennywasher';
  return NOT_FOUND;
}

function loadingShell(path: string): string {
  return `<div class="loading-shell" data-loading>${escapeHtml(path === '/' ? '' : NOT_FOUND)}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
