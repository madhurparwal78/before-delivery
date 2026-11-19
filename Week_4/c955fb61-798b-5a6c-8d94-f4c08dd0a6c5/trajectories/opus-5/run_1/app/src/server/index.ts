import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema } from './db.js';
import { handleApi } from './api/index.js';
import { attachLiveChannel } from './live.js';
import { startNoticeWorker } from './mail.js';
import { userForRequest } from './auth.js';

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slackwater Plan</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const PUBLIC_PAGES = new Set(['/', '/signin', '/signup']);

function isPagePath(pathname: string): boolean {
  return PUBLIC_PAGES.has(pathname) || /^\/projects\/[^/]+$/.test(pathname);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      const relative = normalize(url.pathname.slice('/assets/'.length));
      if (relative.startsWith('..')) {
        res.writeHead(404).end();
        return;
      }
      try {
        const file = await readFile(join(publicDir, relative));
        res.writeHead(200, {
          'content-type': MIME[extname(relative)] ?? 'application/octet-stream',
          'content-length': file.length,
          'cache-control': 'public, max-age=3600',
        });
        res.end(file);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }

    if (!isPagePath(url.pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    if (!PUBLIC_PAGES.has(url.pathname) && !(await userForRequest(req))) {
      const next = `${url.pathname}${url.search}`;
      res.writeHead(302, { location: `/signin?next=${encodeURIComponent(next)}` }).end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(SHELL),
      'cache-control': 'no-store',
    });
    res.end(SHELL);
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'server_error' }));
  });
});

attachLiveChannel(server);

await applySchema();
startNoticeWorker();
server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Slackwater Plan listening on ${config.port}\n`);
});
