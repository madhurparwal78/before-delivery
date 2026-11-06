import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Router } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));

function assetsDir(): string {
  const candidates = [join(here, '../public'), join(process.cwd(), 'dist/public'), join(process.cwd(), 'public')];
  for (const c of candidates) if (existsSync(c)) return c;
  return join(process.cwd(), 'dist/public');
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

export function registerAssetRoutes(assets: Router): void {
  assets.get('/assets/{file}', async (req, res) => {
    const file = req.params['file'];
    if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); res.end(); return; }
    const path = join(assetsDir(), file);
    if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
    const data = readFileSync(path);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  });
  assets.get('/fonts/{file}', async (req, res) => {
    const file = req.params['file'];
    if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); res.end(); return; }
    const path = join(assetsDir(), 'fonts', file);
    if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
    const data = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': 'font/woff2',
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
  });
}

/** The single HTML shell every app page serves. */
export function appShell(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="preload" href="/fonts/space-grotesk-700.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}
