import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { formatInstantSeconds } from '../domain/porttime.ts';
import type { App } from './app.ts';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.ts';
import { Idempotency, type StoredReply } from './idempotency.ts';
import type { UserRecord } from './store/types.ts';

export const JSON_LIMIT_BYTES = 65_536;

export type Reply = {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type RequestContext = {
  app: App;
  url: URL;
  params: Record<string, string>;
  headers: Record<string, string>;
  user: UserRecord;
  body: unknown;
  readBytes: (limit: number) => Promise<Buffer>;
  setSession: (token: string | null) => void;
};

export type PublicContext = Omit<RequestContext, 'user'> & { user: UserRecord | null };

export type PublicRoute = {
  auth: 'public';
  method: string;
  pattern: string;
  body?: 'json';
  handle: (context: PublicContext) => Reply | Promise<Reply>;
};

export type SessionRoute = {
  auth: 'session';
  method: string;
  pattern: string;
  body?: 'json';
  keyed?: boolean;
  handle: (context: RequestContext) => Reply | Promise<Reply>;
};

export type Route = PublicRoute | SessionRoute;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function matchRoute(
  routes: readonly Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | 'method_not_allowed' | null {
  let pathMatched = false;
  for (const route of routes) {
    const patternParts = route.pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const expected = patternParts[index] as string;
      const actual = pathParts[index] as string;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? 'method_not_allowed' : null;
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new ApiError(413, 'payload_too_large', 'That request body is too large'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, 'payload_too_large', 'That request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host ?? '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function toReply(run: () => Reply | Promise<Reply>): Promise<Reply> {
  try {
    return await run();
  } catch (cause) {
    if (cause instanceof ApiError) return { status: cause.status, json: cause.body() };
    process.stderr.write(`request failed: ${String(cause)}\n`);
    return { status: 500, json: { error: 'internal_error', message: 'Something went wrong' } };
  }
}

export function startHttpServer(app: App, routes: readonly Route[], webRoot: string): void {
  const idempotency = new Idempotency(app.store);

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      serveStatic(url.pathname, method, response, webRoot);
      return;
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }

    const found = matchRoute(routes, method, url.pathname);
    if (found === null) {
      send(response, { status: 404, json: notFound().body() });
      return;
    }
    if (found === 'method_not_allowed') {
      send(response, {
        status: 405,
        json: { error: 'method_not_allowed', message: 'That method is not allowed here' },
      });
      return;
    }
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
      send(response, { status: 403, json: forbidden().body() });
      return;
    }

    const { route, params } = found;
    let sessionCookie: string | null | undefined;
    const reply = await toReply(async () => {
      let body: unknown = undefined;
      if (route.body === 'json') {
        const raw = await readBody(request, JSON_LIMIT_BYTES);
        if (raw.length > 0) {
          const declaredType = (headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
          if (declaredType !== 'application/json') {
            throw new ApiError(415, 'unsupported_media_type', 'Unsupported content type');
          }
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new ApiError(422, 'validation_failed', 'Validation failed', {
              errors: { body: 'A JSON body is required' },
            });
          }
        } else {
          body = {};
        }
      }
      const token = cookieValue(headers.cookie, 'slackwater_session');
      const session = app.store.read().sessions.find((entry) => entry.token === token);
      const user =
        session === undefined
          ? null
          : app.store.read().users.find((entry) => entry.id === session.user_id) ?? null;
      const context: PublicContext = {
        app,
        url,
        params,
        headers,
        user,
        body,
        readBytes: (limit) => readBody(request, limit),
        setSession: (value) => {
          sessionCookie = value;
        },
      };
      if (route.auth === 'public') return route.handle(context);
      if (user === null) throw unauthenticated();
      const signedIn: RequestContext = { ...context, user };
      const key = headers['idempotency-key'];
      if (route.keyed === true && key !== undefined && key.trim() !== '') {
        const stored: StoredReply = await idempotency.run(
          user,
          key.trim(),
          method,
          url.pathname,
          body,
          async () => {
            const result = await toReply(() => route.handle(signedIn));
            return { status: result.status, json: result.json };
          },
        );
        return { status: stored.status, json: stored.json };
      }
      return route.handle(signedIn);
    });

    if (sessionCookie !== undefined) {
      const cookie =
        sessionCookie === null
          ? 'slackwater_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
          : `slackwater_session=${sessionCookie}; HttpOnly; Path=/; SameSite=Lax`;
      reply.headers = { ...reply.headers, 'set-cookie': cookie };
    }
    send(response, reply);
  }

  server.listen(app.config.port, '0.0.0.0', () => {
    process.stdout.write(
      `Slackwater serving on port ${app.config.port} at ${formatInstantSeconds(Date.now())} port time\n`,
    );
  });
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer;
  if (reply.bytes !== undefined) {
    payload = reply.bytes;
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
  } else if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json));
    headers['content-type'] = 'application/json; charset=utf-8';
  } else {
    payload = Buffer.alloc(0);
  }
  headers['content-length'] = String(payload.length);
  headers['x-content-type-options'] = 'nosniff';
  response.writeHead(reply.status, headers);
  response.end(payload);
}

/** Serves only the built client: never source files, the store or the environment. */
function serveStatic(
  pathname: string,
  method: string,
  response: ServerResponse,
  webRoot: string,
): void {
  if (method !== 'GET' && method !== 'HEAD') {
    send(response, {
      status: 405,
      json: { error: 'method_not_allowed', message: 'That method is not allowed here' },
    });
    return;
  }
  const requested = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(webRoot, requested);
  const built =
    candidate.startsWith(webRoot) && existsSync(candidate) && statSync(candidate).isFile();
  if (!built) {
    const lastSegment = requested.slice(requested.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) {
      send(response, { status: 404, json: notFound().body() });
      return;
    }
  }
  const file = built ? candidate : join(webRoot, 'index.html');
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

export function newSessionToken(): string {
  return randomBytes(24).toString('hex');
}
