// Serves the built client: the shell HTML, the script, the style and the fonts.
// Same origin only; no source files, manifest or credentials are served.

import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Services } from './services.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = findClientDir();

function findClientDir(): string {
  const candidates = [
    path.resolve(here, '../client'),
    path.resolve(here, '../../dist/client'),
    path.resolve(process.cwd(), 'dist/client'),
  ];
  for (const dir of candidates) if (existsSync(path.join(dir, 'main.js'))) return dir;
  return candidates[0]!;
}

const shell = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Atelier Ourlet</title>
<link rel="stylesheet" href="/assets/main.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script type="module" src="/assets/main.js" defer></script>
</head>
<body>
<div id="app"></div>
<noscript>Atelier Ourlet needs JavaScript.</noscript>
</body>
</html>`;

export async function serveShell(res: ServerResponse, _services: Services, status: number): Promise<void> {
  const html = shell().replace('<title>Atelier Ourlet</title>',
    status === 404 ? '<title>Not found \u2014 Atelier Ourlet</title>' : '<title>Atelier Ourlet</title>');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** Serve a built asset; anything outside the client dir answers 404. */
export async function serveAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname.startsWith('/assets/')) {
    const rel = pathname.slice('/assets/'.length);
    const file = path.resolve(clientDir, rel);
    if (!file.startsWith(clientDir)) return false;
    try {
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(bytes);
      return true;
    } catch {
      return false;
    }
  }
  if (pathname === '/assets/fonts/ofl') {
    // Font licences are published as text (IF-04).
    try {
      const bytes = await readFile(path.join(clientDir, 'fonts/ofl.txt'));
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
