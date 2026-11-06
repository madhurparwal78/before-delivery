import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { config } from './config.js';
import { migrate } from './db.js';
import { api } from './api.js';
import { runLinkTimer } from './ingest.js';
import { checkStorage, storageStatus } from './storage.js';
import { checkMail, startMailTimers, flushQueuedEmails } from './mail.js';
import { maybeWriteReport } from './handlers-missions.js';
import { apiError, sendJson } from './http.js';
import { withClient } from './db.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const PUBLIC_DIR = join(process.cwd(), 'dist', 'public');
const INDEX = join(PUBLIC_DIR, 'index.html');

const allowedPaths = new Set(['/app.js', '/app.css', '/index.html', '/favicon.svg']);
const allowedFont = (p: string) => /^\/fonts\/[a-z0-9-]+\.ttf$/.test(p);

function serveStatic(pathname: string, res: http.ServerResponse): boolean {
  let file: string | null = null;
  if (pathname === '/' || pathname === '') {
    file = INDEX;
  } else if (allowedPaths.has(pathname) || allowedFont(pathname)) {
    const candidate = join(PUBLIC_DIR, pathname);
    if (existsSync(candidate) && statSync(candidate).isFile()) file = candidate;
  }
  if (!file) return false;
  const data = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': String(data.length),
    'Cache-Control': pathname === '/' || pathname === '/index.html' ? 'no-store' : 'public, max-age=86400',
  });
  res.end(data);
  return true;
}

const SCREEN_PATHS = /^\/(fleet|missions|launch|surveys|sign-in|flags)(\/|$)/;

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

    // No cross-origin access headers anywhere.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (await api.handle(req, res, pathname)) return;

    if (serveStatic(pathname, res)) return;

    if (SCREEN_PATHS.test(pathname)) {
      const data = readFileSync(INDEX);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
      return;
    }
    sendJson(res, 404, { error: 'not_found', message: 'That page does not exist or is not shared with you.' });
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal', message: 'Something went wrong on the server.' });
    } else {
      res.destroy();
    }
  }
}

async function startTimers(): Promise<void> {
  setInterval(async () => {
    try {
      await checkStorage();
      await checkMail();
    } catch { /* retried next tick */ }
  }, 5000).unref();
  setInterval(async () => {
    try { await runLinkTimer(); } catch { /* retried next tick */ }
  }, 2000).unref();
  setInterval(async () => {
    try {
      await withClient(async (c) => {
        const pending = await c.query(`SELECT id FROM missions WHERE report_state = 'Pending'`);
        for (const m of pending.rows) {
          await maybeWriteReport(c, m.id);
        }
      });
    } catch { /* retried next tick */ }
  }, 10000).unref();
  setInterval(async () => {
    try { await runEscalations(); } catch { /* retried next tick */ }
  }, 5000).unref();
  startMailTimers();
}

async function runEscalations(): Promise<void> {
  const { inTx } = await import('./db.js');
  const { emailOutbox } = await import('./mail.js');
  const { config: cfg } = await import('./config.js');
  await inTx(async (c) => {
    const alerts = await c.query(
      `SELECT a.*, v.name AS vessel_name FROM alerts a JOIN vessels v ON v.id = a.vessel_id
       WHERE a.state = 'Active' AND a.escalation = 'None' AND a.raised_at < now() - ($1 || ' seconds')::interval`,
      [String(cfg.escalationSeconds)]
    );
    for (const a of alerts.rows) {
      await emailOutbox.queueEscalation(c, {
        id: a.id, kind: a.kind, heading: a.heading, vessel_name: a.vessel_name,
        mission_id: a.mission_id, raised_at: new Date(a.raised_at),
      });
    }
  });
}

async function main(): Promise<void> {
  // Boot even when Postgres is down: retry until it connects.
  for (;;) {
    try {
      await migrate();
      break;
    } catch (e) {
      console.error('waiting for database...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  // Initial dependency checks (banners show at boot when down).
  try { await checkStorage(); } catch { /* handled by status */ }
  try { await checkMail(); } catch { /* handled by status */ }
  try { await flushQueuedEmails(); } catch { /* retried by timer */ }
  try { await runLinkTimer(); } catch { /* retried by timer */ }

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 65000;
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Swathdeck serving on 0.0.0.0:${config.port}`);
  });
  void startTimers();
}

void main();
