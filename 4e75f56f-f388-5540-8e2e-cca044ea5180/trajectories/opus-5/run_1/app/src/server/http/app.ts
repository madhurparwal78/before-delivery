import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { accountForSession, type Account, type Role } from '../db/accounts.js';
import { pool } from '../db/pool.js';
import { BillingUnavailable } from '../services/killbill.js';
import { ContentUnavailable } from '../services/pocketbase.js';
import { StorageUnavailable } from '../services/s3.js';
import {
  Ctx,
  JSON_BODY_LIMIT,
  MULTIPART_BODY_LIMIT,
  type JsonResponse,
  type Route,
} from './context.js';
import {
  ApiError,
  billingUnavailable,
  contentUnavailable,
  crossOrigin,
  forbidden,
  notFound,
  payloadTooLarge,
  storageUnavailable,
  unauthenticated,
} from './errors.js';
import { INDEX_HTML } from './page.js';

const SESSION_COOKIE = 'ob_session';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

interface CompiledRoute {
  readonly route: Route;
  readonly regex: RegExp;
  readonly keys: readonly string[];
}

function compile(route: Route): CompiledRoute {
  const keys: string[] = [];
  const pattern = route.pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { route, regex: new RegExp(`^${pattern}$`), keys };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === undefined) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function sendRaw(res: ServerResponse, status: number, json: string): void {
  const payload = Buffer.from(json, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function sendJson(res: ServerResponse, status: number, body: unknown, cookies?: readonly string[]): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (cookies !== undefined && cookies.length > 0) headers['set-cookie'] = [...cookies];
  res.writeHead(status, headers);
  res.end(payload);
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (
    error instanceof BillingUnavailable ||
    error instanceof StorageUnavailable ||
    error instanceof ContentUnavailable
  ) {
    process.stderr.write(`${error.message}\n`);
    if (error instanceof BillingUnavailable) return billingUnavailable();
    if (error instanceof StorageUnavailable) return storageUnavailable();
    return contentUnavailable();
  }
  process.stderr.write(`unhandled request failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  return new ApiError(500, 'internal', 'Something went wrong on the server.');
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  const declared = req.headers['content-length'];
  if (typeof declared === 'string' && Number.parseInt(declared, 10) > limit) {
    req.resume();
    return 'too_large';
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > limit) {
      req.resume();
      return 'too_large';
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = req.headers['host'];
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function roleAllowed(access: Route['access'], account: Account | null): boolean {
  if (access === 'anonymous') return true;
  return account !== null && (access as readonly Role[]).includes(account.role);
}

interface StoredIdempotency {
  endpoint: string;
  body_hash: string;
  status: number;
  response_json: string;
}

async function lookupIdempotency(
  accountId: string,
  key: string,
): Promise<StoredIdempotency | null> {
  const result = await pool.query<StoredIdempotency>(
    `select endpoint, body_hash, status, response_json
     from idempotency where account_id = $1 and key = $2`,
    [accountId, key],
  );
  return result.rows[0] ?? null;
}

async function storeIdempotency(
  accountId: string,
  key: string,
  endpoint: string,
  bodyHash: string,
  status: number,
  responseJson: string,
): Promise<void> {
  await pool.query(
    `insert into idempotency (account_id, key, endpoint, body_hash, status, response_json)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (account_id, key) do nothing`,
    [accountId, key, endpoint, bodyHash, status, responseJson],
  );
}

export class App {
  private readonly routes: CompiledRoute[] = [];
  private readonly publicDir: string;

  constructor(publicDir: string) {
    this.publicDir = publicDir;
  }

  add(route: Route): void {
    this.routes.push(compile(route));
  }

  addAll(routes: readonly Route[]): void {
    for (const route of routes) this.add(route);
  }

  server(): Server {
    return createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: 'internal', message: 'Request failed.' });
        else res.end();
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (url.pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await this.serveStatic(res, method, url.pathname);
      return;
    }

    if (STATE_CHANGING.has(method) && !originAllowed(req)) {
      sendJson(res, 403, crossOrigin().body());
      return;
    }

    const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
    const limit = contentType.startsWith('multipart/form-data') ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
    const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, limit);
    if (body === 'too_large') {
      sendJson(res, 413, payloadTooLarge().body());
      return;
    }

    const match = this.routes
      .map((candidate) => ({ candidate, found: candidate.regex.exec(url.pathname) }))
      .find((entry) => entry.found !== null && entry.candidate.route.method === method);

    if (match === undefined || match.found === null) {
      sendJson(res, 404, notFound().body());
      return;
    }

    const { candidate, found } = match;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] ?? '');
    });

    const cookies = parseCookies(req.headers['cookie']);
    const token = cookies[SESSION_COOKIE] ?? null;
    let account: Account | null = null;
    if (token !== null) {
      account = await accountForSession(token).catch(() => null);
    }

    try {
      if (candidate.route.access !== 'anonymous' && account === null) {
        throw unauthenticated();
      }

      const ctx = new Ctx({
        req,
        params,
        query: url.searchParams,
        rawBody: body,
        account,
        endpointKey: `${method} ${url.pathname}`,
        sessionToken: token,
      });

      let storeKey: string | null = null;
      if (candidate.route.idempotent === true && account !== null && ctx.idempotencyHeader !== null) {
        const stored = await lookupIdempotency(account.id, ctx.idempotencyHeader);
        if (stored !== null) {
          if (stored.endpoint === ctx.endpointKey && stored.body_hash === ctx.bodyHash()) {
            sendRaw(res, stored.status, stored.response_json);
            return;
          }
          ctx.markIdempotencyConflict();
        } else {
          storeKey = ctx.idempotencyHeader;
        }
      }

      if (!roleAllowed(candidate.route.access, account)) {
        throw forbidden();
      }

      const result: JsonResponse = await candidate.route.handler(ctx);
      if (
        storeKey !== null &&
        account !== null &&
        (result.status === 200 || result.status === 201)
      ) {
        await storeIdempotency(
          account.id,
          storeKey,
          ctx.endpointKey,
          ctx.bodyHash(),
          result.status,
          JSON.stringify(result.body),
        );
      }
      if (result.status === 204) {
        const headers: Record<string, string | string[]> = { 'cache-control': 'no-store' };
        if (result.cookies !== undefined) headers['set-cookie'] = [...result.cookies];
        res.writeHead(204, headers);
        res.end();
        return;
      }
      sendJson(res, result.status, result.body, result.cookies);
    } catch (error) {
      const apiError = toApiError(error);
      sendJson(res, apiError.status, apiError.body());
    }
  }

  private async serveStatic(res: ServerResponse, method: string, pathname: string): Promise<void> {
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    const asset = this.assetPath(pathname);
    if (asset !== null) {
      try {
        const content = await readFile(asset);
        res.writeHead(200, {
          'content-type': STATIC_TYPES[extname(asset)] ?? 'application/octet-stream',
          'content-length': String(content.byteLength),
          'cache-control': 'public, max-age=3600',
        });
        res.end(method === 'HEAD' ? undefined : content);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      }
      return;
    }

    const lastSegment = pathname.split('/').at(-1) ?? '';
    if (lastSegment.includes('.')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const page = Buffer.from(INDEX_HTML, 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(page.byteLength),
      'cache-control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : page);
  }

  private assetPath(pathname: string): string | null {
    if (pathname === '/app.js') return join(this.publicDir, 'app.js');
    if (pathname === '/app.css') return join(this.publicDir, 'app.css');
    const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(pathname);
    if (font !== null) return join(this.publicDir, 'fonts', font[1] as string);
    return null;
  }
}
