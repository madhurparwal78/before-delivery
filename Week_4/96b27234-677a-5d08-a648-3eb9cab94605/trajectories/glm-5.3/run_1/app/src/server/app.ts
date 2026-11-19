// The server boundary: same-origin rule, size limits, JSON body rules, the
// never-served list, and the one error order.
import express, { type Express, type NextFunction, type Request, type Response, Router } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { ApiError, crossOrigin, invalid, notFound } from './errors';
import { config, token as randomToken } from './config';
import { applySchema, query } from './db';
import { routes, gradingRoutes } from './routes';
import { setupWebsockets } from './websockets';
import { pool } from './db';

export interface AuthInfo {
  personId: string;
  worldId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
      rawBody?: Buffer;
    }
  }
}

const SESSION_COOKIE = 'hearthtile_session';

const sessions = new Map<string, { personId: string; createdAt: number }>();

export function createSessionCookie(personId: string): string {
  const id = randomToken();
  sessions.set(id, { personId, createdAt: Date.now() });
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function personIdFromCookie(req: { headers: { cookie?: string } }): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const id = rest.join('=');
      const s = sessions.get(id);
      if (s) return s.personId;
    }
  }
  return null;
}

export function destroySessionCookie(req: Request): void {
  const header = req.headers.cookie;
  if (!header) return;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) sessions.delete(rest.join('='));
  }
}

const JSON_BODY_LIMIT = config.jsonBodyLimit;
const SETUP_BODY_LIMIT = config.setupBodyLimit;

function readRawBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new ApiError(413, 'That request is too large.'));
        // Drain the rest so the response can be written and the socket kept.
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json({ error: err.message });
}

export function createApp(): Express {
  const app = express();

  // Same-origin rule, checked before everything else. A request with no Origin
  // header is allowed.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.headers.host) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== req.headers.host) {
        sendError(res, crossOrigin());
        return;
      }
    }
    if (origin && req.headers.upgrade) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        /* fall through */
      }
      if (originHost && originHost !== req.headers.host) {
        res.destroy();
        return;
      }
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path === '/api/grading/setup') {
      collectBody(req, res, next, SETUP_BODY_LIMIT, true);
    } else if (req.path.startsWith('/api/assets')) {
      collectBody(req, res, next, config.multipartLimit, false);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      next();
    } else {
      collectBody(req, res, next, JSON_BODY_LIMIT, true);
    }
  });

  function collectBody(req: Request, res: Response, next: NextFunction, limit: number, isJson: boolean): void {
    if (isJson && !(req.headers['content-type'] ?? '').includes('multipart/form-data')) {
      readRawBody(req, limit)
        .then((buf) => {
          req.rawBody = buf;
          next();
        })
        .catch((err) => {
          if (err instanceof ApiError) sendError(res, err);
          else sendError(res, new ApiError(500, 'Not found.'));
        });
    } else if (isJson) {
      readRawBody(req, limit)
        .then((buf) => {
          req.rawBody = buf;
          next();
        })
        .catch((err) => {
          if (err instanceof ApiError) sendError(res, err);
          else sendError(res, new ApiError(500, 'Not found.'));
        });
    } else {
      readRawBody(req, limit)
        .then((buf) => {
          req.rawBody = buf;
          next();
        })
        .catch((err) => {
          if (err instanceof ApiError) sendError(res, err);
          else sendError(res, new ApiError(500, 'Not found.'));
        });
    }
  }

  app.use((req, res, next) => {
    if (req.rawBody !== undefined && req.rawBody.length > 0 && (req.headers['content-type'] ?? '').includes('application/json')) {
      try {
        (req as unknown as { body: unknown }).body = JSON.parse(req.rawBody.toString('utf8'));
      } catch {
        sendError(res, invalid('Send a JSON body.'));
        return;
      }
    }
    next();
  });

  // Attach the signed-in person before routing. A suspended person's next API
  // request answers 401.
  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    const personId = personIdFromCookie(req);
    if (personId) {
      try {
        const rows = await query<{ id: string; world_id: string; suspended: boolean }>(
          'SELECT id, world_id, suspended FROM people WHERE id = $1',
          [personId]
        );
        if (rows.length && !rows[0].suspended) {
          req.auth = { personId: rows[0].id, worldId: rows[0].world_id };
        }
      } catch {
        // database hiccup; treat as signed out for this request
      }
    }
    next();
  });

  app.use('/api', wrapAsync(routes));
  app.use('/api/grading', wrapAsync(gradingRoutes));

  // Static files, with the never-served list applied.
  const publicDir = path.resolve(__dirname, '../public');
  const FORBIDDEN = ['.ts', '.mjs', '.json', '.md', '.map', '.lock'];
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const decoded = (() => {
      try {
        return decodeURIComponent(req.path);
      } catch {
        return req.path;
      }
    })();
    if (decoded.includes('..') || decoded.includes('\0')) {
      sendError(res, notFound());
      return;
    }
    const ext = path.extname(decoded).toLowerCase();
    if (FORBIDDEN.includes(ext) || decoded.startsWith('/.') || decoded.startsWith('/dist/') || decoded.startsWith('/src/')) {
      sendError(res, notFound());
      return;
    }
    let file = path.join(publicDir, decoded);
    if (!fs.existsSync(file)) {
      file = path.join(publicDir, decoded, 'index.html');
    }
    if (!fs.existsSync(file)) {
      if (decoded.startsWith('/api/')) {
        sendError(res, notFound());
        return;
      }
      file = path.join(publicDir, 'index.html');
    }
    if (!fs.existsSync(file)) {
      sendError(res, notFound());
      return;
    }
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        sendError(res, notFound());
        return;
      }
    }
    res.setHeader('Content-Type', contentTypeOf(file));
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  });

  // The one error order for the whole API.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (!(err instanceof ApiError)) console.error('route error', err);
    if (err instanceof ApiError) sendError(res, err);
    else if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      const e = err as { status: number; message?: string };
      sendError(res, new ApiError(e.status, e.message ?? 'Not found.'));
    } else {
      res.status(500).json({ error: 'Not found.' });
    }
  });

  return app;
}

function contentTypeOf(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.glb')) return 'model/gltf-binary';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

export async function startServer(): Promise<void> {
  // Keep retrying Postgres at boot until it is reachable.
  for (;;) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await applySchema();
  const app = createApp();
  const server = http.createServer(app);
  setupWebsockets(server);
  const port = config.publicPort;
  server.listen(port, '0.0.0.0', () => {
    console.log(`[${config.instanceName}] Hearthtile serving on 0.0.0.0:${port}`);
  });
}

// Express 4 does not catch async throws, so each route handler is patched to
// route its refusal through the one error order.
function wrapAsync(router: Router): Router {
  for (const layer of router.stack) {
    const route = layer.route;
    if (!route) continue;
    for (const method of route.stack) {
      const original = method.handle as (...a: unknown[]) => unknown;
      method.handle = ((...args: unknown[]) => {
        const next = args[2] as (err?: unknown) => void;
        try {
          const result = original(...args);
          if (result instanceof Promise) result.catch((err) => next(err));
        } catch (err) {
          next(err);
        }
      }) as typeof original;
    }
  }
  return router;
}
