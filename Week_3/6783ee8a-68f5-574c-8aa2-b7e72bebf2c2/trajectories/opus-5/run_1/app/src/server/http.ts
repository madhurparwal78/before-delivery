import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, crossOrigin, requestTooLarge } from './errors.js';
import { config, MAX_JSON_BODY_BYTES } from './config.js';

export interface Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly cookies: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler });
}

function matchRoute(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part !== '');
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const segment = candidate.segments[i];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
      else if (segment !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: candidate.handler, params };
  }
  return null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sendJson(ctx: Ctx, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  ctx.res.end(payload);
}

export function sendEmpty(ctx: Ctx, status: number): void {
  ctx.res.writeHead(status, { 'cache-control': 'no-store' });
  ctx.res.end();
}

export function sendBytes(
  ctx: Ctx,
  status: number,
  body: Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  ctx.res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  ctx.res.end(body);
}

export function setSessionCookie(ctx: Ctx, sessionId: string): void {
  ctx.res.setHeader(
    'set-cookie',
    `bp_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

export function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('set-cookie', 'bp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/** Reads the body, stopping one byte past the limit. */
export function readBody(ctx: Ctx, limit: number, onTooLarge: () => ApiError): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    ctx.req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Stop reading, but keep the socket long enough to answer with the 413.
        ctx.req.pause();
        ctx.res.on('finish', () => ctx.req.destroy());
        reject(onTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.req.on('error', (error: Error) => reject(error));
  });
}

export async function readJsonBody(ctx: Ctx): Promise<Record<string, unknown>> {
  const raw = await readBody(ctx, MAX_JSON_BODY_BYTES, () => requestTooLarge(MAX_JSON_BODY_BYTES));
  if (raw.length === 0) return {};
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const APP_PATHS = new Set(['/', '/signin', '/signup', '/notebooks']);
const APP_PREFIXES = ['/verify/', '/invite/', '/notebooks/'];

function staticRoot(): string {
  return join(process.cwd(), 'dist', 'public');
}

/** Serves a built asset, or the app shell for an app route. Everything else is 404. */
function serveStatic(ctx: Ctx): boolean {
  const root = staticRoot();
  const assetNames = new Set(['/app.js', '/app.css', '/kernel.js']);
  if (assetNames.has(ctx.path) || /^\/fonts\/[A-Za-z0-9-]+\.woff2$/.test(ctx.path)) {
    const file = join(root, ctx.path);
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    ctx.res.writeHead(200, {
      'content-type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(ctx.res);
    return true;
  }
  const isAppPath = APP_PATHS.has(ctx.path) || APP_PREFIXES.some((prefix) => ctx.path.startsWith(prefix));
  if (!isAppPath) return false;
  const shell = join(root, 'index.html');
  if (!existsSync(shell)) return false;
  ctx.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': statSync(shell).size,
    'cache-control': 'no-cache',
  });
  createReadStream(shell).pipe(ctx.res);
  return true;
}

function ownOrigins(req: IncomingMessage): Set<string> {
  const host = req.headers.host;
  const origins = new Set<string>([new URL(config.publicUrl).origin]);
  if (host !== undefined) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return origins;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const ctx: Ctx = {
    req,
    res,
    method: req.method ?? 'GET',
    path: url.pathname,
    url,
    params: {},
    cookies: parseCookies(req.headers.cookie),
  };
  try {
    const stateChanging = ctx.method !== 'GET' && ctx.method !== 'HEAD';
    const origin = req.headers.origin;
    if (stateChanging && typeof origin === 'string' && origin !== 'null' && !ownOrigins(req).has(origin)) {
      throw crossOrigin();
    }
    const match = matchRoute(ctx.method, ctx.path);
    if (match) {
      const withParams: Ctx = { ...ctx, params: match.params };
      await match.handler(withParams);
      return;
    }
    if ((ctx.method === 'GET' || ctx.method === 'HEAD') && serveStatic(ctx)) return;
    if (ctx.path.startsWith('/api/')) {
      sendJson(ctx, 404, { error: 'not_found', message: 'Notebook not found.' });
      return;
    }
    sendJson(ctx, 404, { error: 'not_found', message: 'Nothing is served at this path.' });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(ctx, error.status, error.body);
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(ctx, 422, {
        error: 'validation_failed',
        message: 'Some fields are not valid.',
        errors: [{ path: 'file', message: 'is not valid JSON' }],
      });
      return;
    }
    sendJson(ctx, 500, { error: 'internal', message: 'Something went wrong. Try again.' });
  }
}
