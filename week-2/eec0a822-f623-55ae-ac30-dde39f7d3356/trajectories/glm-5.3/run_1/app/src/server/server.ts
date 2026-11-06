import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Pool, types as pgTypes } from 'pg';
import { loadConfig } from './config.js';
import { App } from './api.js';

// Base-local dates stay as YYYY-MM-DD strings; timestamptz stays a Date.
pgTypes.setTypeParser(1082, (v: string) => v);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  const app = new App(config, pool);
  await app.start();

  const distDir = new URL('.', import.meta.url).pathname;
  let indexHtml = '<!doctype html><html><head><title>Tidewright</title></head><body></body></html>';
  try {
    indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
  } catch {
    // index.html is produced by the client build.
  }

  function serveFile(pathname: string, res: ServerResponse): boolean {
    const safe = pathname.replace(/\\/g, '/').replace(/\.\./g, '');
    const full = join(distDir, safe);
    if (!full.startsWith(distDir)) return false;
    if (!existsSync(full) || !statSync(full).isFile()) return false;
    const ext = extname(full);
    if (!(ext in MIME)) return false;
    const body = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
    return true;
  }

  async function pageStatus(pathname: string): Promise<number> {
    let m: RegExpExecArray | null;
    if ((m = /^\/fleet\/([^/]+)$/.exec(pathname))) {
      const rows = await pool.query('SELECT 1 FROM workspaces WHERE slug = $1', [decodeURIComponent(m[1])]);
      return rows.rowCount === 1 ? 200 : 404;
    }
    if ((m = /^\/fleet\/([^/]+)\/([^/]+)$/.exec(pathname))) {
      const rows = await pool.query('SELECT status FROM yachts WHERE slug = $1 AND workspace_slug = $2', [decodeURIComponent(m[2]), decodeURIComponent(m[1])]);
      const yacht = rows.rows[0];
      if (!yacht) return 404;
      return yacht.status === 'withdrawn' ? 410 : 200;
    }
    if ((m = /^\/m\/([^/]+)$/.exec(pathname))) {
      const rows = await pool.query(
        `SELECT p.status, p.ends_at, c.status AS charter_status FROM private_pages p LEFT JOIN charters c ON c.id = p.charter_id WHERE p.token = $1 AND p.kind = 'manifest'`,
        [m[1]],
      );
      const page = rows.rows[0];
      if (!page) return 404;
      return page.status === 'ended' || page.ends_at.getTime() <= Date.now() || page.charter_status === 'closed' ? 410 : 200;
    }
    if ((m = /^\/b\/([^/]+)$/.exec(pathname))) {
      const rows = await pool.query(`SELECT status, ends_at FROM private_pages WHERE token = $1 AND kind = 'broker'`, [m[1]]);
      const page = rows.rows[0];
      if (!page) return 404;
      return page.status === 'ended' || page.ends_at.getTime() <= Date.now() ? 410 : 200;
    }
    if (pathname === '/' || pathname === '/sign-in' || /^\/w\/[^/]+(\/.*)?$/.test(pathname)) {
      return 200;
    }
    return 404;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname.startsWith('/api/') || url.pathname === '/sitemap.xml') {
        await app.handle(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      if (/^\/(assets|fonts)\//.test(url.pathname) && serveFile(decodeURIComponent(url.pathname), res)) return;
      if (['/favicon.svg', '/robots.txt'].includes(url.pathname) && serveFile(url.pathname, res)) return;
      const status = await pageStatus(url.pathname);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(indexHtml);
    } catch (e) {
      console.error('server error', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('error');
      }
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Tidewright serving on 0.0.0.0:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
