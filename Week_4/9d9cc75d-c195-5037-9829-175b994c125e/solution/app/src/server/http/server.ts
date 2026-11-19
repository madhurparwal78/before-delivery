import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { userOf } from '../auth/sessions.ts';
import { StorageUnavailable } from '../storage/storage.ts';
import type { App, AuthUser, Context, Route } from './app.ts';
import {
  HttpError,
  notFound,
  rateLimited,
  tooLarge,
  unauthenticated,
  unsupportedMedia,
  invalid,
  storageUnavailable,
} from './errors.ts';
import { json } from './reply.ts';
import type { Reply } from './reply.ts';
import { match } from './router.ts';
import type { StaticFiles } from './static.ts';
import { isObject } from './validate.ts';
import type { JsonObject } from './validate.ts';

const JSON_MAX_BYTES = 1000000;

interface Body {
  bytes: Buffer;
  /** Every byte received, including those past the limit that are not kept. */
  size: number;
}

/** Keeps at most `limit + 1` bytes but counts (and discards) the rest, so an oversize error can name its size. */
function readBody(req: IncomingMessage, limit: number): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let kept = 0;
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (kept <= limit) {
        const take = Math.min(chunk.length, limit + 1 - kept);
        chunks.push(chunk.subarray(0, take));
        kept += take;
      }
    });
    req.on('end', () => resolve({ bytes: Buffer.concat(chunks), size }));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('aborted')));
  });
}

function mediaType(req: IncomingMessage): string {
  return (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function peekJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, reply: Reply, req: IncomingMessage): void {
  if (reply.kind === 'stream') {
    reply.open(req, res);
    return;
  }
  const headers: Record<string, string | number> = { ...reply.headers };
  if (reply.body) headers['Content-Length'] = reply.body.length;
  res.writeHead(reply.status, headers);
  res.end(reply.body ?? undefined);
}

export function createServer(app: App, files: StaticFiles): http.Server {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (!url.pathname.startsWith('/api/')) {
      const file = method === 'GET' ? await files.serve(url.pathname) : null;
      send(res, file ?? json(404, { error: 'not_found' }), req);
      return;
    }
    const found = match(app.routes, method, url.pathname);
    if (!found) throw notFound();
    const { route, params } = found;
    if (!app.db.ready && !route.beforeDatabase) throw new HttpError(503, { error: 'starting' });
    const kind = route.body ?? 'none';
    const limit = kind === 'csv' ? app.config.csvMaxBytes : JSON_MAX_BYTES;
    const body: Body = kind === 'none' ? { bytes: Buffer.alloc(0), size: 0 } : await readBody(req, limit);
    const user = await userOf(app, req);

    const parts = {
      app,
      req,
      url,
      params,
      raw: body.bytes,
      peek: () => peekJson(body.bytes),
      object: (): JsonObject => {
        const value = peekJson(body.bytes);
        if (!isObject(value)) throw invalid({}, 'invalid');
        return value;
      },
    };
    const openContext: Context<AuthUser | null> = { ...parts, user };

    if (route.rate) {
      const key = route.rate.key(openContext);
      const wait = key === null ? null : route.rate.limiter.hit(key);
      if (wait !== null) throw rateLimited(wait);
    }
    if (kind !== 'none' && body.size > limit) {
      throw tooLarge(route.tooLarge ? route.tooLarge(body.size) : undefined);
    }
    if (kind !== 'none' && mediaType(req) !== (kind === 'json' ? 'application/json' : 'text/csv')) {
      throw unsupportedMedia();
    }
    send(res, await run(route, openContext), req);
  }

  async function run(route: Route, ctx: Context<AuthUser | null>): Promise<Reply> {
    if (route.open) return route.handler(ctx);
    if (!ctx.user) throw unauthenticated();
    return route.handler({ ...ctx, user: ctx.user });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = error instanceof StorageUnavailable ? storageUnavailable() : error;
      if (known instanceof HttpError) {
        send(res, json(known.status, known.body, known.headers), req);
        return;
      }
      console.error('request failed:', error instanceof Error ? error.message : 'unknown error');
      send(res, json(500, { error: 'internal' }), req);
    });
  });
}
