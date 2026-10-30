import { readFileSync, readdirSync } from 'node:fs';
import { STYLESHEET } from './css.js';

const CLIENT_DIR = new URL('../client/', import.meta.url);

const TYPES = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };

/** The built public assets: one stylesheet and the per-page scripts. */
export function buildAssets() {
  const assets = new Map([['app.css', STYLESHEET]]);
  for (const name of readdirSync(CLIENT_DIR)) {
    if (name.endsWith('.js')) assets.set(name, readFileSync(new URL(name, CLIENT_DIR), 'utf8'));
  }
  return assets;
}

const ASSETS = buildAssets();

export function serveAsset(pathname, response) {
  const name = pathname.slice('/assets/'.length);
  const body = ASSETS.get(name);
  if (body === undefined) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': TYPES[name.split('.').pop()],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'public, max-age=300'
  });
  response.end(body);
}
