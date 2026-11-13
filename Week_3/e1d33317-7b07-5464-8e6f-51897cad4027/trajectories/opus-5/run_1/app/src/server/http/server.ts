import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { Role } from '../../shared/types.js';
import { ApiError, errors } from '../errors.js';
import { callerForSeatToken, type CollaboratorRow } from '../store/collaborators.js';

export const JSON_BODY_LIMIT = 262_144;
export const BANK_BODY_LIMIT = 8_000_000;
const JSON_TYPE = 'application/json; charset=utf-8';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..', 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': JSON_TYPE,
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface Reply {
  status?: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer;
  caller: CollaboratorRow;
  request: IncomingMessage;
  response: ServerResponse;
}

export interface Route {
  method: string;
  path: string;
  auth: 'seat' | 'open';
  roles?: Role[];
  body?: 'json' | 'raw';
  handler: (context: Context) => Promise<Reply>;
}

interface Compiled extends Route {
  segments: string[];
}

export class HttpApp {
  private readonly routes: Compiled[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.path.split('/').filter(Boolean) });
  }

  private match(method: string, pathname: string): { route: Compiled; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let fits = true;
      for (const [index, segment] of route.segments.entries()) {
        const value = parts[index]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          fits = false;
          break;
        }
      }
      if (fits) return { route, params };
    }
    return null;
  }

  /** The same-origin rule: the API refuses any request naming another origin. */
  private sameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (origin === undefined || origin === 'null') return true;
    const host = request.headers.host;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      if (!this.sameOrigin(request)) throw errors.crossOrigin();
      const matched = this.match(request.method ?? 'GET', url.pathname);
      if (!matched) {
        if (url.pathname.startsWith('/api/')) throw errors.notFound();
        await this.serveStatic(url.pathname, response);
        return;
      }
      const { route, params } = matched;
      const raw = route.body === 'raw';
      const rawBody = await readBody(
        request,
        raw ? BANK_BODY_LIMIT : JSON_BODY_LIMIT,
        raw ? errors.bankTooLarge() : errors.payloadTooLarge(),
      );
      const body = !raw && rawBody.length > 0 ? (JSON.parse(rawBody.toString('utf8')) as unknown) : {};
      let caller = {} as CollaboratorRow;
      if (route.auth === 'seat') {
        caller = await this.authorise(request, params);
        if (route.roles && !route.roles.includes(caller.role)) throw errors.forbidden();
      }
      const reply = await route.handler({
        params,
        query: url.searchParams,
        body,
        rawBody,
        caller,
        request,
        response,
      });
      sendReply(response, reply);
    } catch (cause) {
      sendError(response, cause);
    }
  }

  private async authorise(
    request: IncomingMessage,
    params: Record<string, string>,
  ): Promise<CollaboratorRow> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token === '') throw errors.unauthorized();
    const caller = await callerForSeatToken(token);
    if (!caller) throw errors.unauthorized();
    if (params.scoreId !== undefined && params.scoreId !== caller.score_id) throw errors.notFound();
    return caller;
  }

  private async serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
    const candidate = relative === '' ? 'index.html' : relative;
    const absolute = join(clientRoot, candidate);
    if (!absolute.startsWith(clientRoot)) throw errors.notFound();
    try {
      const info = await stat(absolute);
      if (info.isFile()) {
        const bytes = await readFile(absolute);
        sendReply(response, {
          body: bytes,
          contentType: MIME[extname(absolute)] ?? 'application/octet-stream',
          headers: extname(absolute) === '.html' ? {} : { 'cache-control': 'public, max-age=3600' },
        });
        return;
      }
    } catch {
      // Falls through to the single-page entry or a 404 below.
    }
    const leaf = candidate.split('/').pop() ?? '';
    if (extname(candidate) !== '' || leaf.startsWith('.')) throw errors.notFound();
    const shell = await readFile(join(clientRoot, 'index.html'));
    sendReply(response, { body: shell, contentType: MIME['.html']! });
  }
}

/** Reading stops at the first byte over the limit. */
function readBody(
  request: IncomingMessage,
  limit: number,
  tooLarge: ApiError,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        chunks.length = 0;
        request.removeAllListeners('data');
        request.resume();
        reject(tooLarge);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (cause) => reject(cause));
  });
}

function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['content-type'] = JSON_TYPE;
    headers['content-length'] = String(payload.length);
    response.writeHead(reply.status ?? 200, headers);
    response.end(payload);
    return;
  }
  const body = reply.body ?? Buffer.alloc(0);
  headers['content-type'] = reply.contentType ?? 'application/octet-stream';
  headers['content-length'] = String(body.length);
  response.writeHead(reply.status ?? 200, headers);
  response.end(body);
}

export function sendError(response: ServerResponse, cause: unknown): void {
  if (!(cause instanceof ApiError)) process.stderr.write(`${String(cause)}\n`);
  const error = cause instanceof ApiError ? cause : errors.databaseUnavailable();
  const headers: Record<string, string> = {};
  if (error.extras.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(error.extras.retryAfterSeconds);
  }
  sendReply(response, { status: error.status, json: error.body(), headers });
}

export function listen(app: HttpApp, port: number): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void app.handle(request, response);
  });
  server.listen(port, '0.0.0.0');
  return server;
}
