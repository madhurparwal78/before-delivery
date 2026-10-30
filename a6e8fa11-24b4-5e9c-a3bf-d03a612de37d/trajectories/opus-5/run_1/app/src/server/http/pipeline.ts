import { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { queryOne } from '../db';
import { LIMITS, MAX_IMPORT_REQUEST_BYTES } from '../../shared/limits';
import { MemberRole } from '../../shared/workbook';
import { StorageDown } from '../services/storage';
import { ApiError, apiErrors } from './errors';
import { AuthMember, RequestContext, SESSION_COOKIE, readCookies, sendApiError, sendJson } from './context';

export interface Route {
  method: string;
  pattern: string;
  auth: boolean;
  handler: (ctx: RequestContext) => Promise<void>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

const routes: CompiledRoute[] = [];

export function addRoute(route: Route): void {
  const keys: string[] = [];
  const source = route.pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  routes.push({ ...route, regex: new RegExp(`^${source}$`), keys });
}

const PUBLIC_DIR = join(__dirname, '../../../public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        if (size > limit * 4) {
          resolve('too_large');
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? 'too_large' : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function loadMember(req: IncomingMessage): Promise<AuthMember | null> {
  const sessionId = readCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sessionId) return null;
  const row = await queryOne<{
    id: string;
    name: string;
    email: string;
    role: MemberRole;
    station_id: string;
    station_name: string;
    time_zone: string;
  }>(
    `select m.id, m.name, m.email, m.role, m.station_id, s.name as station_name, s.time_zone
     from sessions sess
     join members m on m.id = sess.member_id
     join stations s on s.id = m.station_id
     where sess.id = $1`,
    [sessionId],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    stationId: row.station_id,
    stationName: row.station_name,
    timeZone: row.time_zone,
    sessionId,
  };
}

function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
}

function ownOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  return `http://${host}`;
}

function sendStatic(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const type = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': statSync(filePath).size,
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

function sendPage(res: ServerResponse, path: string): void {
  const indexPath = join(PUBLIC_DIR, 'index.html');
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(statSync(indexPath).size),
    'X-Content-Type-Options': 'nosniff',
  };
  if (path.startsWith('/s/')) headers['Referrer-Policy'] = 'no-referrer';
  res.writeHead(200, headers);
  createReadStream(indexPath).pipe(res);
}

function sendNotFoundFile(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end('Not found');
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await route(req, res);
  } catch (failure) {
    process.stderr.write(`request failed: ${String(failure)}\n`);
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (!path.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendNotFoundFile(res);
      return;
    }
    const relative = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
    const candidate = join(PUBLIC_DIR, relative);
    if (candidate.startsWith(PUBLIC_DIR) && path !== '/' && sendStatic(res, candidate)) return;
    // Only app routes fall back to the page; anything that names a file answers 404.
    if (path.includes('.')) {
      sendNotFoundFile(res);
      return;
    }
    sendPage(res, path);
    return;
  }

  const importRequest = path === '/api/workbooks/import';
  const limit = importRequest ? MAX_IMPORT_REQUEST_BYTES : LIMITS.maxJsonBytes;
  const body = await readBody(req, limit);
  if (body === 'too_large') {
    sendApiError(res, apiErrors.payloadTooLarge(importRequest ? LIMITS.maxImportBytes : LIMITS.maxJsonBytes));
    return;
  }

  if (isStateChanging(method)) {
    const origin = req.headers.origin;
    if (origin && origin !== ownOrigin(req)) {
      sendApiError(res, apiErrors.crossOrigin());
      return;
    }
  }

  const matched = routes.find((route) => route.method === method && route.regex.test(path));
  if (!matched) {
    if (/^\/api\/share\/[^/]+$/.test(path) && method !== 'GET') {
      sendApiError(res, apiErrors.readOnly());
      return;
    }
    sendApiError(res, apiErrors.notFound());
    return;
  }

  const params: Record<string, string> = {};
  const match = matched.regex.exec(path) as RegExpExecArray;
  matched.keys.forEach((key, index) => {
    params[key] = match[index + 1];
  });

  try {
    const member = await loadMember(req);
    if (matched.auth && !member) {
      sendApiError(res, apiErrors.unauthenticated());
      return;
    }
    const ctx: RequestContext = {
      req,
      res,
      method,
      path,
      searchParams: url.searchParams,
      params,
      rawBody: body,
      member,
      origin: ownOrigin(req),
    };
    await matched.handler(ctx);
  } catch (failure) {
    if (failure instanceof ApiError) {
      sendApiError(res, failure);
      return;
    }
    if (failure instanceof StorageDown) {
      sendApiError(res, apiErrors.storageUnavailable());
      return;
    }
    process.stderr.write(`request failed: ${String(failure)}\n`);
    sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
  }
}
