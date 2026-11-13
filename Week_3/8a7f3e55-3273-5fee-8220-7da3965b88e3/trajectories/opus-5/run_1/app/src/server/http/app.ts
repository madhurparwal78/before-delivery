import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionUser } from '../../shared/api.js';
import { MAX_JSON_BYTES, MAX_MULTIPART_BYTES } from '../domain/agency.js';
import { ApiError, apiError } from './errors.js';
import { runWithIdempotency, validateKey } from './idempotency.js';
import { matchRoute, type RequestContext } from './router.js';
import { readCookie, SESSION_COOKIE, userForToken } from './sessions.js';
import { serveStatic } from './static-files.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class RequestAborted extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const headers: Record<string, string | string[]> = {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  };
  if (cookie !== undefined) headers['set-cookie'] = cookie;
  if (body === undefined || status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(payload.length);
  res.writeHead(status, headers);
  res.end(payload);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      run();
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        chunks.length = 0;
        finish(() => reject(apiError('payload_too_large')));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
    req.on('aborted', () => finish(() => reject(new RequestAborted())));
    req.on('close', () => {
      if (!req.complete) finish(() => reject(new RequestAborted()));
    });
    req.on('error', (cause) => finish(() => reject(cause)));
  });
}

function parseJsonBody(raw: Buffer, contentType: string): Record<string, unknown> {
  if (raw.length === 0) return {};
  if (!contentType.includes('application/json')) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function selfOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  return `http://${host}`;
}

function originIsForeign(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  const host = req.headers.host ?? '';
  try {
    const parsed = new URL(origin);
    return parsed.host !== host;
  } catch {
    return true;
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', selfOrigin(req));
  const method = req.method ?? 'GET';

  if (!url.pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    await serveStatic(res, url.pathname);
    return;
  }

  let cookieToSet: string | undefined;
  const setSessionCookie = (token: string | null): void => {
    cookieToSet =
      token === null
        ? `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
        : `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
  };

  try {
    if (WRITE_METHODS.has(method) && originIsForeign(req)) throw apiError('cross_origin');

    const contentType = req.headers['content-type'] ?? '';
    const multipart = contentType.includes('multipart/form-data');
    const rawBody =
      method === 'GET' || method === 'HEAD'
        ? Buffer.alloc(0)
        : await readBody(req, multipart ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES);

    const token = readCookie(req, SESSION_COOKIE);
    const user: SessionUser | null = token === null ? null : await userForToken(token);

    const match = matchRoute(method, url.pathname);
    if (!match) {
      throw apiError(user === null ? 'unauthenticated' : 'not_found');
    }
    if (!match.route.anonymous && user === null) throw apiError('unauthenticated');

    const ctx: RequestContext = {
      method,
      path: url.pathname,
      url,
      params: match.params,
      body: parseJsonBody(rawBody, contentType),
      rawBody,
      contentType,
      user,
      now: new Date(),
      req,
      res,
      setSessionCookie,
    };

    const keyHeader = req.headers['idempotency-key'];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    const useKey = match.route.idempotent && key !== undefined && user !== null;
    if (useKey && key !== undefined) validateKey(key);

    const result =
      useKey && key !== undefined && user !== null
        ? await runWithIdempotency(user.id, key, method, url.pathname, rawBody, () =>
            match.route.handler(ctx),
          )
        : await match.route.handler(ctx);

    if (match.route.raw) return;
    sendJson(res, result.status, result.body, cookieToSet);
  } catch (cause) {
    if (cause instanceof RequestAborted) {
      res.destroy();
      return;
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    if (cause instanceof ApiError) {
      sendJson(res, cause.status, cause.body(), cookieToSet);
      return;
    }
    process.stderr.write(`Unhandled request failure: ${String(cause)}\n`);
    res.destroy();
  }
}
