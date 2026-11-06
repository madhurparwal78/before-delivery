import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname ?? '.', '../../browser-dist');

/** Serves only the built browser assets (DP-41). */
const files = new Map<string, { body: Buffer; type: string }>();

export function loadAssets(): void {
  if (!fs.existsSync(dist)) return;
  for (const name of fs.readdirSync(dist)) {
    const full = path.join(dist, name);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(name);
    files.set('/assets/' + name, {
      body: fs.readFileSync(full),
      type: ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream'
    });
  }
  const fonts = path.resolve(dist, 'fonts');
  if (fs.existsSync(fonts)) {
    for (const name of fs.readdirSync(fonts)) {
      files.set('/assets/fonts/' + name, {
        body: fs.readFileSync(path.join(fonts, name)),
        type: 'font/ttf'
      });
    }
  }
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml'
};

export function serveAsset(res: import('node:http').ServerResponse, pathname: string): number {
  if (pathname.includes('..')) return 404;
  const f = files.get(pathname);
  if (!f) return 404;
  res.writeHead(200, {
    'Content-Type': f.type,
    'Content-Length': String(f.body.length),
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(f.body);
  return 200;
}

export function serveBrowser(pathname: string): string {
  return SHELL;
}

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clinchline — Rasp & Rein</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js"></script>
</body>
</html>`;
