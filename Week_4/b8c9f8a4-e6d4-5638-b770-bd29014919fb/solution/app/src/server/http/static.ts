// The page shell and the handful of files the browser may read. Nothing else is served: source,
// manifests, lockfiles and environment files all answer 404.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { sendBytes, sendHtml } from './respond.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(HERE, '..', 'public');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const ALLOWED = new Set(['/app.js', '/app.css', '/sw.js', '/favicon.svg']);

export function isAsset(path: string): boolean {
  return ALLOWED.has(path) || /^\/fonts\/[a-z0-9-]+\.woff2$/.test(path);
}

/** Callers pass only an isAsset path, and none of those holds `..`. */
export async function sendAsset(response: ServerResponse, path: string): Promise<boolean> {
  const file = join(PUBLIC, path);
  try {
    const facts = await stat(file);
    if (!facts.isFile()) return false;
    const body = await readFile(file);
    sendBytes(response, 200, body, TYPES[extname(file)], {
      'Cache-Control': path === '/sw.js' ? 'no-store' : 'public, max-age=3600',
    });
    return true;
  } catch {
    return false;
  }
}

const SHELL = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="colour-scheme" content="light">
<title>Open Bonnet — Ostler Lane</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<div id="app"></div>
<noscript>Open Bonnet needs JavaScript to show the car's walkround.</noscript>
</body>
</html>
`;

export function sendShell(response: ServerResponse, status = 200): void {
  sendHtml(response, status, SHELL);
}
