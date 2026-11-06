import { createServer } from 'node:http';
import { config } from './config.js';
import { Router } from './http.js';
import { dispatch } from './dispatch.js';
import { registerAll } from './api.js';
import { registerS3Routes } from './s3.js';
import { registerLinkRoutes } from './links.js';
import { registerAssetRoutes, appShell } from './pages.js';
import { loadSession } from './auth.js';
import { boot } from './bootstrap.js';
void boot();

const json = new Router();
const s3 = new Router();
const pages = new Router();
const links = new Router();
const assets = new Router();

registerAll(json);
registerS3Routes(s3);
registerLinkRoutes(links);
registerAssetRoutes(assets);

// Console pages: the shell, with redirects handled by the client after /api/me.
const shellTitle = (path: string): string => {
  if (path === '/') return 'Farshore';
  if (path === '/signin') return 'Sign in — Farshore';
  if (path.startsWith('/ops')) return 'Operator — Farshore';
  if (path.startsWith('/account')) return 'Account — Farshore';
  if (path.startsWith('/invite/')) return 'Join — Farshore';
  return 'Console — Farshore';
};

pages.get('/console/**', async (_req, res) => { sendHtml(res, appShell('Console — Farshore')); });
pages.get('/ops/**', async (_req, res) => { sendHtml(res, appShell('Operator — Farshore')); });
pages.get('/console', async (_req, res) => { sendHtml(res, appShell('Console — Farshore')); });
pages.get('/ops', async (_req, res) => { sendHtml(res, appShell('Operator — Farshore')); });
pages.get('/', async (_req, res) => { sendHtml(res, appShell('Farshore')); });
pages.get('/signin', async (_req, res) => { sendHtml(res, appShell('Sign in — Farshore')); });
pages.get('/account', async (_req, res) => { sendHtml(res, appShell('Account — Farshore')); });
pages.get('/invite/**', async (_req, res) => { sendHtml(res, appShell('Join — Farshore')); });

void loadSession;

function sendHtml(res: import('node:http').ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
  res.end(html);
}

const server = createServer((req, res) => {
  dispatch(req, res, { json, s3, pages, links, assets }, (path: string) => appShell(shellTitle(path))).catch(e => {
    console.error('[farshore] unhandled:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Error</title><h1>Something went wrong</h1>');
    } else {
      res.destroy();
    }
  });
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[farshore] serving on 0.0.0.0:${config.port}`);
});
