import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { config } from './config';
import { waitForPostgres } from './db';
import { applySchemaAndSeed } from './seed';
import { ApiError } from './errors';
import { Router, makeNonce, type Ctx } from './http';
import { isKnownPage, renderShell } from './pages';
import { findGameBySlug } from './data/games';
import { registerAuthRoutes } from './routes/auth';
import { registerStaffRoutes } from './routes/staff';
import { registerTeamRoutes } from './routes/team';
import { registerWidgetRoutes } from './routes/widget';
import { registerHookRoutes } from './routes/hooks';

const router = new Router();
router.add('GET', '/api/health', async (ctx) => {
  const payload = Buffer.from(JSON.stringify({ status: 'ok' }), 'utf8');
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(payload);
});
registerAuthRoutes(router);
registerStaffRoutes(router);
registerTeamRoutes(router);
registerWidgetRoutes(router);
registerHookRoutes(router);

const STATIC_ROOT = join(__dirname, 'public');
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function staticFile(pathname: string): { bytes: Buffer; type: string } | null {
  const extension = pathname.slice(pathname.lastIndexOf('.'));
  const type = STATIC_TYPES[extension];
  if (type === undefined) return null;
  const target = normalize(join(STATIC_ROOT, pathname));
  if (!target.startsWith(STATIC_ROOT)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return { bytes: readFileSync(target), type };
}

function applySecurityHeaders(
  res: ServerResponse,
  nonce: string,
  options: { frameAncestors: string; sandbox: boolean },
): void {
  const policy = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    `frame-ancestors ${options.frameAncestors}`,
  ];
  if (options.sandbox) policy.push('sandbox');
  res.setHeader('Content-Security-Policy', policy.join('; '));
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendError(ctx: Ctx, error: unknown): void {
  const apiError =
    error instanceof ApiError ? error : new ApiError(500, 'internal');
  const payload = Buffer.from(
    JSON.stringify(
      error instanceof ApiError
        ? apiError.body()
        : { error: { code: 'internal', message: 'Something went wrong.' } },
    ),
    'utf8',
  );
  if (ctx.res.headersSent) {
    ctx.res.end();
    return;
  }
  ctx.res.writeHead(apiError.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...(apiError.headers ?? {}),
  });
  ctx.res.end(payload);
}

function sendPage(ctx: Ctx, status: number, html: string): void {
  const payload = Buffer.from(html, 'utf8');
  ctx.res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  if (ctx.method === 'HEAD') ctx.res.end();
  else ctx.res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nonce = makeNonce();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ctx: Ctx = { req, res, url, params: {}, nonce, method };
  const isWidgetPage = /^\/widget\/[^/]+$/.test(url.pathname);
  const isAttachmentContent = /\/attachments\/[^/]+\/content$/.test(url.pathname);

  let frameAncestors = "'none'";
  if (isWidgetPage) {
    const slug = url.pathname.split('/')[2] ?? '';
    try {
      const game = await findGameBySlug(slug);
      if (game) frameAncestors = game.launcher_origin;
    } catch {
      frameAncestors = "'none'";
    }
  }
  applySecurityHeaders(res, nonce, { frameAncestors, sandbox: isAttachmentContent });

  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== (req.headers.host ?? '')) {
        sendError(ctx, new ApiError(403, 'change_refused'));
        return;
      }
    }
  }

  const route = router.find(method === 'HEAD' ? 'GET' : method, url.pathname);
  if (route) {
    ctx.params = route.params;
    try {
      await route.handler(ctx);
    } catch (error) {
      sendError(ctx, error);
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendError(ctx, new ApiError(404, 'not_found'));
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    const asset = staticFile(url.pathname);
    if (asset) {
      res.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': asset.bytes.length,
        'Cache-Control': 'public, max-age=3600',
      });
      if (method === 'HEAD') res.end();
      else res.end(asset.bytes);
      return;
    }
    if (isWidgetPage) {
      const slug = url.pathname.split('/')[2] ?? '';
      const game = await findGameBySlug(slug);
      if (game) {
        sendPage(ctx, 200, renderShell({ nonce, gameSlug: game.slug, gameName: game.name }));
        return;
      }
      sendPage(ctx, 404, renderShell({ nonce }));
      return;
    }
    if (isKnownPage(url.pathname)) {
      sendPage(ctx, 200, renderShell({ nonce }));
      return;
    }
    sendPage(ctx, 404, renderShell({ nonce }));
    return;
  }

  sendError(ctx, new ApiError(404, 'not_found'));
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
  });
});

server.listen(config.port, '0.0.0.0', () => {
  void (async () => {
    await waitForPostgres();
    await applySchemaAndSeed();
  })();
});
